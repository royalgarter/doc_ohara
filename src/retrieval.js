// Doc_Ohara: 5-Phase Hybrid Retrieval Engine
// Phase 0: input analysis + Gemini fingerprint extraction (phrase + paragraph)
// Phase 1: ArangoSearch BM25 full-text
// Phase 2: SUMO tag expansion + entity-type affinity
// Phase 3: entity graph pivot
// Phase 4: structural graph traversal
// Phase 5: score fusion & dedup

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';
import { validateTags } from './sumo.js';
import { cacheKeyFor, readCacheSync, writeCache } from './cache.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FINGERPRINT_PROMPT = fs.readFileSync(
	path.resolve(__dirname, '../prompts/extract_query_fingerprint.md'), 'utf8'
);
const INTEGRITY_VERIFY_PROMPT = fs.readFileSync(
	path.resolve(__dirname, '../prompts/verify_integrity_claim.md'), 'utf8'
);

const STOPWORDS = new Set([
	'a', 'an', 'the', 'and', 'or', 'of', 'in', 'on', 'to', 'is', 'are', 'how',
	'it', 'connects', 'show', 'me', 'with', 'for', 'this', 'that', 'be', 'as',
	'was', 'has', 'have', 'had', 'will', 'would', 'could', 'should', 'but', 'not',
	'from', 'by', 'at', 'which', 'what', 'when', 'where', 'who', 'its', 'also',
]);

const GEMINI_MODEL = 'gemini-2.5-flash-lite';

// Weight env vars
const w = () => ({
	bm25:     parseFloat(process.env.OHARA_BM25_WEIGHT          || '1.0'),
	sumo:     parseFloat(process.env.OHARA_SUMO_WEIGHT          || '0.4'),
	entity:   parseFloat(process.env.OHARA_ENTITY_PIVOT_WEIGHT  || '0.6'),
	struct:   parseFloat(process.env.OHARA_STRUCT_WEIGHT        || '0.3'),
	crossDoc: parseFloat(process.env.OHARA_CROSS_DOC_WEIGHT     || '0.4'),
});

// Temporal decay rates by class (λ in exp(−λ·Δdays))
const DECAY_RATES = () => ({
	EVERGREEN: parseFloat(process.env.OHARA_DECAY_RATE_EVERGREEN  || '0.000001'),
	SCHOLARLY: parseFloat(process.env.OHARA_DECAY_RATE_SCHOLARLY  || '0.0001'),
	CURRENT:   parseFloat(process.env.OHARA_DECAY_RATE_CURRENT    || '0.01'),
	EPHEMERAL: parseFloat(process.env.OHARA_DECAY_RATE_EPHEMERAL  || '0.1'),
});

export class RetrievalEngine {
	/**
	 * @param {object} db  — object exposing `executeAQL(query, bindVars)` (real DB or simulator shim)
	 */
	constructor(db) {
		this.db = db;
		this._ai = null;
	}

	_getAI() {
		if (!this._ai && process.env.GEMINI_API_KEY) {
			this._ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
		}
		return this._ai;
	}

	// ── Phase 0 ──────────────────────────────────────────────────────────────────

	_tokenize(text) {
		return (text.toLowerCase().match(/[a-z0-9]+/g) || [])
			.filter(w => !STOPWORDS.has(w) && w.length >= 3);
	}

	_classifyInput(tokens) {
		if (tokens.length <= 3) return 'keyword';
		if (tokens.length <= 30) return 'phrase';
		return 'paragraph';
	}

