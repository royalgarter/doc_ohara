// Doc_Ohara: 5-Phase Hybrid Retrieval Engine
// Phase 0: input analysis + Gemini fingerprint extraction (phrase + paragraph)
// Phase 1: ArangoSearch BM25 full-text
// Phase 2: SUMO tag expansion + entity-type affinity
// Phase 3: entity graph pivot
// Phase 4: structural graph traversal
// Phase 5: score fusion & dedup

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI } from '@google/genai';
import { validateTags, sumoAncestors } from './sumo.js';
import { cacheKeyFor, readCacheSync, writeCache } from './cache.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FINGERPRINT_PROMPT = fs.readFileSync(
	path.resolve(__dirname, '../prompts/extract_query_fingerprint.md'), 'utf8'
);
const INTEGRITY_VERIFY_PROMPT = fs.readFileSync(
	path.resolve(__dirname, '../prompts/verify_integrity_claim.md'), 'utf8'
);
const SELF_RAG_VERIFY_PROMPT = fs.readFileSync(
	path.resolve(__dirname, '../prompts/self_rag_verify.md'), 'utf8'
);
const REASONING_SUBQUERY_PROMPT = fs.readFileSync(
	path.resolve(__dirname, '../prompts/reasoning_subquery.md'), 'utf8'
);
const AGENT_STRATEGY_PROMPT = fs.readFileSync(
	path.resolve(__dirname, '../prompts/agent_strategy.md'), 'utf8'
);
const RERANK_PROMPT = fs.readFileSync(
	path.resolve(__dirname, '../prompts/rerank.md'), 'utf8'
);
const TOC_SECTION_SELECTOR_PROMPT = fs.readFileSync(
	path.resolve(__dirname, '../prompts/toc_section_selector.md'), 'utf8'
);

const STOPWORDS = new Set([
	'a', 'an', 'the', 'and', 'or', 'of', 'in', 'on', 'to', 'is', 'are', 'how',
	'it', 'connects', 'show', 'me', 'with', 'for', 'this', 'that', 'be', 'as',
	'was', 'has', 'have', 'had', 'will', 'would', 'could', 'should', 'but', 'not',
	'from', 'by', 'at', 'which', 'what', 'when', 'where', 'who', 'its', 'also',
]);

const GEMINI_MODEL = 'gemini-2.5-flash-lite';

// Base weight env vars — used as-is for factoid queries and as multiplier floor for others
const w = () => ({
	bm25:        parseFloat(process.env.OHARA_BM25_WEIGHT          || '1.0'),
	sumo:        parseFloat(process.env.OHARA_SUMO_WEIGHT          || '0.4'),
	entity:      parseFloat(process.env.OHARA_ENTITY_PIVOT_WEIGHT  || '0.6'),
	struct:      parseFloat(process.env.OHARA_STRUCT_WEIGHT        || '0.3'),
	crossDoc:    parseFloat(process.env.OHARA_CROSS_DOC_WEIGHT     || '0.4'),
	vector:      parseFloat(process.env.OHARA_VECTOR_WEIGHT        || '0.5'),
	answersSame: 0.5,
	cluster:     0.6,
});

// Adaptive weight multipliers per query mode.
// Applied on top of base env-var weights so users can still tune the floor.
// factoid  = exact recall task   → heavy BM25, light synthesis channels
// synthesis= multi-doc summary   → heavy cluster+community, lighter BM25
// exploratory= open-ended browse → heavy cross-doc+entity, balanced everything
const ADAPTIVE_MULTIPLIERS = {
	factoid: {
		bm25: 1.0, sumo: 0.8, entity: 0.7, struct: 0.6,
		crossDoc: 0.5, vector: 0.8, answersSame: 0.4, cluster: 0.2,
	},
	synthesis: {
		bm25: 0.6, sumo: 1.0, entity: 0.8, struct: 0.4,
		crossDoc: 0.8, vector: 1.0, answersSame: 0.8, cluster: 1.2,
	},
	exploratory: {
		bm25: 0.7, sumo: 0.9, entity: 1.2, struct: 0.5,
		crossDoc: 1.2, vector: 0.9, answersSame: 1.0, cluster: 0.8,
	},
};

// Temporal decay rates by class (λ in exp(−λ·Δdays))
const DECAY_RATES = () => ({
	EVERGREEN: parseFloat(process.env.OHARA_DECAY_RATE_EVERGREEN  || '0.000001'),
	SCHOLARLY: parseFloat(process.env.OHARA_DECAY_RATE_SCHOLARLY  || '0.0001'),
	CURRENT:   parseFloat(process.env.OHARA_DECAY_RATE_CURRENT    || '0.01'),
	EPHEMERAL: parseFloat(process.env.OHARA_DECAY_RATE_EPHEMERAL  || '0.1'),
});

// Normalise a LLM-returned date value to "YYYY-MM-DD" or "YYYY", or null.
function _normaliseDate(val) {
	if (!val || typeof val !== 'string') return null;
	const s = val.trim();
	if (/^\d{4}$/.test(s)) return s;                      // bare year "1995"
	if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;          // full ISO date
	if (/^\d{4}-\d{2}$/.test(s)) return s + '-01';        // "YYYY-MM" → day 1
	return null;
}

