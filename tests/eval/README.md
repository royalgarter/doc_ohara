# Paper Experiments — Eval Harness

Implements the TODO.md experiment plan (MultiHop-RAG + QASPER, config matrix, < $25 budget).
Nothing here triggers LLM calls until the **ingest** step — review before running that.

## Pipeline

```sh
# 1. Download datasets (no LLM, ~50 MB)
bash tests/eval/download_datasets.sh

# 2. Prepare markdown into doc_pipeline/input/ + manifests (no LLM)
node tests/eval/prepare_multihop.js            # 609 news articles → mhrag_*.md
node tests/eval/prepare_qasper.js --count=200  # 200 papers → qasper_*.md (seeded sample)

# 3. Build stratified query sets → eval/*.json (no LLM)
node tests/eval/build_query_set.js             # 125/type MultiHop + 150 QASPER

# ── REVIEW POINT — everything below costs money ──────────────────────────────

# 4. Ingest (LLM: gemini-2.5-flash-lite; ~$1–3 for MultiHop, ~$2–4 for QASPER)
#    Smoke test 3 docs first, check cost in llm_usage, then loop the rest:
for f in doc_pipeline/input/mhrag_*.md;  do npm run ohara -- ingest "$(basename "$f")"; done
for f in doc_pipeline/input/qasper_*.md; do npm run ohara -- ingest "$(basename "$f")"; done

# 5. Fix gold dates on news docs (no LLM, direct AQL update)
node --env-file=.env tests/eval/set_published_dates.js --dry-run
node --env-file=.env tests/eval/set_published_dates.js

# 6. (optional) embeddings for vector configs — Cloudflare embeddinggemma-300m
node --env-file=.env scripts/backfill-embeddings.js

# 7. Run config matrix (query-time LLM only for phrase fingerprinting; cached)
node --env-file=.env tests/eval/run_matrix.js --input=eval/multihop_queries.json --limit=20  # smoke
node --env-file=.env tests/eval/run_matrix.js --input=eval/multihop_queries.json
node --env-file=.env tests/eval/run_matrix.js --input=eval/qasper_queries.json --configs=full,no_toc,bm25_only,vector_only
```

## Configs (run_matrix.js)

| name | meaning |
|---|---|
| bm25_only | lexical floor — all other weights zeroed |
| vector_only | vanilla vector RAG baseline |
| full | OHARA full pipeline (env defaults) |
| no_sumo / no_crossdoc / no_temporal / no_toc | phase ablations (§4.13, §7.3) |
| no_corroboration | Principal = plain top-5, no ≥2-phase constraint (§4.13.4) |

## Scoring

- **MultiHop-RAG**: doc-level. Hit = retrieved node's parent document title ∈ gold `evidence_list` titles. Metrics: Hits@4/10, MRR@10, MAP@10, gold-doc Recall@10.
- **QASPER**: paragraph-level. Hit = retrieved paragraph text overlaps a gold evidence snippet.
- **Both**: Principal-tier hit rate; null-query abstention rate (Principal empty on unanswerable queries).
- Temporal-slice analysis: filter report `by_type.temporal_query`, compare `full` vs `no_temporal`.

## Cost guards

- Ingest once; matrix re-runs only change env weights → cache-hot, near-zero marginal LLM cost.
- Check SIMILAR_TO edge count after ingest, BEFORE any enrichment backfill: `npm run admin:docs`.
- Batch/flex tier + `.ohara_llm_cache/` already in pipeline.

## Files

- `download_datasets.sh` — fetch corpora (idempotent)
- `prepare_multihop.js` / `prepare_qasper.js` — corpus → `doc_pipeline/input/*.md` + manifest (no ingest)
- `build_query_set.js` — stratified query sets → `eval/`
- `set_published_dates.js` — gold dates → documents collection (post-ingest)
- `run_matrix.js` — config matrix runner → `eval/matrix_*.json`
- `data/` — downloaded corpora + manifests (gitignored)
