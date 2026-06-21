TODO — short list from 2026-06-22

Notes captured for follow-up (left for review tomorrow):

- [ ] Enrich refs/sumo_index.json: include more SUMO labels, aliases and common local-name variants to reduce false negatives during validation.
- [ ] Relax SUMO validation: implement case-insensitive / partial-match / alias mapping or fuzzy lookup to accept near-matches.
- [ ] Preserve provenance: store original `sumo_candidate_tags` alongside validated `sumo_tags` in persisted records for audit and manual review.
- [ ] Improve LLM repair & logging: surface raw LLM outputs and repair attempts in admin UI / logs; add per-chunk diagnostics export.
- [ ] Add integration test: ingest sample doc and assert sumo_tags present and validated; add unit tests for sumo_index builder.
- [ ] Add admin query scripts: quick AQL queries to inspect persisted documents, sections, and tag coverage.

I'll review these items tomorrow.