	async _extractHintsWithGemini(rawInput) {
		const ai = this._getAI();
		if (!ai) return { entityHints: [], sumoHints: [], temporalIntent: 'none' };

		const prompt = FINGERPRINT_PROMPT + rawInput.slice(0, 2000);

		try {
			const result = await ai.models.generateContent({
				model: GEMINI_MODEL,
				contents: prompt,
				config: { serviceTier: 'flex' },
			});
			const text = result.text?.trim() || '';
			const json = JSON.parse(text.replace(/^```json\s*/i, '').replace(/```\s*$/, ''));

			// Validate and resolve SUMO tags through the ontology index
			const rawSumoTags = (json.sumo_tags || []).filter(Boolean);
			const { valid: resolvedSumoTags } = rawSumoTags.length
				? validateTags(rawSumoTags)
				: { valid: [] };

			// Entities carry { slug, type } for downstream type-affinity scoring
			const entityHints = (json.entities || [])
				.filter(e => e.slug && e.type)
				.map(e => ({ slug: e.slug, type: e.type }));

			const validIntents = new Set(['current_state', 'historical_fact', 'influence_chain', 'none']);
			const temporalIntent = validIntents.has(json.temporal_intent) ? json.temporal_intent : 'none';

			return { entityHints, sumoHints: resolvedSumoTags, temporalIntent };
		} catch (_) {
			return { entityHints: [], sumoHints: [], temporalIntent: 'none' };
		}
	}

	// One-shot, temperature-0 Gemini cross-check for an Integrity-tier candidate.
	// Single system+user turn, no chat history — matches enrich_cross_doc_edge.md call shape.
	async _verifyIntegrityClaim(claimContent, corroboratingSnippets) {
		const ai = this._getAI();
		if (!ai || !claimContent || corroboratingSnippets.length === 0) return { verified: true, reason: 'skipped' };

		const inputPayload = JSON.stringify({
			claim: claimContent.slice(0, 1000),
			corroborating_snippets: corroboratingSnippets.slice(0, 3).map(s => s.slice(0, 500)),
		});
		const prompt = `${INTEGRITY_VERIFY_PROMPT}\n\nINPUT:\n${inputPayload}`;
		const key = cacheKeyFor([INTEGRITY_VERIFY_PROMPT, inputPayload, GEMINI_MODEL]);
		const cached = readCacheSync(key);
		if (cached) return cached;

		try {
			const resp = await ai.models.generateContent({
				model: GEMINI_MODEL,
				contents: prompt,
				config: { serviceTier: 'flex', temperature: 0 },
			});
			const raw = (resp.text || '').replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
			const parsed = JSON.parse(raw);
			const result = { verified: !!parsed.verified, reason: String(parsed.reason || '').slice(0, 200) };
			writeCache(key, result);
			return result;
		} catch (_) {
			return { verified: true, reason: 'verify_call_failed' };
		}
	}

	async preprocessInput(rawInput) {
		const keywords = this._tokenize(rawInput);
		const inputType = this._classifyInput(keywords);

		let entityHints = [];
		let sumoHints = [];
		let temporalIntent = 'none';

		// Extract fingerprint for phrase and paragraph queries (not bare keywords)
		if (inputType === 'phrase' || inputType === 'paragraph') {
			({ entityHints, sumoHints, temporalIntent } = await this._extractHintsWithGemini(rawInput));
		}

		// Heuristic temporal intent for keyword queries (no Gemini call)
		if (temporalIntent === 'none' && inputType === 'keyword') {
			const raw = rawInput.toLowerCase();
			if (/\b(latest|current|now|today|recent|modern|contemporary)\b/.test(raw)) {
				temporalIntent = 'current_state';
			} else if (/\b(19|18|17|16|15)\d{2}\b|\b(history|historical|era|ancient|medieval|century)\b/.test(raw)) {
				temporalIntent = 'historical_fact';
			}
		}

		return { keywords, raw: rawInput, inputType, entityHints, sumoHints, temporalIntent };
	}

	// ── Phase 1 — ArangoSearch BM25 ──────────────────────────────────────────────

