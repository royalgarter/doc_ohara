TODO — short list from 2026-06-22

Notes captured for follow-up (left for review tomorrow):

- [x] Enrich refs/sumo_index.json: include more SUMO labels, aliases and common local-name variants to reduce false negatives during validation.
      → Generated from refs/SUMO.owl via `node scripts/sumo.js` (4 538 entries). Added ALIASES table in src/sumo_index.js for common LLM-emitted terms (bitcoin, transaction, agent, etc.)

- [x] Relax SUMO validation: implement case-insensitive / partial-match / alias mapping or fuzzy lookup to accept near-matches.
      → src/sumo_index.js: new `resolveTag()` with 3-level resolution (exact → separator-insensitive → alias table). `validateTags` now returns `resolved_map` showing alias rewrites.

- [x] Preserve provenance: store original `sumo_candidate_tags` alongside validated `sumo_tags` in persisted records for audit and manual review.
      → src/pipeline_runner.js: original LLM tags kept as `sumo_candidate_tags_raw`; alias rewrites stored in `sumo_resolved_map`.

- [x] Improve LLM repair & logging: surface raw LLM outputs and repair attempts in admin UI / logs; add per-chunk diagnostics export.
      → src/pipeline_runner.js: per-run diagnostics JSON written to `doc_pipeline/diagnostics/<filename>_<ts>.json` with per-chunk outcome, raw output, repair attempts, cache hits.

- [x] Add integration test: ingest sample doc and assert sumo_tags present and validated; add unit tests for sumo_index builder.
      → tests/ingest.test.js (15 tests, 4 suites). Run: `npm test`. Covers sumo_index, markdown_chunker, preflight check, ArangoDBSimulator.

- [x] Add admin query scripts: quick AQL queries to inspect persisted documents, sections, and tag coverage.
      → scripts/admin_queries.js. Run: `npm run admin [query]`
        queries: docs | sections | tags | tag-coverage | missing-tags | repair-stats | all

---

TODO — 2026-06-25: Query-Time SUMO + Entity Fingerprint Extraction

Goal: Make Phase 1b (SUMO expansion) and Phase 2 (entity pivot) work reliably for
keyword and phrase queries — not just long paragraph queries (> 30 tokens).

Background: `sumoHints` and `entityHints` are only populated when the query is classified
as `paragraph` (> 30 tokens). For most real queries, both are empty and Phase 1b falls
back to tags harvested from BM25 results — a noisy indirect proxy.

- [x] 1. New prompt `prompts/extract_query_fingerprint.md`
      Lightweight Gemini prompt tuned for short query strings. Returns:
        { sumo_tags: [...], entities: [{ canonical, type, slug }] }
      Keep under 400 tokens. Do NOT reuse ingest_document.md (too heavy for queries).

- [x] 2. `src/retrieval.js` — lower extraction threshold + enrich entityHints
      - Fire _extractHintsWithGemini for `phrase` queries (4–30 tokens), not just `paragraph`
      - Switch to new extract_query_fingerprint.md prompt
      - entityHints → array of { slug, type } objects (currently just slugs)
      - Use src/cache.js so repeated identical queries skip Gemini

- [x] 3. `src/ingest/pipeline.js` — add entity_types to paragraph nodes
      During collection transform, alongside entity_slugs, build parallel entity_types array:
        node.entity_slugs = node.entities.map(e => e.slug);
        node.entity_types = node.entities.map(e => e.type);  ← add this
      Backward-compatible: old paragraphs without entity_types score 0 on type-affinity.

- [x] 4. `src/retrieval.js` — improve Phase 1b AQL + scoring (_phase2SUMO)
      A) sumoSet is now query-derived first (not BM25-harvested fallback)
      B) Add entity type affinity boost: +0.2 × type_overlap / query_entity_count
      Updated AQL:
        LET tag_overlap  = LENGTH(INTERSECTION(p.sumo_tags, @sumo_tags))
        FILTER tag_overlap > 0
        LET type_overlap = LENGTH(INTERSECTION(p.entity_types || [], @entity_types))
        LET score = (tag_overlap / MAX([LENGTH(@sumo_tags), 1]))
                  + 0.2 * (type_overlap / MAX([LENGTH(@entity_types), 1]))

Verification:
  node bin/ohara.js query "proof of work energy"
  → logs must show sumoHints: [...] populated (currently [])
  → Phase 1b returns more results; same-query-twice hits cache

Out of scope: SUMO hierarchy distance (OWL parsing), dense embeddings, Phase 3/4 changes.

---

TODO — 2026-06-25: Time Dimension — Space-Time Graph

Full design in `refs/brainstorm_space_time.md`.

Goal: Add the Time axis to Doc Ohara. Each document gets temporal metadata (when published,
what period it covers) and an influence decay rate by document type. Retrieval scoring gains
a temporal component with five-layer protection against burying "gold" timeless articles.

### Phase A — Temporal Metadata (Schema + Ingest)