// Convert a date string ("YYYY", "YYYY-MM-DD") to a JS Date or null.
function _toDate(val) {
	if (!val) return null;
	const d = new Date(/^\d{4}$/.test(val) ? `${val}-01-01` : val);
	return isNaN(d.getTime()) ? null : d;
}

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

	async _extractHintsWithGemini(rawInput, sessionHistory = []) {
		const ai = this._getAI();
		if (!ai) return { entityHints: [], sumoHints: [], temporalIntent: 'none' };

		const historyLimit = parseInt(process.env.OHARA_SESSION_HISTORY_LIMIT || '3', 10);
		const recentHistory = sessionHistory.slice(-historyLimit);
		const historyBlock = recentHistory.length
			? recentHistory.map(t => `${t.role === 'assistant' ? 'Assistant' : 'User'}: ${String(t.content).slice(0, 500)}`).join('\n') + '\n\n'
			: '';

		const prompt = FINGERPRINT_PROMPT + historyBlock + rawInput.slice(0, 2000);

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

			const rawRange = json.date_range || {};
			const dateRange = {
				from: _normaliseDate(rawRange.from) || null,
				to:   _normaliseDate(rawRange.to)   || null,
			};

			return { entityHints, sumoHints: resolvedSumoTags, temporalIntent, dateRange };
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

	async _selfRagFilter(rawQuery, nodes) {
		const ai = this._getAI();
		if (!ai || !nodes.length) return nodes;

		const results = await Promise.all(nodes.map(async entry => {
			const content = (entry.node?.content || entry.node?.title || '').slice(0, 1200);
			if (!content) return { entry, responsive: true };
			const inputPayload = JSON.stringify({ query: rawQuery.slice(0, 400), passage: content });
			const prompt = `${SELF_RAG_VERIFY_PROMPT}\n\nINPUT:\n${inputPayload}`;
			const key = cacheKeyFor([SELF_RAG_VERIFY_PROMPT, inputPayload, GEMINI_MODEL]);
			const cached = readCacheSync(key);
			if (cached) return { entry, ...cached };
			try {
				const resp = await ai.models.generateContent({
					model: GEMINI_MODEL,
					contents: prompt,
					config: { serviceTier: 'flex', temperature: 0 },
				});
				const raw = (resp.text || '').replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
				const parsed = JSON.parse(raw);
				const result = { responsive: parsed.responsive !== false, reason: String(parsed.reason || '').slice(0, 200) };
				writeCache(key, result);
				return { entry, ...result };
			} catch (_) {
				return { entry, responsive: true };
			}
		}));

		return results.filter(r => r.responsive).map(r => r.entry);
	}

	// Single Gemini call: reorder nodes by relevance to rawQuery.
	// Returns nodes in new order; falls back to original order on parse failure.
	async _rerankWithGemini(rawQuery, nodes) {
		const ai = this._getAI();
		if (!ai || nodes.length <= 1) return nodes;

		const topN = parseInt(process.env.OHARA_RERANK_TOP_N || '5', 10);
		const candidates = nodes.slice(0, topN);

		const passages = candidates.map((r, i) => {
			const n = r.node || r;
			const text = (n.content || n.title || '').slice(0, 500);
			return `[${i + 1}] ${text}`;
		}).join('\n\n');

		const inputPayload = JSON.stringify({ query: rawQuery.slice(0, 400), passages_count: candidates.length });
		const key = cacheKeyFor([RERANK_PROMPT, rawQuery.slice(0, 400), passages.slice(0, 1000), GEMINI_MODEL]);
		const cached = readCacheSync(key);

		let ranked;
		if (cached) {
			ranked = cached;
		} else {
			try {
				const prompt = `${RERANK_PROMPT}\n\nQuery: ${rawQuery.slice(0, 400)}\n\nPassages:\n${passages}`;
				const resp = await ai.models.generateContent({
					model: GEMINI_MODEL,
					contents: prompt,
					config: { serviceTier: 'flex', temperature: 0 },
				});
				const raw = (resp.text || '').replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
				const parsed = JSON.parse(raw);
				ranked = (parsed.ranked || []).filter(n => Number.isInteger(n) && n >= 1 && n <= candidates.length);
				if (ranked.length === candidates.length) writeCache(key, ranked);
			} catch (_) {
				return nodes; // fallback: original order
			}
		}

		if (!ranked || ranked.length !== candidates.length) return nodes;

		// Reorder candidates per Gemini ranking; append remaining nodes unchanged
		const reordered = ranked.map(n => candidates[n - 1]);
		return [...reordered, ...nodes.slice(topN)];
	}

	async _generateSubqueries(rawQuery, bm25Results) {
		const ai = this._getAI();
		if (!ai) return [];
		const snippets = bm25Results.slice(0, 3).map(r =>
			(r.node?.content || r.node?.title || '').slice(0, 400)
		).filter(Boolean);
		if (!snippets.length) return [];
		const inputPayload = JSON.stringify({ query: rawQuery.slice(0, 400), passages: snippets });
		const prompt = `${REASONING_SUBQUERY_PROMPT}\n\nINPUT:\n${inputPayload}`;
		const key = cacheKeyFor([REASONING_SUBQUERY_PROMPT, inputPayload, GEMINI_MODEL]);
		const cached = readCacheSync(key);
		if (cached) return cached.subqueries || [];
		try {
			const resp = await ai.models.generateContent({
				model: GEMINI_MODEL,
				contents: prompt,
				config: { serviceTier: 'flex', temperature: 0 },
			});
			const raw = (resp.text || '').replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
			const parsed = JSON.parse(raw);
			const subqueries = (parsed.subqueries || []).slice(0, parseInt(process.env.OHARA_REASONING_SUBQUERY_LIMIT || '2', 10));
			writeCache(key, { subqueries });
			return subqueries;
		} catch (_) {
			return [];
		}
	}

	async preprocessInput(rawInput, sessionHistory = []) {
		const keywords = this._tokenize(rawInput);
		const inputType = this._classifyInput(keywords);

		let entityHints = [];
		let sumoHints = [];
		let temporalIntent = 'none';
		let dateRange = { from: null, to: null };

		// Extract fingerprint for phrase and paragraph queries (not bare keywords)
		if (inputType === 'phrase' || inputType === 'paragraph') {
			({ entityHints, sumoHints, temporalIntent, dateRange = { from: null, to: null } } =
				await this._extractHintsWithGemini(rawInput, sessionHistory));
		}

		// Heuristic temporal intent + date range for keyword queries (no Gemini call)
		if (temporalIntent === 'none' && inputType === 'keyword') {
			const raw = rawInput.toLowerCase();
			if (/\b(latest|current|now|today|recent|modern|contemporary)\b/.test(raw)) {
				temporalIntent = 'current_state';
			} else if (/\b(19|18|17|16|15)\d{2}\b|\b(history|historical|era|ancient|medieval|century)\b/.test(raw)) {
				temporalIntent = 'historical_fact';
			}
		}

		// Heuristic date range from bare year/decade tokens (no Gemini call).
		// Examples: "before 2008", "after 2020", "in the 1990s", "bitcoin 2012"
		if (!dateRange.from && !dateRange.to) {
			const rawLow = rawInput.toLowerCase();
			const beforeM = rawLow.match(/\bbefore\s+((?:19|20)\d{2})\b/);
			const afterM  = rawLow.match(/\bafter\s+((?:19|20)\d{2})\b/);
			const decadeM = rawLow.match(/\b((?:19|20)\d{2})s\b/);   // "1990s", "2000s"
			const singleY = rawLow.match(/\b((?:19|20)\d{2})\b/);
			if (beforeM) {
				dateRange = { from: null, to: beforeM[1] };
			} else if (afterM) {
				dateRange = { from: afterM[1], to: null };
			} else if (decadeM) {
				// "1990s" → 1990–1999
				const d = parseInt(decadeM[1], 10);
				dateRange = { from: String(d), to: String(d + 9) };
			} else if (singleY && temporalIntent === 'historical_fact') {
				// centre ±2 years around a single mentioned year
				const y = parseInt(singleY[1], 10);
				dateRange = { from: String(y - 2), to: String(y + 2) };
			}
		}

		return { keywords, raw: rawInput, inputType, entityHints, sumoHints, temporalIntent, dateRange };
	}

	// ── Phase 0b — TOC-Guided Section Selection (PageIndex-inspired) ─────────────
	// For phrase/paragraph queries: fetch section tree (titles + summaries) for seed
	// documents, ask Gemini which sections are relevant, return those section _ids
	// as priority entry points for Phase 4 structural traversal.
	async _phase0bTocGuidance(rawQuery, seedDocIds) {
		const ai = this._getAI();
		if (!ai || !seedDocIds.length) return [];
		try {
			const rows = await this.db.executeAQL(`
				FOR s IN sections
					FILTER s.document_id IN @doc_ids
					RETURN { id: s._id, title: s.title, summary: s.summary, level: s.level }
			`, { doc_ids: seedDocIds });
			if (!rows.length) return [];

			const tree = rows.map(s => ({
				id: s.id,
				title: s.title || '',
				...(s.summary ? { summary: s.summary } : {}),
				level: s.level || 1,
			}));
			const payload = JSON.stringify({ query: rawQuery.slice(0, 400), sections: tree });
			const key = cacheKeyFor([TOC_SECTION_SELECTOR_PROMPT, payload, 'gemini-2.5-flash-lite']);
			const cached = readCacheSync(key);
			if (cached?.relevant_section_ids) return cached.relevant_section_ids;

			const resp = await ai.models.generateContent({
				model: 'gemini-2.5-flash-lite',
				contents: TOC_SECTION_SELECTOR_PROMPT + rawQuery.slice(0, 400) + '\n\nSECTION TREE:\n' + JSON.stringify(tree, null, 2),
				config: { serviceTier: 'flex', temperature: 0 },
			});
			const raw = (resp.text || '').replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
			const parsed = JSON.parse(raw);
			const ids = (parsed.relevant_section_ids || []).filter(id => typeof id === 'string').slice(0, 5);
			writeCache(key, { relevant_section_ids: ids });
			return ids;
		} catch (_) {
			return [];
		}
	}

	// ── Phase 1 — ArangoSearch BM25 ──────────────────────────────────────────────

	async _phase1BM25(processedQuery, limit) {
		const { keywords, raw, dateRange } = processedQuery;
		if (keywords.length === 0) return [];

		const hasDateFilter = dateRange && (dateRange.from || dateRange.to);
		// Strict date filter: exclude docs whose temporal window falls outside the query range.
		// Applies for all intents EXCEPT historical_fact — for that, a 2012 textbook may still
		// contain authoritative content about the 1990s, so we use coverage SCORING (boost)
		// rather than hard exclusion. All other intents (current_state, influence_chain, none)
		// are treated as hard filters when a date range is present.
		// Disable entirely via OHARA_DATE_FILTER_STRICT=false.
		const strictDateFilter = hasDateFilter &&
			processedQuery.temporalIntent !== 'historical_fact' &&
			(process.env.OHARA_DATE_FILTER_STRICT !== 'false');

		try {
			const rows = await this.db.executeAQL(`
				FOR doc IN ohara_search
					SEARCH ANALYZER(
						doc.content IN TOKENS(@phrase, "text_en") OR
						doc.title   IN TOKENS(@phrase, "text_en") OR
						doc.markdown_representation IN TOKENS(@phrase, "text_en") OR
						doc.contextual_prefix IN TOKENS(@phrase, "text_en")
					, "text_en")
					SORT BM25(doc) DESC
					LIMIT @limit
					LET parentDoc = doc.document_id != null
						? DOCUMENT(CONCAT("documents/", doc.document_id))
						: null
					LET pubDate = parentDoc.published_date
					LET covFrom = parentDoc.temporal_coverage_start
					LET covTo   = parentDoc.temporal_coverage_end
					LET hasTemporalInfo = pubDate != null OR covFrom != null OR covTo != null
					FILTER @dateFrom == null
						OR (!@strict AND !hasTemporalInfo)
						OR (pubDate  != null AND pubDate >= @dateFrom)
						OR (covTo    != null AND covTo   >= @dateFrom)
					FILTER @dateTo == null
						OR (!@strict AND !hasTemporalInfo)
						OR (pubDate  != null AND pubDate <= @dateTo)
						OR (covFrom  != null AND covFrom <= @dateTo)
					RETURN {
						node: MERGE(doc, {
							document_published_date:        parentDoc.published_date,
							document_effective_decay_class: parentDoc.effective_decay_class,
							document_coverage_start:        parentDoc.temporal_coverage_start,
							document_coverage_end:          parentDoc.temporal_coverage_end
						}),
						score: BM25(doc),
						source: "fulltext"
					}
			`, {
				phrase:   raw,
				limit:    limit * 2,
				// Pass date bounds to AQL only in strict mode (current_state).
				// historical_fact uses date range for scoring only — AQL filter stays open.
				dateFrom: strictDateFilter ? (dateRange.from || null) : null,
				dateTo:   strictDateFilter ? (dateRange.to   || null) : null,
				strict:   strictDateFilter,
			});
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
			const paragraphs = await this.db.executeAQL(`FOR p IN paragraphs RETURN p`);
			const sections = await this.db.executeAQL(`FOR s IN sections RETURN s`);
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

		// Expand query tags with hierarchy ancestors (up to 3 hops, decaying weight).
		// ancestorWeights maps tag → max weight across all query tags that share it as ancestor.
		const SUMO_HIERARCHY_DEPTH = parseInt(process.env.OHARA_SUMO_HIERARCHY_DEPTH || '3', 10);
		const ancestorWeights = new Map(); // expanded tag → score weight [0,1]
		if (SUMO_HIERARCHY_DEPTH > 0) {
			for (const tag of processedQuery.sumoHints) {
				for (const [anc, dist] of sumoAncestors(tag)) {
					if (dist > SUMO_HIERARCHY_DEPTH) continue;
					const w = 1 / (dist + 1); // 1-hop → 0.5, 2-hop → 0.33, 3-hop → 0.25
					if (!ancestorWeights.has(anc) || ancestorWeights.get(anc) < w) {
						ancestorWeights.set(anc, w);
					}
					sumoSet.add(anc);
				}
			}
		}

		const sumoTags = [...sumoSet];

		// Entity types from query fingerprint for affinity boost
		const queryEntityTypes = [...new Set(
			processedQuery.entityHints
				.map(h => (typeof h === 'object' ? h.type : null))
				.filter(Boolean)
		)];

		// Split tags into exact (query-derived) and ancestor-expanded (lower weight)
		const exactTags = [...new Set(processedQuery.sumoHints)];
		// Ancestor tags only (not already in exactTags)
		const ancestorTagEntries = [...ancestorWeights.entries()]
			.filter(([t]) => !exactTags.includes(t));
		const ancestorTags = ancestorTagEntries.map(([t]) => t);
		// Average ancestor weight for scoring (use 0.3 as fallback if no ancestors)
		const avgAncestorWeight = ancestorTagEntries.length
			? ancestorTagEntries.reduce((s, [, w]) => s + w, 0) / ancestorTagEntries.length
			: 0.3;

		try {
			const rows = await this.db.executeAQL(`
				LET exact_tags        = @exact_tags
				LET ancestor_tags     = @ancestor_tags
				LET ancestor_weight   = @ancestor_weight
				LET query_entity_types = @entity_types
				FOR p IN paragraphs
					LET exact_overlap    = LENGTH(INTERSECTION(p.sumo_tags, exact_tags))
					LET ancestor_overlap = LENGTH(INTERSECTION(p.sumo_tags, ancestor_tags))
					FILTER exact_overlap + ancestor_overlap > 0
					LET type_overlap = LENGTH(query_entity_types) > 0
						? LENGTH(INTERSECTION(p.entity_types || [], query_entity_types))
						: 0
					LET denom = MAX([LENGTH(exact_tags) + LENGTH(ancestor_tags), 1])
					LET score = ((exact_overlap + ancestor_overlap * ancestor_weight) / denom)
								+ 0.2 * (type_overlap / MAX([LENGTH(query_entity_types), 1]))
					SORT score DESC
					LIMIT @limit
					RETURN { node: p, score, source: "sumo" }
			`, { exact_tags: exactTags, ancestor_tags: ancestorTags, ancestor_weight: avgAncestorWeight, entity_types: queryEntityTypes, limit });
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

			// E5: Adamic-Adar boost — if ADAMIC_ADAR edges exist between query entities and
			// para entities, add AA weight to the paragraph's score
			const aaEnabled = process.env.OHARA_ADAMIC_ADAR !== 'false';
			if (aaEnabled && rows.length > 0 && entitySlugs.length > 0) {
				try {
					const aaRows = await this.db.executeAQL(`
						LET query_entity_ids = (FOR e IN entities FILTER e.slug IN @slugs RETURN e._id)
						FOR edge IN edges
							FILTER edge.relation == "ADAMIC_ADAR"
							FILTER edge._from IN query_entity_ids OR edge._to IN query_entity_ids
							RETURN { from: edge._from, to: edge._to, weight: edge.weight }
					`, { slugs: entitySlugs });

					// Build lookup: entityId → max AA weight to any query entity
					const aaWeightByEntity = new Map();
					for (const { from, to, weight } of aaRows) {
						for (const id of [from, to]) {
							aaWeightByEntity.set(id, Math.max(aaWeightByEntity.get(id) || 0, weight || 0));
						}
					}

					if (aaWeightByEntity.size > 0) {
						// Get entity _ids for each result paragraph
						for (const row of rows) {
							const slugs = row.node?.entity_slugs || [];
							if (!slugs.length) continue;
							const entityIds = await this.db.executeAQL(
								`FOR e IN entities FILTER e.slug IN @slugs RETURN e._id`,
								{ slugs }
							).then(c => c.all()).catch(() => []);
							const maxAA = Math.max(0, ...entityIds.map(id => aaWeightByEntity.get(id) || 0));
							if (maxAA > 0) {
								row.score += 0.2 * maxAA;
								row.sources = row.sources ? [...row.sources, 'adamic_adar'] : ['entity_pivot', 'adamic_adar'];
							}
						}
					}
				} catch (_) {}
			}

			// E8: attach community summary to pivot results for synthesis context
			const communityEnabled = process.env.OHARA_COMMUNITY !== 'false';
			if (communityEnabled && entitySlugs.length > 0) {
				try {
					const commRows = await this.db.executeAQL(`
						LET slugs = @slugs
						FOR e IN entities
							FILTER e.slug IN slugs
							FOR cm_edge IN edges
								FILTER cm_edge._from == e._id AND cm_edge.relation == "COMMUNITY_MEMBER"
								FOR c IN communities
									FILTER c._id == cm_edge._to
									COLLECT comm = c INTO grp
									SORT LENGTH(grp) DESC
									LIMIT 3
									RETURN { summary: comm.summary, member_count: comm.member_count, member_entity_slugs: comm.member_entity_slugs }
					`, { slugs: entitySlugs });
					if (commRows.length > 0) {
						// Attach as metadata — consumers can use for synthesis context
						for (const row of rows) {
							row.community_context = commRows;
						}
					}
				} catch (_) {}
			}

			return rows;
		} catch (_) {
			return [];
		}
	}

	// ── Phase 1e — ANSWERS_SAME Logical Co-Relevance ────────────────────────────
	// Follows ANSWERS_SAME edges from top BM25 seed paragraphs to find paragraphs
	// that answer the same pseudo-question, even with zero vocabulary/entity overlap.
	async _phase1eAnswersSame(bm25Results, seenIds, limit) {
		const seedIds = bm25Results.slice(0, 5).map(r => r.node?._id).filter(Boolean);
		if (!seedIds.length) return [];
		try {
			const rows = await this.db.executeAQL(`
				LET seed_ids = @seed_ids
				FOR e IN edges
					FILTER e._from IN seed_ids AND e.relation == "ANSWERS_SAME"
					FOR p IN paragraphs
						FILTER p._id == e._to
						FILTER p._id NOT IN @seen_ids
						SORT e.weight DESC
						LIMIT @limit
						RETURN { node: p, score: 0.7, source: "answers_same", shared_query: e.shared_query }
			`, { seed_ids: seedIds, seen_ids: [...seenIds], limit });
			return rows.filter(r => r.node?._id);
		} catch (_) {
			return [];
		}
	}

	// ── Phase 0 StructRAG Query Router ──────────────────────────────────────────
	// Classifies query as factoid | synthesis | exploratory. Used to gate Phase 1f
	// cluster retrieval and future query-type-specific strategies.
	_detectQueryMode(rawQuery) {
		const q = rawQuery.toLowerCase();
		// Synthesis/exploratory: asks for overview, comparison, list, or broad summary
		if (/\b(summarize|summarise|overview|compare|comparison|differences?|similarities|types of|kinds of|list all|explain all|what are (all|the different)|how does .{0,30} relate|survey|landscape|categories|taxonomy|outline)\b/.test(q)) {
			return 'synthesis';
		}
		if (/\b(explore|discover|what else|tell me (more|everything) about|what do you know about|give me an? (overview|summary|introduction))\b/.test(q)) {
			return 'exploratory';
		}
		return 'factoid';
	}

	// ── Phase 1f — Cluster Summary Retrieval (RAPTOR-inspired) ──────────────────
	// For synthesis/exploratory queries: find clusters whose summaries match the
	// query keywords; return cluster summary nodes as synthetic top-level results.
	async _phase1fCluster(processedQuery, seenIds, limit) {
		const keywords = processedQuery.keywords;
		if (!keywords.length) return [];
		try {
			const rows = await this.db.executeAQL(`
				LET kws = @keywords
				FOR c IN clusters
					LET summary_lower = LOWER(c.summary)
					LET hits = LENGTH(
						FOR kw IN kws
							FILTER CONTAINS(summary_lower, kw)
							RETURN 1
					)
					FILTER hits > 0
					SORT hits DESC
					LIMIT @limit
					RETURN {
						node: MERGE(c, { _type: "cluster", content: c.summary }),
						score: hits / LENGTH(kws),
						source: "cluster_summary"
					}
			`, { keywords, limit });
			return rows.filter(r => !seenIds.has(r.node._id));
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

	// ── Phase 1d — Vector Similarity (ANN cosine) ───────────────────────────────

	async _phase1dVector(processedQuery, limit) {
		if (process.env.OHARA_VECTOR_WEIGHT === '0') return [];
		const ai = this._getAI();
		if (!ai) return [];

		const cacheKey = cacheKeyFor(['vec', processedQuery.raw]);
		let queryVec = readCacheSync(cacheKey);
		if (!queryVec) {
			try {
				const resp = await ai.models.embedContent({
					model: 'gemini-embedding-2',
					contents: processedQuery.raw.slice(0, 2000),
					config: { taskType: 'RETRIEVAL_QUERY', outputDimensionality: 768 },
				});
				queryVec = resp.embeddings?.[0]?.values;
				if (queryVec) await writeCache(cacheKey, queryVec);
			} catch (err) {
				return [];
			}
		}
		if (!queryVec) return [];

		try {
			// ArangoDB 3.12 Enterprise: COSINE_SIMILARITY(doc_field, query_vec) DESC via vector index.
			const rows = await this.db.executeAQL(`
				FOR p IN paragraphs
					OPTIONS { indexHint: "idx_para_embedding" }
					SORT COSINE_SIMILARITY(p.embedding, @vec) DESC
					LIMIT @limit
					RETURN { node: p, score: COSINE_SIMILARITY(p.embedding, @vec), source: "vector" }
			`, { vec: queryVec, limit });
			return rows.filter(r => r.score > 0);
		} catch (_) {
			return []; // vector index not yet created or no embeddings — degrade gracefully
		}
	}

	// ── Web Search (Agentic RAG) ──────────────────────────────────────────────────
	// Calls Tavily (OHARA_WEB_SEARCH_PROVIDER=tavily, default) or SerpApi.
	// Results become ephemeral paragraph-shaped nodes with source='web_search'.
	async _webSearch(query) {
		const key = process.env.OHARA_WEB_SEARCH_KEY;
		if (!key) return [];
		const provider = process.env.OHARA_WEB_SEARCH_PROVIDER || 'tavily';
		try {
			let results = [];
			if (provider === 'tavily') {
				const resp = await fetch('https://api.tavily.com/search', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ api_key: key, query: query.slice(0, 400), max_results: 5, search_depth: 'basic' }),
				});
				if (!resp.ok) return [];
				const data = await resp.json();
				results = (data.results || []).map(r => ({
					node: {
						_id: `web_search/${encodeURIComponent(r.url || r.title || Math.random())}`,
						content: `${r.title || ''}\n\n${r.content || r.snippet || ''}`.trim().slice(0, 2000),
						title: r.title || '',
						url: r.url || '',
						document_id: null,
						entity_slugs: [],
						_type: 'web_result',
					},
					score: r.score || 0.5,
					source: 'web_search',
				}));
			} else if (provider === 'serpapi') {
				const url = new URL('https://serpapi.com/search');
				url.searchParams.set('api_key', key);
				url.searchParams.set('q', query.slice(0, 400));
				url.searchParams.set('num', '5');
				const resp = await fetch(url.toString());
				if (!resp.ok) return [];
				const data = await resp.json();
				results = (data.organic_results || []).map((r, i) => ({
					node: {
						_id: `web_search/${encodeURIComponent(r.link || r.title || i)}`,
						content: `${r.title || ''}\n\n${r.snippet || ''}`.trim().slice(0, 2000),
						title: r.title || '',
						url: r.link || '',
						document_id: null,
						entity_slugs: [],
						_type: 'web_result',
					},
					score: 1 - (i * 0.1),
					source: 'web_search',
				}));
			}
			return results.filter(r => r.node.content.trim());
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
					FILTER e.relation IN ["HAS_CHILD", "NEXT_SIBLING", "BELONGS_TO", "ADJACENT_TO", "NEXT_PARA"]
					FILTER v._id NOT IN @seen_ids
					RETURN { node: v, score: 1.0, source: "structural" }
			`, { startId: topNodeId, depth, seen_ids: [...seenIds] });
			return rows.filter(r => r.node && r.node._id);
		} catch (_) {
			return [];
		}
	}

	// ── Temporal Scoring ────────────────────────────────────────────────────────

	// Coverage overlap score: how well doc's temporal_coverage_start/end spans the query date range.
	// Returns [0, 1] — 1 = perfect overlap, 0 = no overlap or missing fields.
	_computeCoverageScore(doc, queryDateRange) {
		if (!queryDateRange || (!queryDateRange.from && !queryDateRange.to)) return 0;

		const covStart = _toDate(doc.document_coverage_start || doc.temporal_coverage_start);
		const covEnd   = _toDate(doc.document_coverage_end   || doc.temporal_coverage_end);
		const pubDate  = _toDate(doc.document_published_date || doc.published_date);

		// Fall back to published_date as point coverage when explicit range absent
		const docFrom = covStart || pubDate;
		const docTo   = covEnd   || pubDate;
		if (!docFrom && !docTo) return 0;

		const qFrom = _toDate(queryDateRange.from);
		const qTo   = _toDate(queryDateRange.to);

		// Treat open bounds as very early / very late
		const EPOCH = new Date('1000-01-01');
		const FAR   = new Date('3000-01-01');
		const dF = docFrom  || EPOCH;
		const dT = docTo    || FAR;
		const qF = qFrom    || EPOCH;
		const qT = qTo      || FAR;

		// No overlap
		if (dT < qF || dF > qT) return 0;

		const overlapMs  = Math.min(dT, qT) - Math.max(dF, qF);
		const querySpanMs = Math.max(qT - qF, 86400000); // at least 1 day to avoid div/0
		return Math.min(overlapMs / querySpanMs, 1.0);
	}

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

		// Layer 4+5: apply decay / coverage for weak candidates
		const doc = entry.node;
		const decayClass = doc.effective_decay_class || doc.document_effective_decay_class || doc.decay_class || 'SCHOLARLY';
		const rates = DECAY_RATES();
		const lambda = rates[decayClass] ?? rates.SCHOLARLY;
		const publishedDate = doc.published_date || doc.document_published_date || null;

		// T_coverage scoring — applies whenever a date range was extracted from the query,
		// regardless of temporal_intent. A document whose coverage span overlaps the query
		// window is boosted; one that doesn't may still score via decay.
		const dateRange = processedQuery.dateRange || {};
		const coverageScore = (dateRange.from || dateRange.to)
			? this._computeCoverageScore(doc, dateRange)
			: 0;

		if (temporalIntent === 'historical_fact') {
			// Combine: coverage overlap (primary) + age authority (secondary fallback).
			// A 1929 newspaper covering 1929 scores near-1 via coverage.
			// If no coverage dates stored, fall back to age authority (old = higher score).
			const AGE_AUTHORITY_LAMBDA = 0.000274; // ≈ 1/10yr half-life
			const Δdays = publishedDate
				? (Date.now() - Date.parse(publishedDate)) / 86400000
				: null;
			const ageScore = (Δdays != null && !isNaN(Δdays) && Δdays >= 0)
				? 1 - Math.exp(-AGE_AUTHORITY_LAMBDA * Δdays)
				: 0;
			// Coverage dominates (0.7) when available; age authority fills in (0.3)
			const combined = coverageScore > 0
				? 0.7 * coverageScore + 0.3 * ageScore
				: ageScore;
			return temporalWeight * combined;
		}

		// current_state / influence_chain: standard decay (new = high score)
		// Coverage bonus added on top when query has an explicit date window
		if (!publishedDate) return coverageScore > 0 ? temporalWeight * 0.5 * coverageScore : 0;
		const Δdays = (Date.now() - Date.parse(publishedDate)) / 86400000;
		if (isNaN(Δdays) || Δdays < 0) return 0;
		const decayScore = Math.exp(-lambda * Δdays);
		return temporalWeight * (decayScore + 0.3 * coverageScore);
	}

	// ── Phase 5 — Score Fusion ───────────────────────────────────────────────────

	_fuseResults(bm25, sumo, entity, crossDoc, struct, weights, vector = [], answersSame = [], cluster = []) {
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

		add(bm25,        weights.bm25,        'fulltext');
		add(sumo,        weights.sumo,        'sumo');
		add(entity,      weights.entity,      'entity_pivot');
		add(crossDoc,    weights.crossDoc,    'cross_doc_edge');
		add(struct,      weights.struct,      'structural');
		add(vector,      weights.vector,      'vector');
		add(answersSame, weights.answersSame ?? 0.5, 'answers_same');
		add(cluster,     weights.cluster     ?? 0.6, 'cluster_summary');

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

		// Principal: ≥2 phase contributions + top-quartile score.
		// Cross-doc diversity (docDiversity >= 2) is a bonus qualifier but not required —
		// small corpora rarely produce cross-doc hits, yet multi-phase agreement is itself
		// strong corroboration. Set OHARA_PRINCIPAL_REQUIRE_MULTI_DOC=true to restore strict rule.
		const requireMultiDoc = process.env.OHARA_PRINCIPAL_REQUIRE_MULTI_DOC === 'true';
		const principal = fused
			.filter(e => e.contributions.length >= 2
				&& (!requireMultiDoc || docDiversity(e) >= 2 || e.sources.includes('cross_doc_edge'))
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

		// E2: flag Principal nodes that have incoming CONTRADICTS edges
		await Promise.all(principal.map(async (entry) => {
			if (!entry.node?._id) return;
			try {
				const rows = await this.db.executeAQL(`
					FOR e IN edges
						FILTER e._to == @nodeId AND e.relation == "CONTRADICTS"
						LIMIT 1
						RETURN { contradiction_note: e.contradiction_note }
				`, { nodeId: entry.node._id });
				if (rows.length > 0) {
					entry.integrity_flags = entry.integrity_flags || [];
					entry.integrity_flags.push('contradicted');
					if (rows[0].contradiction_note) entry.contradiction_note = rows[0].contradiction_note;
				}
			} catch (_) {}
		}));

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
			const principalNodeIds = principal.map(e => e.node._id).filter(Boolean);
			const principalEntitySlugsForFrontier = [...new Set(principal.flatMap(e => e.node?.entity_slugs || []))].slice(0, 20);
			const crossDocLimit = options.crossDocLimit
				?? parseInt(process.env.OHARA_CROSS_DOC_LIMIT || '5', 10);
			const expandDepth = (options.expandDepth ?? parseInt(process.env.OHARA_CROSS_DOC_EXPAND_DEPTH || '1', 10)) + 1;
			const frontierSeen = new Set([...seenIds, ...integrityIds]);

			// Original: SIMILAR_TO cross-doc hops
			const crossDocFrontier = await this._phase1cCrossDocEdge(processedQuery, principalSeeds, frontierSeen, crossDocLimit, expandDepth);

			// ANSWERS_SAME frontier: paragraphs sharing pseudo-questions with principal nodes
			let answersSameFrontier = [];
			if (principalNodeIds.length > 0) {
				try {
					answersSameFrontier = await this.db.executeAQL(`
						FOR e IN edges
							FILTER e._from IN @node_ids AND e.relation == "ANSWERS_SAME"
							FOR p IN paragraphs
								FILTER p._id == e._to AND p._id NOT IN @seen_ids
								LIMIT @limit
								RETURN { node: p, score: 0.4, source: "answers_same_frontier", shared_query: e.shared_query, edge_verb: "answers same question as", hops: 1 }
					`, { node_ids: principalNodeIds, seen_ids: [...frontierSeen], limit: crossDocLimit });
				} catch (_) {}
			}

			// ADAMIC_ADAR frontier: entities strongly co-cited with principal entities → their paragraphs
			let aaFrontier = [];
			if (principalEntitySlugsForFrontier.length > 0) {
				try {
					aaFrontier = await this.db.executeAQL(`
						LET query_entity_ids = (FOR e IN entities FILTER e.slug IN @slugs RETURN e._id)
						FOR aa_edge IN edges
							FILTER aa_edge._from IN query_entity_ids AND aa_edge.relation == "ADAMIC_ADAR" AND aa_edge.weight >= 0.5
							FOR mention IN edges
								FILTER mention._to == aa_edge._to AND mention.relation == "MENTIONS"
								FOR p IN paragraphs
									FILTER p._id == mention._from AND p._id NOT IN @seen_ids
									SORT aa_edge.weight DESC
									LIMIT @limit
									RETURN { node: p, score: aa_edge.weight * 0.4, source: "adamic_adar_frontier", edge_verb: "co-cited with", hops: 2 }
					`, { slugs: principalEntitySlugsForFrontier, seen_ids: [...frontierSeen], limit: crossDocLimit });
				} catch (_) {}
			}

			// COMMUNITY_MEMBER frontier: other entities in same community → their paragraphs
			let communityFrontier = [];
			if (principalEntitySlugsForFrontier.length > 0) {
				try {
					communityFrontier = await this.db.executeAQL(`
						LET query_entity_ids = (FOR e IN entities FILTER e.slug IN @slugs RETURN e._id)
						FOR cm IN edges
							FILTER cm._from IN query_entity_ids AND cm.relation == "COMMUNITY_MEMBER"
							FOR cm2 IN edges
								FILTER cm2._to == cm._to AND cm2.relation == "COMMUNITY_MEMBER" AND cm2._from NOT IN query_entity_ids
								FOR mention IN edges
									FILTER mention._to == cm2._from AND mention.relation == "MENTIONS"
									FOR p IN paragraphs
										FILTER p._id == mention._from AND p._id NOT IN @seen_ids
										LIMIT @limit
										RETURN { node: p, score: 0.35, source: "community_frontier", edge_verb: "in same topic community as", hops: 2 }
					`, { slugs: principalEntitySlugsForFrontier, seen_ids: [...frontierSeen], limit: crossDocLimit });
				} catch (_) {}
			}

			const allFrontierResults = [...crossDocFrontier, ...answersSameFrontier, ...aaFrontier, ...communityFrontier];
			frontier = allFrontierResults
				.filter(r => (r.score || 0) >= explorerStopWeight && (r.score || 0) < integrityWeightMin)
				.map(r => ({
					document_id: r.node?.document_id,
					node_id: r.node?._id,
					edge_verb: r.edge_verb,
					edge_summary: r.edge_summary,
					shared_query: r.shared_query,
					score: r.score,
					hops: r.hops,
					source: r.source || 'cross_doc_edge',
				}));
			stoppedReason = frontier.length ? 'weight_below_threshold' : 'no_candidates_in_band';
		}

		// E6: Knowledge Gap cards — isolated entities surface in Explorer
		let knowledgeGaps = [];
		try {
			const gapEntities = await this.db.executeAQL(`
				FOR e IN entities
					FILTER e.isolated == true
					LIMIT 10
					RETURN { name: e.name, slug: e.slug, isolation_reason: e.isolation_reason }
			`, {});
			knowledgeGaps = gapEntities.map(e => ({
				type: 'knowledge_gap',
				entity_name: e.name,
				entity_slug: e.slug,
				reason: e.isolation_reason || 'No connecting documents found',
				hint: `Ingest documents related to "${e.name}" to connect this knowledge island`,
			}));
		} catch (_) {}

		// E8: Unexpected Connection cards — cross-community RELATED_TO edges near principal nodes
		let unexpectedConnections = [];
		try {
			const principalEntitySlugs = [...new Set(
				principal.flatMap(e => e.node?.entity_slugs || [])
			)].slice(0, 15);
			if (principalEntitySlugs.length > 0) {
				const surprising = await this.db.executeAQL(`
					LET slugs = @slugs
					FOR e IN entities
						FILTER e.slug IN slugs
						FOR rel IN edges
							FILTER rel._from == e._id AND rel.relation == "RELATED_TO" AND rel.is_surprising == true
							FOR other IN entities
								FILTER other._id == rel._to
								LIMIT 5
								RETURN { from_name: e.name, from_slug: e.slug, to_name: other.name, to_slug: other.slug }
				`, { slugs: principalEntitySlugs });
				unexpectedConnections = surprising.map(r => ({
					type: 'unexpected_connection',
					from_entity: r.from_name,
					from_slug: r.from_slug,
					to_entity: r.to_name,
					to_slug: r.to_slug,
					hint: `"${r.from_name}" and "${r.to_name}" are connected despite belonging to different topic communities`,
				}));
			}
		} catch (_) {}

		return {
			principal: principal.map(e => ({ node: e.node, score: e.score, sources: e.sources })),
			integrity,
			explorer: { frontier, stopped_reason: stoppedReason, knowledge_gaps: knowledgeGaps, unexpected_connections: unexpectedConnections },
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
					`FOR d IN documents
					FILTER d._key IN @ids OR d._id IN @ids
					RETURN d`,
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
					`FOR s IN sections
					FILTER s._id IN @ids
					RETURN s`,
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

		const sessionHistory = Array.isArray(options.sessionHistory) ? options.sessionHistory : [];
		const processedQuery = await this.preprocessInput(rawInput, sessionHistory);
		const queryMode = this._detectQueryMode(rawInput); // 'factoid' | 'synthesis' | 'exploratory'

		// Adaptive weights: base × mode multiplier (disabled via OHARA_ADAPTIVE_WEIGHTS=false)
		const adaptiveEnabled = process.env.OHARA_ADAPTIVE_WEIGHTS !== 'false';
		const base = w();
		const mults = adaptiveEnabled ? (ADAPTIVE_MULTIPLIERS[queryMode] || ADAPTIVE_MULTIPLIERS.factoid) : null;
		const weights = {
			...(mults ? Object.fromEntries(Object.entries(base).map(([k, v]) => [k, v * (mults[k] ?? 1)])) : base),
			...(options.crossDocWeight != null ? { crossDoc: options.crossDocWeight } : {}),
		};

		let bm25Results = await this._phase1BM25(processedQuery, limit);

		// Reasoning RAG: generate sub-queries from BM25 gaps, merge results before Phase 1b
		const reasoningEnabled = options.reasoningRag ?? (process.env.OHARA_REASONING_RAG === 'true');
		if (reasoningEnabled && !options._speculative && bm25Results.length > 0) {
			const subqueries = await this._generateSubqueries(rawInput, bm25Results);
			if (subqueries.length) {
				const subResults = await Promise.all(
					subqueries.map(sq => this._phase1BM25({ ...processedQuery, keywords: this._tokenize(sq), raw: sq }, Math.ceil(limit / 2)))
				);
				const seenIds = new Set(bm25Results.map(r => r.node._id));
				for (const sub of subResults.flat()) {
					if (!seenIds.has(sub.node._id)) { bm25Results.push(sub); seenIds.add(sub.node._id); }
				}
			}
		}

		const sumoResults   = await this._phase2SUMO(processedQuery, bm25Results, limit);

		const seenAfterPhase2 = new Set([
			...bm25Results.map(r => r.node._id),
			...sumoResults.map(r => r.node._id),
		]);

		const crossDocLimit = options.crossDocLimit || parseInt(process.env.OHARA_CROSS_DOC_LIMIT || '5', 10);
		const expandDepth = options.expandDepth || parseInt(process.env.OHARA_CROSS_DOC_EXPAND_DEPTH || '1', 10);
		const vectorLimit = options.vectorLimit || parseInt(process.env.OHARA_VECTOR_LIMIT || '10', 10);
		const answersSameEnabled = options.answersSame ?? (process.env.OHARA_ANSWERS_SAME === 'true');
		const clusterEnabled = options.clusterRetrieval ?? (process.env.OHARA_CLUSTER_RETRIEVAL === 'true');
		const clusterActive = clusterEnabled && (queryMode === 'synthesis' || queryMode === 'exploratory');
		const [entityResults, crossDocResults, vectorResults, answersSameResults, clusterResults] = await Promise.all([
			this._phase3EntityPivot(processedQuery, bm25Results, seenAfterPhase2, limit),
			this._phase1cCrossDocEdge(processedQuery, bm25Results, seenAfterPhase2, crossDocLimit, expandDepth),
			this._phase1dVector(processedQuery, vectorLimit),
			answersSameEnabled ? this._phase1eAnswersSame(bm25Results, seenAfterPhase2, Math.ceil(limit / 2)) : Promise.resolve([]),
			clusterActive ? this._phase1fCluster(processedQuery, seenAfterPhase2, Math.ceil(limit / 2)) : Promise.resolve([]),
		]);

		// Phase 0b: TOC-guided section selection for phrase/paragraph queries
		let tocGuidedSectionIds = [];
		const tocGuidanceEnabled = process.env.OHARA_TOC_GUIDANCE !== 'false';
		if (tocGuidanceEnabled && processedQuery.inputType !== 'keyword' && bm25Results.length > 0) {
			const seedDocIds = [...new Set(bm25Results.slice(0, 3).map(r => r.node?.document_id).filter(Boolean))];
			tocGuidedSectionIds = await this._phase0bTocGuidance(rawInput, seedDocIds);
		}

		const topNodeId = bm25Results[0]?.node?._id;
		const seenAfterPhase3 = new Set([
			...seenAfterPhase2,
			...entityResults.map(r => r.node._id),
			...crossDocResults.map(r => r.node._id),
			...vectorResults.map(r => r.node._id),
			...answersSameResults.map(r => r.node._id),
			...clusterResults.map(r => r.node._id),
		]);
		let structResults = await this._phase4Structural(topNodeId, depth, seenAfterPhase3);

		// Augment structural results with TOC-guided entry points (each selected section traversed)
		if (tocGuidedSectionIds.length > 0) {
			const tocStructPromises = tocGuidedSectionIds
				.filter(id => id !== topNodeId)
				.map(id => this._phase4Structural(id, depth, seenAfterPhase3));
			const tocStructBatches = await Promise.all(tocStructPromises);
			for (const batch of tocStructBatches) {
				for (const r of batch) {
					if (!seenAfterPhase3.has(r.node._id)) {
						structResults.push({ ...r, source: 'toc_guided_structural' });
						seenAfterPhase3.add(r.node._id);
					}
				}
			}
		}

		// Corrective RAG: drop structural nodes with zero SUMO overlap when query has hints.
		// TOC-guided structural nodes are exempt — Gemini already validated their relevance via section summary.
		const correctiveEnabled = process.env.OHARA_CORRECTIVE_STRUCT !== 'false';
		const queryHints = processedQuery.sumoHints;
		if (correctiveEnabled && Array.isArray(queryHints) && queryHints.length > 0) {
			const sumoSet = new Set(queryHints);
			structResults = structResults.filter(r =>
				r.source === 'toc_guided_structural' ||
				(r.node?.sumo_tags || []).some(t => sumoSet.has(t))
			);
		}

		const fused = this._fuseResults(bm25Results, sumoResults, entityResults, crossDocResults, structResults, weights, vectorResults, answersSameResults, clusterResults);

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

		// Self-RAG: optional Gemini responsiveness filter on Principal tier
		const selfRagEnabled = options.selfRagVerify ?? (process.env.OHARA_SELF_RAG_VERIFY === 'true');
		if (selfRagEnabled && tiers.principal?.length) {
			tiers.principal = await this._selfRagFilter(rawInput, tiers.principal);
		}

		// Re-ranker: Gemini cross-encoder pass on Principal tier (opt-in)
		const rerankEnabled = options.rerank ?? (process.env.OHARA_RERANK === 'true');
		if (rerankEnabled && tiers.principal?.length > 1) {
			tiers.principal = await this._rerankWithGemini(rawInput, tiers.principal);
		}

		const response = {
			processedQuery,
			queryMode,
			weights,
			results: topK,
			tiers,
			// legacy fields for backwards compat with existing server routes
			shallowResults: bm25Results,
			entityPivotResults: entityResults,
			crossDocResults,
			deepResults: structResults.map(r => r.node),
		};

		// Speculative RAG: background pre-warm of Explorer frontier for likely follow-up queries
		if (process.env.OHARA_SPECULATIVE_RAG === 'true' && !options._speculative) {
			const specLimit = parseInt(process.env.OHARA_SPECULATIVE_LIMIT || '3', 10);
			const frontier = tiers.explorer?.frontier?.slice(0, specLimit) || [];
			if (frontier.length) {
				const queryHash = cacheKeyFor([rawInput]);
				for (const f of frontier) {
					const specKey = `SPECULATIVE:${queryHash}:${f.document_id || f.node_id || ''}`;
					if (!readCacheSync(specKey)) {
						const speculativeQuery = [f.edge_verb, f.edge_summary].filter(Boolean).join(': ') || rawInput;
						this.query(speculativeQuery, { ...options, _speculative: true }).then(r => {
							writeCache(specKey, r);
						}).catch(() => {});
					}
				}
			}
		}

		return response;
	}

	async getDeepContext(targetNodeId, _edgeTypes, options = {}) {
		const depth = options.depth || 2;
		return this._phase4Structural(targetNodeId, depth, new Set());
	}

	// Agentic RAG: Gemini picks retrieval tool each iteration based on what's been found so far
	async queryAgent(rawInput, options = {}) {
		const limit = options.limit || parseInt(process.env.OHARA_RESULT_LIMIT || '20', 10);
		const maxIter = parseInt(process.env.OHARA_AGENT_MAX_ITER || '4', 10);
		const sessionHistory = Array.isArray(options.sessionHistory) ? options.sessionHistory : [];

		const processedQuery = await this.preprocessInput(rawInput, sessionHistory);
		const merged = new Map(); // _id → entry
		const toolHistory = [];
		const agentTrace = []; // [{tool, added}] per iteration

		const _mergeIn = (entries, tag) => {
			let added = 0;
			for (const e of entries) {
				const id = e.node?._id;
				if (!id) continue;
				if (!merged.has(id)) { added++; }
				if (!merged.has(id) || merged.get(id).score < e.score) {
					merged.set(id, { ...e, agent_tool: tag });
				}
			}
			agentTrace.push({ tool: tag, added });
		};

		for (let iter = 0; iter < maxIter; iter++) {
			const foundCount = merged.size;
			const topSnippets = [...merged.values()]
				.sort((a, b) => b.score - a.score)
				.slice(0, 5)
				.map(e => e.node?.content?.slice(0, 120) || '')
				.filter(Boolean);

			// Ask Gemini which tool to use next
			const strategyKey = cacheKeyFor(['agent_strategy', rawInput, toolHistory.join(','), foundCount]);
			let strategyRaw = readCacheSync(strategyKey);
			if (!strategyRaw) {
				try {
					const ai = this._getAI();
					const webSearchAvailable = process.env.OHARA_WEB_SEARCH === 'true' && !!process.env.OHARA_WEB_SEARCH_KEY;
					const prompt = [
						AGENT_STRATEGY_PROMPT,
						`\nQuery: ${rawInput}`,
						`Found so far (${foundCount} nodes): ${topSnippets.join(' | ') || 'none'}`,
						`Tools used: ${toolHistory.join(', ') || 'none'}`,
						`web_search_available: ${webSearchAvailable}`,
					].join('\n');
					const res = await ai.models.generateContent({
						model: GEMINI_MODEL,
						contents: [{ role: 'user', parts: [{ text: prompt }] }],
						config: { temperature: 0, thinkingConfig: { thinkingBudget: 0 } },
					});
					strategyRaw = res.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '{"tool":"done","reason":"no response"}';
					writeCache(strategyKey, strategyRaw);
				} catch {
					break;
				}
			}

			let strategy;
			try {
				const m = strategyRaw.match(/\{[\s\S]*\}/);
				strategy = JSON.parse(m ? m[0] : strategyRaw);
			} catch { break; }

			const tool = strategy.tool;
			if (!tool || tool === 'done' || toolHistory.includes(tool)) break;
			toolHistory.push(tool);

			const seenIds = new Set(merged.keys());

			if (tool === 'bm25') {
				const hint = strategy.hint || rawInput;
				const pq = hint !== rawInput ? { ...processedQuery, keywords: this._tokenize(hint), raw: hint } : processedQuery;
				_mergeIn(await this._phase1BM25(pq, limit), 'bm25');
			} else if (tool === 'entity_pivot') {
				const bm25Base = [...merged.values()].filter(e => e.agent_tool === 'bm25' || e.sources?.includes('bm25'));
				_mergeIn(await this._phase3EntityPivot(processedQuery, bm25Base.length ? bm25Base : [...merged.values()], seenIds, limit), 'entity_pivot');
			} else if (tool === 'cross_doc') {
				const base = [...merged.values()];
				_mergeIn(await this._phase1cCrossDocEdge(processedQuery, base, seenIds, limit, 1), 'cross_doc');
			} else if (tool === 'structural') {
				const topId = [...merged.values()].sort((a, b) => b.score - a.score)[0]?.node?._id;
				if (topId) _mergeIn(await this._phase4Structural(topId, 2, seenIds), 'structural');
			} else if (tool === 'web_search') {
				const webResults = await this._webSearch(strategy.hint || rawInput);
				_mergeIn(webResults, 'web_search');
			}
		}

		const allResults = [...merged.values()].sort((a, b) => b.score - a.score).slice(0, limit);
		const crossDocFromMerged = allResults.filter(r => r.agent_tool === 'cross_doc' || r.sources?.includes('cross_doc_edge'));
		const seenAgentIds = new Set(allResults.map(r => r.node?._id).filter(Boolean));
		const tiers = await this._classifyTiers(allResults, processedQuery, crossDocFromMerged, 2, seenAgentIds, options);

		return {
			processedQuery,
			results: allResults,
			shallowResults: allResults,
			tiers,
			agent_tool_history: toolHistory,
			agent_trace: agentTrace,
		};
	}

	// Chain-of-Retrieval: iteratively chase Explorer frontier to surface deep multi-hop knowledge
	async queryCoR(rawInput, options = {}) {
		const maxIter = parseInt(process.env.OHARA_COR_MAX_ITER || '2', 10);
		const scoreDelta = parseFloat(process.env.OHARA_COR_SCORE_DELTA || '0.05');

		const merged = new Map(); // _id → fused entry (keep max score)
		let currentQuery = rawInput;
		let prevTopScore = 0;
		let firstProcessedQuery = null;
		let lastTiers = null;

		for (let iter = 0; iter < maxIter; iter++) {
			const result = await this.query(currentQuery, options);
			if (iter === 0) firstProcessedQuery = result.processedQuery;
			lastTiers = result.tiers;

			// Merge results (dedup by _id, keep max score)
			for (const entry of result.results || []) {
				const id = entry.node?._id;
				if (!id) continue;
				if (!merged.has(id) || merged.get(id).score < entry.score) {
					merged.set(id, { ...entry, cor_iter: iter });
				}
			}

			// Stop if Explorer has no frontier to chase
			const frontier = result.tiers?.explorer?.frontier || [];
			if (!frontier.length) break;

			// Build augmented query from top frontier signals
			const seeds = frontier.slice(0, 3)
				.map(f => [f.edge_verb, f.edge_summary].filter(Boolean).join(': '))
				.filter(Boolean);
			if (!seeds.length) break;

			// Stop if top score hasn't improved meaningfully
			const topScore = [...merged.values()].reduce((m, e) => Math.max(m, e.score), 0);
			if (iter > 0 && topScore - prevTopScore < scoreDelta) break;
			prevTopScore = topScore;

			currentQuery = `${rawInput} [context: ${seeds.join('; ')}]`;
		}

		const allResults = [...merged.values()].sort((a, b) => b.score - a.score);
		return {
			processedQuery: { ...(firstProcessedQuery || { raw: rawInput }), cor: true, iterations: maxIter },
			results: allResults,
			shallowResults: allResults,
			tiers: lastTiers || { principal: [], integrity: [], explorer: { frontier: [], stopped_reason: 'no_data' } },
			cor_iter_count: maxIter,
		};
	}
}