	async _phase1BM25(processedQuery, limit) {
		const { keywords, raw } = processedQuery;
		if (keywords.length === 0) return [];

		// Build a SEARCH expression: BM25 over content/title with TOKENS analyzer
		const searchTerms = keywords.slice(0, 10); // cap at 10 terms for AQL sanity

		try {
			const rows = await this.db.executeAQL(`
				FOR doc IN ohara_search
					SEARCH ANALYZER(
						doc.content IN TOKENS(@phrase, "text_en") OR
						doc.title   IN TOKENS(@phrase, "text_en") OR
						doc.markdown_representation IN TOKENS(@phrase, "text_en")
					, "text_en")
					SORT BM25(doc) DESC
					LIMIT @limit
					LET parentDoc = doc.document_id != null
						? DOCUMENT(CONCAT("documents/", doc.document_id))
						: null
					RETURN {
						node: MERGE(doc, {
							document_published_date:      parentDoc.published_date,
							document_effective_decay_class: parentDoc.effective_decay_class
						}),
						score: BM25(doc),
						source: "fulltext"
					}
			`, { phrase: raw, limit: limit * 2 });
			return rows.filter(r => r.score > 0);
		} catch (err) {
			// ArangoSearch view may not exist yet (simulator fallback)
			console.warn('[retrieval] BM25 phase failed, falling back to term-overlap:', err.message);
			return this._fallbackTermOverlap(keywords, limit);
		}
	}

	async _fallbackTermOverlap(keywords, limit) {
		// Used when ArangoSearch view is unavailable (e.g. simulator)
		try {
			const paragraphs = await this.db.executeAQL('FOR p IN paragraphs RETURN p');
			const sections = await this.db.executeAQL('FOR s IN sections RETURN s');
			const candidates = [...paragraphs, ...sections];
			return candidates
				.map(node => {
					const haystack = `${node.title || ''} ${node.content || ''}`.toLowerCase();
					const hits = keywords.filter(kw => haystack.includes(kw)).length;
					const score = hits / Math.max(keywords.length, 1);
					return { node, score, source: 'fulltext_fallback' };
				})
				.filter(r => r.score > 0)
				.sort((a, b) => b.score - a.score)
				.slice(0, limit);
		} catch (_) {
			return [];
		}
	}

	// ── Phase 2 — SUMO Tag Expansion ─────────────────────────────────────────────

	async _phase2SUMO(processedQuery, bm25Results, limit) {
		// Query-derived SUMO tags first; BM25 result tags as supplementary signal
		const sumoSet = new Set(processedQuery.sumoHints);
		for (const r of bm25Results.slice(0, 5)) {
			for (const t of (r.node.sumo_tags || [])) sumoSet.add(t);
		}
		if (sumoSet.size === 0) return [];
		const sumoTags = [...sumoSet];

		// Entity types from query fingerprint for affinity boost
		const queryEntityTypes = [...new Set(
			processedQuery.entityHints
				.map(h => (typeof h === 'object' ? h.type : null))
				.filter(Boolean)
		)];

		try {
			const rows = await this.db.executeAQL(`
				LET query_tags        = @sumo_tags
				LET query_entity_types = @entity_types
				FOR p IN paragraphs
					LET tag_overlap  = LENGTH(INTERSECTION(p.sumo_tags, query_tags))
					FILTER tag_overlap > 0
					LET type_overlap = LENGTH(query_entity_types) > 0
						? LENGTH(INTERSECTION(p.entity_types || [], query_entity_types))
						: 0
					LET score = (tag_overlap  / MAX([LENGTH(query_tags),        1]))
										+ 0.2 * (type_overlap / MAX([LENGTH(query_entity_types), 1]))
					SORT score DESC
					LIMIT @limit
					RETURN { node: p, score, source: "sumo" }
			`, { sumo_tags: sumoTags, entity_types: queryEntityTypes, limit });
			return rows;
		} catch (_) {
			return [];
		}
	}

	// ── Phase 3 — Entity Graph Pivot ─────────────────────────────────────────────