- [x] A1. `prompts/ingest_document.md` — add temporal extraction block
      Ask LLM to output at document level:
        published_date: "YYYY-MM-DD" or "YYYY" or null
        temporal_coverage: { start: "YYYY" | null, end: "YYYY" | null }
        temporal_granularity: 'day'|'month'|'year'|'decade'|'century'
        temporal_confidence: 0.0–1.0
        decay_class: 'EVERGREEN'|'SCHOLARLY'|'CURRENT'|'EPHEMERAL'
      (Same LLM call, extra JSON keys — no added API cost)

- [x] A2. `src/ingest/pipeline.js` — read and persist temporal fields
      At document node creation (steps 8 + 9), persist all fields from A1.
      Set temporal_needs_review: true (LLM-extracted, needs human confirm).
      Set effective_decay_class = decay_class (will be updated post-ingest in A4).
      Set similar_to_indegree: 0.

- [x] A3. `scripts/db-init.js` — add ArangoDB persistent index on published_date
      skiplist index on documents.published_date for range queries.

- [x] A4. `src/ingest/pipeline.js` — post-ingest decay class promotion
      After SIMILAR_TO edges are created (step 10):
        - Count incoming SIMILAR_TO edges for the new doc (similar_to_indegree)
        - If indegree > OHARA_SIMILAR_TO_EVERGREEN_THRESHOLD → set effective_decay_class = 'EVERGREEN'
      Also: for each new SIMILAR_TO edge, derive temporal_relation from verb field:
        'extends'/'builds on'/'is based on' → 'extends'
        'contradicts'/'supersedes'/'corrects'/'refutes' → 'supersedes'
        else → 'discusses'
      Store temporal_relation on the edge (no extra LLM call).

### Phase B — Temporal Scoring (Retrieval)

- [x] B1. `prompts/extract_query_fingerprint.md` — add temporal_intent field
      Add to LLM output:
        temporal_intent: 'current_state'|'historical_fact'|'influence_chain'|'none'
      If date entity detected in query → likely 'historical_fact'.
      If "latest"/"current"/"now"/"today" in query → 'current_state'.
      Default → 'none'.

- [x] B2. `src/retrieval.js` — _computeTemporalScore(node, queryIntent)
      Implement decay formula:
        if temporal_intent == 'none' → return 0
        if node.tier == 'principal' → return 0
        if node.bm25_score > TEMPORAL_GATE_FLOOR → return 0
        else → return OHARA_TEMPORAL_WEIGHT × exp(−λ × Δt)
      λ from env vars by effective_decay_class.
      Δt = (Date.now() − Date.parse(doc.published_date)) / 86400000

- [x] B3. `src/retrieval.js` — inject temporal score into _fuseResults
      After existing weighted sum, add temporal contribution per node.
      For 'historical_fact' queries: also compute coverage_score and add separately.
      New env vars: OHARA_TEMPORAL_WEIGHT, OHARA_TEMPORAL_GATE_FLOOR,
        OHARA_DECAY_RATE_EVERGREEN/SCHOLARLY/CURRENT/EPHEMERAL,
        OHARA_SIMILAR_TO_EVERGREEN_THRESHOLD.

### Phase C — Verification

- [x] C1. Ingest two documents on same topic:
        - news article (2024) → expect CURRENT decay class
        - textbook chapter (1995) → expect SCHOLARLY decay class
        → Ingested /tmp/news_article_2024.md (CURRENT, published_date=2024-03-15) and
          /tmp/textbook_chapter_1995.md (SCHOLARLY, published_date=1995). Both confirmed via AQL.
- [x] C2. Query "current best practices" → news article ranks higher (temporal_intent=current_state)
        → "current best practices bitcoin mining": news_article_2024.md ranks #1–4.
          temporal intent: current_state shown in CLI verbose header.
- [x] C3. Query "history of X in 1990s" → textbook ranks higher (temporal_intent=historical_fact, coverage match)
        → "history of proof of work cryptography in 1990s": textbook at #3 (Limitations of Early PoW Systems).
          temporal intent: historical_fact. With OHARA_TEMPORAL_GATE_FLOOR=30, textbook shows [fulltext+temporal].
- [x] C4. db.documents.toArray() shows published_date, decay_class, effective_decay_class populated
        → Confirmed via AQL: news=CURRENT/2024-03-15, textbook=SCHOLARLY/1995.
- [x] C5. node bin/ohara.js query "X" --tiers --verbose shows temporal_score in phase breakdown
        → [fulltext+temporal] source appears on 1995 textbook results for historical_fact query.
          Fixes applied: (a) BM25 AQL now joins document temporal fields onto result nodes;
          (b) OHARA_TEMPORAL_GATE_FLOOR default raised 0.5→5.0; (c) _extractHintsWithGemini
          early-return bug fixed (missing temporalIntent); (d) CLI now displays temporal intent header;
          (e) _computeTemporalScore uses document_effective_decay_class fallback field.

Out of scope: UI for manual decay_class override, PRECEDES edges (use AQL sort instead),
dense embedding similarity for temporal coverage matching.
