# TODO: OHARA Paper Experiments (low-cost plan)

Goal: back paper_01.md Sections 4.13 (ablations) + 7 (evaluation) with measured numbers.
Constraint: standard datasets, < 1000 documents, LLM budget **< $25 total** (gemini-2.5-flash-lite + batch/flex tier + aggressive caching).

## Datasets

1. **MultiHop-RAG** (primary) — 609 news articles (~2,046 tokens avg), 2,556 queries with gold evidence.
   Query types: inference 40%, comparison 25%, **temporal 22%**, null 12%.
   Fits OHARA: publish dates → temporal Z, sources → entities, cross-doc queries → SIMILAR_TO edges.
   https://github.com/yixuantt/MultiHop-RAG (paper: arXiv:2401.15391)
2. **QASPER subset** (secondary, structure stress) — sample 200 academic papers with section structure + evidence-anchored questions.
   Exercises DoCO hierarchy, TOC-guided Phase 0b, structural traversal — news articles cannot.
3. Deferred (future work): TempRAGEval / ChroniclingAmericaQA for deep temporal reasoning.

## Query subsample

- 500 queries from MultiHop-RAG, stratified: 125 per type (inference/comparison/temporal/null).
- 150 queries from QASPER subset.
- Null-type queries kept deliberately: test that corroboration constraint (≥2 phases) abstains instead of hallucinating retrieval.

## Systems compared

| # | Config | Purpose |
|---|---|---|
| 1 | BM25-only (ArangoSearch) | lexical floor |
| 2 | Chunk+embed vector (512-tok chunks, embeddinggemma-300m, cosine) | vanilla RAG baseline |
| 3 | OHARA full pipeline | headline |
| 4 | OHARA − SUMO expansion (Phase 1b off) | ablation §4.13.1 |
| 5 | OHARA − cross-doc edges (Phase 1c off) | ablation §4.13.3 |
| 6 | OHARA − temporal decay (TEMPORAL_WEIGHT=0) | ablation §7.3, temporal slice |
| 7 | OHARA − TOC guidance (Phase 0b off) — QASPER only | ablation §4.13.2 |
| 8 | OHARA corroboration off (Principal = top-k by score) | ablation §4.13.4 |

- GraphRAG / LightRAG / HippoRAG: do NOT re-run (indexing cost). Cite published MultiHop-RAG numbers from their papers/benchmark leaderboard.
- Ingest ONCE per corpus; ablations only change fusion/weights → reuse graph + caches, ~$0 marginal.

## Metrics

- Retrieval: MRR@10, MAP@10, Hits@4, Hits@10 (MultiHop-RAG standard — comparable to published baselines); Recall@k for QASPER evidence paragraphs.
- OHARA-specific: Principal-tier hit rate (gold evidence ∈ Principal), contributions-array distribution (multi-phase corroboration analysis, §7.2), null-query abstention rate.
- Temporal slice: metric delta on 125 temporal queries, config 3 vs 6.
- Generation (optional, capped): 100-query subsample, answer correctness judged by flash-lite (~$1). Retrieval metrics remain primary.
- Viz efficiency (§7.4, free/local): render time, FPS, memory vs doc count at 10/50/100/300/609 docs; InstancedMesh vs naive meshes. Quantifies >50-doc clutter limit honestly (§8.2g).

## Cost controls & estimate

- Model: `gemini-2.5-flash-lite` ($0.10/M in, $0.40/M out; batch/flex ≈ 50% off). Content-hash caching already in pipeline — never re-pay for unchanged chunks.
- Embeddings: `embeddinggemma-300m` via Cloudflare Workers AI (see snippets below) — near-free for ~3–5k chunks.
- SIMILAR_TO enrichment: 609 docs → ~185k Jaccard pairs; check edge count AFTER thresholding BEFORE enriching. Cap enrichment calls (raise Jaccard threshold if > ~2k edges).
- Query fingerprinting: LLM call only for phrase+ queries; batch where possible.
- Estimate: ingest MultiHop-RAG ~$1–3, QASPER subset ~$2–4, query-time LLM ~$3–8, judge ~$1, headroom → **≤ $25**.

## Success criteria (paper claims to verify)

1. OHARA full ≥ vector baseline on MRR@10 for inference+comparison queries (multi-hop advantage).
2. Temporal decay on > off for temporal-query slice; no regression on non-temporal slice (five-layer protection works).
3. Each ablation (4–8) produces measurable drop → replaces the softened "expected effect" claims in §4.13 with numbers.
4. Corroboration constraint: higher abstention precision on null queries vs top-k cut.
5. Cost report: $/1k docs ingested + $/100 queries → supports "low-cost" positioning in §5 table.

## Execution order

