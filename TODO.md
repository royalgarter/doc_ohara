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