	async _phase3EntityPivot(processedQuery, bm25Results, seenIds, limit) {
		// Gather entity slugs from hints (now {slug,type} objects) + top BM25 result entity_slugs
		const slugSet = new Set(
			processedQuery.entityHints.map(h => (typeof h === 'object' ? h.slug : h)).filter(Boolean)
		);
		for (const r of bm25Results.slice(0, 5)) {
			for (const s of (r.node.entity_slugs || [])) slugSet.add(s);
		}
		if (slugSet.size === 0) return [];
		const entitySlugs = [...slugSet];

		try {
			const rows = await this.db.executeAQL(`
				LET entity_slugs = @entity_slugs
				FOR e IN entities
					FILTER e.slug IN entity_slugs
					FOR edge IN edges
						FILTER edge._to == e._id AND edge.relation == "MENTIONS"
						FOR p IN paragraphs
							FILTER p._id == edge._from
							FILTER p._id NOT IN @seen_ids
							COLLECT para = p INTO grp
							LET shared = LENGTH(INTERSECTION(para.entity_slugs, entity_slugs))
							SORT shared DESC
							LIMIT @limit
							RETURN { node: para, score: shared / LENGTH(entity_slugs), source: "entity_pivot" }
			`, { entity_slugs: entitySlugs, seen_ids: [...seenIds], limit });
			return rows;
		} catch (_) {
			return [];
		}
	}

	// ── Phase 1c — Cross-Document Edge Expansion ─────────────────────────────────
	// Follows SIMILAR_TO edges from seed documents to find related paragraphs in
	// other documents. Uses edge.verb/tags for semantic filtering when available.

	async _phase1cCrossDocEdge(processedQuery, bm25Results, seenIds, limit, expandDepth = 1) {
		const seedDocIds = [...new Set(
			bm25Results.slice(0, 5)
				.map(r => r.node?.document_id)
				.filter(Boolean)
				.map(id => id.startsWith('documents/') ? id : `documents/${id}`)
		)];
		if (seedDocIds.length === 0) return [];

		const slugSet = new Set(
			processedQuery.entityHints.map(h => (typeof h === 'object' ? h.slug : h)).filter(Boolean)
		);
		for (const r of bm25Results.slice(0, 5)) {
			for (const s of (r.node.entity_slugs || [])) slugSet.add(s);
		}
		const entitySlugs = [...slugSet];

		const queryTags = [
			...processedQuery.sumoHints,
			...bm25Results.slice(0, 5).flatMap(r => r.node.sumo_tags || []),
		];

		try {
			const rows = await this.db.executeAQL(`
				LET seed_doc_ids = @seed_doc_ids
				LET entity_slugs = @entity_slugs
				LET query_tags   = @query_tags
				FOR doc_id IN seed_doc_ids
					FOR other_doc, edge, hop_path IN 1..@expand_depth ANY doc_id edges
						FILTER edge.relation == "SIMILAR_TO"
							AND (
								edge.weight > 0.3
								OR LENGTH(INTERSECTION(edge.tags, query_tags)) > 0
							)
						LET other_doc_id = other_doc._id
						LET last_edge = hop_path.edges[LENGTH(hop_path.edges) - 1]
						FOR p IN paragraphs
							FILTER p.document_id == other_doc_id
								OR CONCAT("documents/", p.document_id) == other_doc_id
							FILTER p._id NOT IN @seen_ids
							FILTER LENGTH(entity_slugs) == 0 OR LENGTH(INTERSECTION(p.entity_slugs, entity_slugs)) > 0
							SORT LENGTH(INTERSECTION(p.entity_slugs, entity_slugs)) DESC
							LIMIT @limit
							RETURN {
								node: p,
								score: last_edge.weight,
								source: "cross_doc_edge",
								edge_verb: last_edge.verb,
								edge_summary: last_edge.summary,
								hops: LENGTH(hop_path.edges)
							}
			`, { seed_doc_ids: seedDocIds, entity_slugs: entitySlugs, query_tags: queryTags, seen_ids: [...seenIds], limit, expand_depth: expandDepth });
			return rows;
		} catch (_) {
			return [];
		}
	}