1. [x] Loaders + query sets + harness (`tests/eval/`): prepare_multihop, prepare_qasper, build_query_set, run_matrix.
2. [x] QASPER ingest: 200/200 complete, $2.41 std tokens; 98% gold linkage verified; smoke matrix runs.
3. [x] Fusion score normalization: per-phase max-norm in `_fuseResults` (`OHARA_NORMALIZE_SCORES=false` to disable); temporal gate now uses raw BM25.
4. [x] Deduped 24,199 duplicate edges (AQL keep-first per from/to/relation).
5. [x] Embedding model mismatch fixed: backfill now `gemini-embedding-2`@768 matching `_phase1dVector` (was `text-embedding-004`); `embedding_model` stored per paragraph. Backfill of 11.6k paragraphs in progress (~$0.2).
6. [x] Viz efficiency benchmark (`tests/eval/bench_viz.js`, snap chromium): 713→12,323 nodes = 1.5s→2.3s rebuild, 52→80MB heap, sub-linear ✓. Draft color-mode screenshots in `eval/viz/`.
7. [x] Corroboration verified post-embeddings: bm25∩vector overlap 1–5/query, Principal-hit 0%→22.7%. (Design note: entity/crossdoc/structural exclude seen nodes → expansion, not corroboration; in paper §7.1.1.)
8. [x] Full QASPER matrix (150 queries × 7 configs) + weight grid search → tuned (bm25 0.6, vector 1.0): Hits@10 30.0%→33.3%, MRR 0.179 ≥ vector-only. Results in paper §7.1.1. NOTE: tuned weights NOT persisted to .env/DB env — eval-only finding, decide before MultiHop runs.
9. [ ] Ingest MultiHop-RAG (609 docs, ~$2–3); set_published_dates; 500-query matrix + ablations + temporal slice.
10. [ ] Optional generation eval (100 queries, flash-lite judge).
11. [ ] Write results into paper §7; update §4.13 expected→measured; user study + publication-quality screenshots remain.

## The two open bets (decide the paper's ceiling)

Measured so far: retrieval = parity + explainability; viz = novel + verified rendering. What's still unproven is whether OHARA has any *differentiated quantitative win*. Two bets, in order of leverage:

### Bet 1 — MultiHop temporal + null-abstention slices
- **Claim at stake**: temporal decay scoring (§3.3 five-layer scheme) and corroboration-based abstention are features no baseline (BM25/vector/GraphRAG) has. If measurable, OHARA gets a quantitative claim nobody else makes; if not, the viz/explainability story is the whole paper.
- **Test**: ingest MultiHop-RAG (609 docs, ~$2–3) → `set_published_dates.js` → 500-query matrix. Win conditions:
  (a) temporal slice (125 queries): `full` beats `no_temporal` on Hits@10/MRR, AND no regression on non-temporal slices (validates five-layer protection);
  (b) null slice (125 unanswerable): Principal-tier abstention rate meaningfully above plain top-k proxy (corroboration as Corrective RAG, §4.13.4).
- **Risk**: MultiHop temporal queries are event-ordering ("before/after"), not recency-weighting — decay may not help; coverage-overlap layer (L5) is the more likely winner. Analyze layers separately in the report.
- **Also run**: tuned vs default weights on MultiHop — tests whether QASPER tuning generalizes across corpora (news vs papers). Either outcome is publishable.

### Bet 2 — User study (sunburst-tunnel vs flat list)
- **Claim at stake**: the actual thesis — "a spatial-temporal mental model helps humans navigate a corpus." Everything else is substrate. Untested.
- **Protocol**: already drafted in paper §6 (within-subjects, n≥8, T1 temporal filtering / T2 topic tracing / T3 structural lookup, time + error + SUS). Needs: a working comparison UI (flat list with filters — mostly exists in docs tab), task sheets, ~30 min per participant.
- **Win condition**: T1/T2 faster or fewer errors on tunnel; T3 no worse. Even n=8 informal with honest reporting beats zero.
- **Risk**: 3D navigation learning curve may sink T1 for novices — mitigate with 3-min warmup task; report per-participant learning effect.
- **Blocked on**: publication-quality screenshots + fitted camera first (same session as study prep); human participants (user's call).

## References

- MultiHop-RAG: https://arxiv.org/abs/2401.15391
- QASPER: https://allenai.org/data/qasper
- GraphRAG-Bench (ICLR'26, for cited baselines): https://github.com/GraphRAG-Bench/GraphRAG-Benchmark
- TempRAGEval / MRAG (deferred temporal): https://arxiv.org/abs/2412.15540
- Gemini pricing: https://ai.google.dev/gemini-api/docs/pricing

---

## Cheap model endpoints (notes)

```sh
curl https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/ai/run/@cf/google/embeddinggemma-300m  \
  -X POST  \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN"  \
  -d '{ "text": ["This is a story about an orange cloud", "This is a story about a llama", "This is a story about a hugging emoji"] }'

curl "https://generativelanguage.googleapis.com/v1beta/models/gemma-4-26b-a4b-it:generateContent?key=$GEMINI_API_KEY" \
-H 'Content-Type: application/json' \
-X POST \
-d '{
    "serviceTier": "flex",
    "contents": [{
        "parts":[{"text": "Roses are red..."}]
    }],
    "generationConfig": {
        "temperature": 0,
        "thinkingConfig": {
            "thinkingLevel": "MINIMAL"
        }
    }
}'
```
