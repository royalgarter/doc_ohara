# Baseline Comparisons — LightRAG / HippoRAG

Answers reviewer critique #8 (CRITICS.md): OHARA cites GraphRAG/LightRAG/HippoRAG in Table 1
capability comparison but never runs them. Web search confirms no published numbers cover
QASPER or MultiHop-RAG in a comparable retrieval-metric format (LightRAG's paper benchmarks
HotpotQA/2WikiMultiHopQA/MuSiQue; HippoRAG benchmarks similar multi-hop QA sets, not ours) —
citing published results isn't viable. Must run locally.

Reuse existing corpora/query sets — no new dataset, no re-ingest cost for OHARA side:
- `eval/qasper_queries.json` (150 questions, 229 docs)
- `eval/multihop_queries.json` (500 queries, 609 docs)
- Raw corpus markdown already in `doc_pipeline/input/` (mhrag_*.md, qasper_*.md) from the OHARA ingest run.

## Order (cheapest → most expensive)

1. `baseline/lightrag/` — smoke test on QASPER first (200 docs), then MultiHop if cost is sane.
2. `baseline/hipporag/` — same order.
3. GraphRAG deferred (~$8-15/corpus, community summarization is expensive) — only if budget allows after 1-2.

## Scoring

Each baseline folder's `query.py` (or `.js`) must emit results in the same shape as
`tests/eval/run_matrix.js` output (`eval/matrix_*.json`: per-query top-k doc/paragraph ids)
so we can reuse the existing Hits@k/MRR/MAP scoring functions instead of writing new ones.
See `tests/eval/run_matrix.js` for the scoring reference — don't duplicate, import/adapt it.

## Budget

~$25-40 total guess (see TODO.md). Smoke test (`--limit=20` equivalent) before full run on either.