	// ── Phase 4 — Structural Traversal ───────────────────────────────────────────

	async _phase4Structural(topNodeId, depth, seenIds) {
		if (!topNodeId) return [];
		try {
			const rows = await this.db.executeAQL(`
				FOR v, e IN 1..@depth OUTBOUND @startId edges
					FILTER e.relation IN ["HAS_CHILD", "NEXT_SIBLING", "BELONGS_TO"]
					FILTER v._id NOT IN @seen_ids
					RETURN { node: v, score: 1.0, source: "structural" }
			`, { startId: topNodeId, depth, seen_ids: [...seenIds] });
			return rows.filter(r => r.node && r.node._id);
		} catch (_) {
			return [];
		}
	}

	// ── Temporal Scoring ────────────────────────────────────────────────────────

	// Returns a temporal score contribution [0, OHARA_TEMPORAL_WEIGHT] for a fused entry.
	// Five-layer protection ensures gold articles are not penalised (see refs/brainstorm_space_time.md).
	_computeTemporalScore(entry, processedQuery, isPrincipal) {
		const temporalWeight = parseFloat(process.env.OHARA_TEMPORAL_WEIGHT || '0.2');
		if (temporalWeight === 0) return 0;

		const temporalIntent = processedQuery.temporalIntent || 'none';

		// Layer 1: no temporal intent in query → skip decay entirely
		if (temporalIntent === 'none') return 0;

		// Layer 2: Principal tier nodes are immune (multi-phase corroboration already proves relevance)
		if (isPrincipal) return 0;

		// Layer 3: semantically strong nodes (high BM25 score) are immune
		const gateFloor = parseFloat(process.env.OHARA_TEMPORAL_GATE_FLOOR || '5.0');
		const bm25Contribution = entry.contributions?.find(c => c.phase === 'fulltext');
		const bm25Score = bm25Contribution ? bm25Contribution.score : 0;
		if (bm25Score > gateFloor) return 0;

		// Layer 4+5: apply decay for weak candidates
		const doc = entry.node;
		const decayClass = doc.effective_decay_class || doc.document_effective_decay_class || doc.decay_class || 'SCHOLARLY';
		const rates = DECAY_RATES();
		const lambda = rates[decayClass] ?? rates.SCHOLARLY;
		const publishedDate = doc.published_date || doc.document_published_date || null;

		if (!publishedDate) return 0; // no date → cannot compute decay, skip

		const Δdays = (Date.now() - Date.parse(publishedDate)) / 86400000;
		if (isNaN(Δdays) || Δdays < 0) return 0;

		const decayScore = Math.exp(-lambda * Δdays);

		// For historical_fact queries: invert — older primary sources covering the queried period gain authority
		if (temporalIntent === 'historical_fact') {
			return temporalWeight * (1 - decayScore); // old = high score
		}

		// current_state / influence_chain: standard decay (new = high score)
		return temporalWeight * decayScore;
	}

	// ── Phase 5 — Score Fusion ───────────────────────────────────────────────────

	_fuseResults(bm25, sumo, entity, crossDoc, struct, weights) {
		const scoreMap = new Map(); // _id → { node, score, sources, contributions, edge_verb }

		const add = (results, weight, phase) => {
			for (const r of results) {
				const id = r.node?._id;
				if (!id) continue;
				const contribution = {
					phase,
					score: weight * r.score,
					document_id: r.node.document_id,
					edge_verb: r.edge_verb,
					hops: r.hops,
				};
				const cur = scoreMap.get(id);
				if (cur) {
					cur.score += weight * r.score;
					cur.sources.push(phase);
					cur.contributions.push(contribution);
				} else {
					const entry = { node: r.node, score: weight * r.score, sources: [phase], contributions: [contribution] };
					if (r.edge_verb) entry.edge_verb = r.edge_verb;
					if (r.edge_summary) entry.edge_summary = r.edge_summary;
					if (r.hops) entry.hops = r.hops;
					scoreMap.set(id, entry);
				}
			}
		};

		add(bm25,     weights.bm25,     'fulltext');
		add(sumo,     weights.sumo,     'sumo');
		add(entity,   weights.entity,   'entity_pivot');
		add(crossDoc, weights.crossDoc, 'cross_doc_edge');
		add(struct,   weights.struct,   'structural');

		return [...scoreMap.values()].sort((a, b) => b.score - a.score);
	}

