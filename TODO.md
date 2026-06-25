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
