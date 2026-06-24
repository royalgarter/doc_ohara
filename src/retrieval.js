// Doc_Ohara: 5-Phase Hybrid Retrieval Engine
// Phase 0: input analysis + optional Gemini extraction (paragraph mode)
// Phase 1: ArangoSearch BM25 full-text
// Phase 2: SUMO tag expansion
// Phase 3: entity graph pivot
// Phase 4: structural graph traversal
// Phase 5: score fusion & dedup

import { GoogleGenAI } from '@google/genai';

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
    if (!ai) return { entityHints: [], sumoHints: [] };
    const prompt = `You are a semantic analysis assistant.
Given the following text, extract:
1. Named entities (persons, organizations, locations, technologies, concepts, events, amounts, dates).
2. SUMO ontology concept names that best describe the main topics (short local names like "Agent", "Process", "FinancialTransaction").

Return ONLY a JSON object in this format, no markdown:
{"entities": [{"name": "...", "type": "PERSON|ORG|LOCATION|DATE|TECH|AMOUNT|EVENT|CONCEPT"}], "sumo_tags": ["Tag1", "Tag2"]}

Text:
${rawInput.slice(0, 2000)}`;

    try {
      const result = await ai.models.generateContent({ model: GEMINI_MODEL, contents: prompt, config: { serviceTier: 'flex' } });
      const text = result.text?.trim() || '';
      const json = JSON.parse(text.replace(/^```json\s*/i, '').replace(/```\s*$/, ''));
      return {
        entityHints: (json.entities || []).map(e => e.name?.toLowerCase().replace(/\s+/g, '_')).filter(Boolean),
        sumoHints: (json.sumo_tags || []).filter(Boolean),
      };
    } catch (_) {
      return { entityHints: [], sumoHints: [] };
    }
  }

  async preprocessInput(rawInput) {
    const keywords = this._tokenize(rawInput);
    const inputType = this._classifyInput(keywords);

    let entityHints = [];
    let sumoHints = [];

    if (inputType === 'paragraph') {
      ({ entityHints, sumoHints } = await this._extractHintsWithGemini(rawInput));
    }

    return { keywords, raw: rawInput, inputType, entityHints, sumoHints };
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
          RETURN { node: doc, score: BM25(doc), source: "fulltext" }
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
    // Gather SUMO tags from hints + top BM25 results
    const sumoSet = new Set(processedQuery.sumoHints);
    for (const r of bm25Results.slice(0, 5)) {
      for (const t of (r.node.sumo_tags || [])) sumoSet.add(t);
    }
    if (sumoSet.size === 0) return [];
    const sumoTags = [...sumoSet];

    try {
      const rows = await this.db.executeAQL(`
        LET query_tags = @sumo_tags
        FOR p IN paragraphs
          LET overlap = LENGTH(INTERSECTION(p.sumo_tags, query_tags))
          FILTER overlap > 0
          SORT overlap DESC
          LIMIT @limit
          RETURN { node: p, score: overlap / LENGTH(query_tags), source: "sumo" }
      `, { sumo_tags: sumoTags, limit });
      return rows;
    } catch (_) {
      return [];
    }
  }

  // ── Phase 3 — Entity Graph Pivot ─────────────────────────────────────────────

  async _phase3EntityPivot(processedQuery, bm25Results, seenIds, limit) {
    // Gather entity slugs from hints + top BM25 result entity_slugs
    const slugSet = new Set(processedQuery.entityHints);
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

  async _phase1cCrossDocEdge(processedQuery, bm25Results, seenIds, limit) {
    const seedDocIds = [...new Set(
      bm25Results.slice(0, 5)
        .map(r => r.node?.document_id)
        .filter(Boolean)
        .map(id => id.startsWith('documents/') ? id : `documents/${id}`)
    )];
    if (seedDocIds.length === 0) return [];

    const slugSet = new Set(processedQuery.entityHints);
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
          FOR edge IN edges
            FILTER (edge._from == doc_id OR edge._to == doc_id)
              AND edge.relation == "SIMILAR_TO"
              AND (
                edge.weight > 0.3
                OR LENGTH(INTERSECTION(edge.tags, query_tags)) > 0
              )
            LET other_doc_id = (edge._from == doc_id ? edge._to : edge._from)
            FOR p IN paragraphs
              FILTER p.document_id == other_doc_id
                OR CONCAT("documents/", p.document_id) == other_doc_id
              FILTER p._id NOT IN @seen_ids
              FILTER LENGTH(entity_slugs) == 0 OR LENGTH(INTERSECTION(p.entity_slugs, entity_slugs)) > 0
              SORT LENGTH(INTERSECTION(p.entity_slugs, entity_slugs)) DESC
              LIMIT @limit
              RETURN {
                node: p,
                score: edge.weight,
                source: "cross_doc_edge",
                edge_verb: edge.verb,
                edge_summary: edge.summary
              }
      `, { seed_doc_ids: seedDocIds, entity_slugs: entitySlugs, query_tags: queryTags, seen_ids: [...seenIds], limit });
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

  // ── Phase 5 — Score Fusion ───────────────────────────────────────────────────

  _fuseResults(bm25, sumo, entity, crossDoc, struct, weights) {
    const scoreMap = new Map(); // _id → { node, score, sources, edge_verb }

    const add = (results, weight, phase) => {
      for (const r of results) {
        const id = r.node?._id;
        if (!id) continue;
        const cur = scoreMap.get(id);
        if (cur) {
          cur.score += weight * r.score;
          cur.sources.push(phase);
        } else {
          const entry = { node: r.node, score: weight * r.score, sources: [phase] };
          if (r.edge_verb) entry.edge_verb = r.edge_verb;
          if (r.edge_summary) entry.edge_summary = r.edge_summary;
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
    const weights = w();

    const processedQuery = await this.preprocessInput(rawInput);

    const bm25Results   = await this._phase1BM25(processedQuery, limit);
    const sumoResults   = await this._phase2SUMO(processedQuery, bm25Results, limit);

    const seenAfterPhase2 = new Set([
      ...bm25Results.map(r => r.node._id),
      ...sumoResults.map(r => r.node._id),
    ]);

    const crossDocLimit = parseInt(process.env.OHARA_CROSS_DOC_LIMIT || '5', 10);
    const [entityResults, crossDocResults] = await Promise.all([
      this._phase3EntityPivot(processedQuery, bm25Results, seenAfterPhase2, limit),
      this._phase1cCrossDocEdge(processedQuery, bm25Results, seenAfterPhase2, crossDocLimit),
    ]);

    const topNodeId = bm25Results[0]?.node?._id;
    const seenAfterPhase3 = new Set([
      ...seenAfterPhase2,
      ...entityResults.map(r => r.node._id),
      ...crossDocResults.map(r => r.node._id),
    ]);
    const structResults = await this._phase4Structural(topNodeId, depth, seenAfterPhase3);

    const fused = this._fuseResults(bm25Results, sumoResults, entityResults, crossDocResults, structResults, weights);
    const topK = fused.slice(0, limit);

    return {
      processedQuery,
      results: topK,
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