	// ── Tier Classification — Principal / Integrity / Explorer ──────────────────
	// Principal: compact, corroborated-by-many-angles core answer.
	// Integrity: Principal + structurally/cross-doc verified entries, with provenance.
	// Explorer: frontier one hop beyond Integrity, cut off once edge "scent" weakens.

	async _classifyTiers(fused, processedQuery, crossDocResults, depth, seenIds, options) {
		const principalPctl = options.principalScorePctl
			?? parseFloat(process.env.OHARA_PRINCIPAL_SCORE_PCTL || '0.75');
		const integrityWeightMin = options.integrityWeightMin
			?? parseFloat(process.env.OHARA_INTEGRITY_WEIGHT_MIN || '0.6');
		const explorerStopWeight = options.explorerStopWeight
			?? parseFloat(process.env.OHARA_EXPLORER_STOP_WEIGHT || '0.15');
		const principalLimit = options.principalLimit
			?? parseInt(process.env.OHARA_PRINCIPAL_LIMIT || '5', 10);

		const docDiversity = (entry) => new Set(entry.contributions.map(c => c.document_id).filter(Boolean)).size;

		const sortedScores = [...fused].map(e => e.score).sort((a, b) => a - b);
		const pctlIdx = Math.min(sortedScores.length - 1, Math.max(0, Math.floor(sortedScores.length * principalPctl)));
		const principalScoreFloor = sortedScores.length ? sortedScores[pctlIdx] : 0;

		const principal = fused
			.filter(e => e.contributions.length >= 2
				&& (docDiversity(e) >= 2 || e.sources.includes('cross_doc_edge'))
				&& e.score >= principalScoreFloor)
			.slice(0, principalLimit);

		const principalIds = new Set(principal.map(e => e.node._id));

		const integrityExtra = [];
		for (const entry of principal) {
			const structHits = await this._phase4Structural(entry.node._id, depth, seenIds);
			for (const h of structHits) {
				if (!h.node?._id || principalIds.has(h.node._id)) continue;
				integrityExtra.push({ node: h.node, score: h.score, sources: ['structural_verify'], contributions: [{ phase: 'structural_verify', score: h.score, document_id: h.node.document_id }] });
			}
		}
		for (const r of crossDocResults) {
			if (!r.node?._id || principalIds.has(r.node._id)) continue;
			if ((r.score || 0) >= integrityWeightMin) {
				integrityExtra.push({ node: r.node, score: r.score, sources: ['cross_doc_edge'], contributions: [{ phase: 'cross_doc_edge', score: r.score, document_id: r.node.document_id, edge_verb: r.edge_verb, hops: r.hops }], edge_verb: r.edge_verb, edge_summary: r.edge_summary });
			}
		}

		let integrity = [
			...principal.map(e => ({ ...e, provenance: e.contributions })),
			...integrityExtra.map(e => ({ ...e, provenance: e.contributions })),
		];

		const llmVerifyEnabled = options.integrityLlmVerify ?? (process.env.OHARA_INTEGRITY_LLM_VERIFY === 'true');
		if (llmVerifyEnabled) {
			const verified = [];
			for (const entry of integrity) {
				const docDiv = new Set(entry.provenance.map(c => c.document_id).filter(Boolean)).size;
				if (docDiv < 2) { verified.push(entry); continue; }
				const claimContent = entry.node.content || entry.node.markdown_representation || '';
				const corroborating = integrity
					.filter(o => o !== entry && o.node.document_id !== entry.node.document_id)
					.map(o => o.node.content || o.node.markdown_representation || '')
					.filter(Boolean);
				const verdict = await this._verifyIntegrityClaim(claimContent, corroborating);
				verified.push({ ...entry, llm_verified: verdict.verified, llm_verify_reason: verdict.reason });
			}
			// failed verification drops the node back to Principal-only (not discarded)
			integrity = verified.filter(e => e.llm_verified !== false || principalIds.has(e.node._id));
		}

		const integrityIds = new Set(integrity.map(e => e.node._id));

		let frontier = [];
		let stoppedReason = 'no_principal_seeds';
		if (principal.length > 0) {
			const principalSeeds = principal.map(e => ({ node: { document_id: e.node.document_id } }));
			const crossDocLimit = options.crossDocLimit
				?? parseInt(process.env.OHARA_CROSS_DOC_LIMIT || '5', 10);
			const expandDepth = (options.expandDepth ?? parseInt(process.env.OHARA_CROSS_DOC_EXPAND_DEPTH || '1', 10)) + 1;
			const frontierSeen = new Set([...seenIds, ...integrityIds]);
			const frontierResults = await this._phase1cCrossDocEdge(processedQuery, principalSeeds, frontierSeen, crossDocLimit, expandDepth);
			frontier = frontierResults
				.filter(r => (r.score || 0) >= explorerStopWeight && (r.score || 0) < integrityWeightMin)
				.map(r => ({
					document_id: r.node.document_id,
					edge_verb: r.edge_verb,
					edge_summary: r.edge_summary,
					score: r.score,
					hops: r.hops,
				}));
			stoppedReason = frontier.length ? 'weight_below_threshold' : 'no_candidates_in_band';
		}

		return {
			principal: principal.map(e => ({ node: e.node, score: e.score, sources: e.sources })),
			integrity,
			explorer: { frontier, stopped_reason: stoppedReason },
		};
	}

	// ── Markdown Reconstruction ──────────────────────────────────────────────────

	/**
	 * Groups fused result nodes by document → section and renders them as Markdown.
	 * Fetches parent section/document titles from the DB so the caller doesn't need them.
	 *
	 * @param {Array<{node, score, sources}>} results  — fused result list from query()
	 * @returns {string}  Markdown string
	 */
	async formatAsMarkdown(results) {
		if (results.length === 0) return '';

		// Collect unique document_ids and section _ids from the result set
		const paraNodes = results.map(r => r.node).filter(n => n && (n.content || n.markdown_representation));

		const docIds  = [...new Set(paraNodes.map(n => n.document_id).filter(Boolean))];
		const secIds  = [...new Set(paraNodes.map(n => n.section_id).filter(Boolean))];

		// Fetch parent metadata in batch (graceful if collection doesn't exist)
		let docsById = {};
		let secsById = {};

		try {
			if (docIds.length) {
				const docs = await this.db.executeAQL(
					'FOR d IN documents FILTER d._key IN @ids OR d._id IN @ids RETURN d',
					{ ids: docIds }
				);
				for (const d of docs) {
					docsById[d._key] = d;
					docsById[d._id]  = d;
				}
			}
		} catch (_) {}

		try {
			if (secIds.length) {
				const secs = await this.db.executeAQL(
					'FOR s IN sections FILTER s._id IN @ids RETURN s',
					{ ids: secIds }
				);
				for (const s of secs) secsById[s._id] = s;
			}
		} catch (_) {}

		// Group paragraphs: docKey → sectionId → [nodes]
		const grouped = new Map(); // docKey → Map(sectionId → [{node, score, sources}])

		for (const r of results) {
			const n = r.node;
			if (!n || (!n.content && !n.markdown_representation)) continue;
			const docKey = n.document_id || 'unknown';
			const secId  = n.section_id  || '__none__';
			if (!grouped.has(docKey)) grouped.set(docKey, new Map());
			const byDoc = grouped.get(docKey);
			if (!byDoc.has(secId)) byDoc.set(secId, []);
			byDoc.get(secId).push(r);
		}

		const lines = [];

		for (const [docKey, bySection] of grouped) {
			const doc = docsById[docKey];
			const docTitle = doc?.title || doc?.source_file || docKey;
			lines.push(`# ${docTitle}`);
			lines.push('');

			for (const [secId, items] of bySection) {
				if (secId !== '__none__') {
					const sec = secsById[secId];
					if (sec) {
						const hashes = '#'.repeat(Math.min((sec.level || 1) + 1, 6));
						lines.push(`${hashes} ${sec.title || secId}`);
						lines.push('');
					}
				}

				for (const { node } of items) {
					const text = node.content || node.markdown_representation || '';
					lines.push(text.trim());
					lines.push('');
				}
			}
		}

		return lines.join('\n').trimEnd();
	}

	// ── Public API ───────────────────────────────────────────────────────────────

	async query(rawInput, options = {}) {
		const limit = options.limit || parseInt(process.env.OHARA_RESULT_LIMIT || '20', 10);
		const depth = options.depth || 2;
		const weights = {
			...w(),
			...(options.crossDocWeight != null ? { crossDoc: options.crossDocWeight } : {}),
		};

		const processedQuery = await this.preprocessInput(rawInput);

		const bm25Results   = await this._phase1BM25(processedQuery, limit);
		const sumoResults   = await this._phase2SUMO(processedQuery, bm25Results, limit);

		const seenAfterPhase2 = new Set([
			...bm25Results.map(r => r.node._id),
			...sumoResults.map(r => r.node._id),
		]);

		const crossDocLimit = options.crossDocLimit || parseInt(process.env.OHARA_CROSS_DOC_LIMIT || '5', 10);
		const expandDepth = options.expandDepth || parseInt(process.env.OHARA_CROSS_DOC_EXPAND_DEPTH || '1', 10);
		const [entityResults, crossDocResults] = await Promise.all([
			this._phase3EntityPivot(processedQuery, bm25Results, seenAfterPhase2, limit),
			this._phase1cCrossDocEdge(processedQuery, bm25Results, seenAfterPhase2, crossDocLimit, expandDepth),
		]);

		const topNodeId = bm25Results[0]?.node?._id;
		const seenAfterPhase3 = new Set([
			...seenAfterPhase2,
			...entityResults.map(r => r.node._id),
			...crossDocResults.map(r => r.node._id),
		]);
		const structResults = await this._phase4Structural(topNodeId, depth, seenAfterPhase3);

		const fused = this._fuseResults(bm25Results, sumoResults, entityResults, crossDocResults, structResults, weights);

		// Apply temporal scoring post-fusion (before tier classification so tiers see adjusted scores)
		const principalSet = new Set(); // populated below after tier classification; first pass uses empty set
		for (const entry of fused) {
			const temporalContrib = this._computeTemporalScore(entry, processedQuery, principalSet.has(entry.node?._id));
			if (temporalContrib !== 0) {
				entry.score += temporalContrib;
				entry.sources.push('temporal');
				entry.contributions.push({ phase: 'temporal', score: temporalContrib, document_id: entry.node?.document_id });
			}
		}
		fused.sort((a, b) => b.score - a.score);

		const topK = fused.slice(0, limit);

		const tiers = await this._classifyTiers(fused, processedQuery, crossDocResults, depth, seenAfterPhase3, options);

		return {
			processedQuery,
			results: topK,
			tiers,
			// legacy fields for backwards compat with existing server routes
			shallowResults: bm25Results,
			entityPivotResults: entityResults,
			crossDocResults,
			deepResults: structResults.map(r => r.node),
		};
	}

	async getDeepContext(targetNodeId, _edgeTypes, options = {}) {
		const depth = options.depth || 2;
		return this._phase4Structural(targetNodeId, depth, new Set());
	}
}
