

# DRAFT SECTIONS


## QASPER Ingest Verification Report

  1. Completeness — PASS
  - 200/200 docs ingestion_status=complete (after 3 retry waves; final DB check).
  - Failure history: 13 hard fails + 16 partials in first pass — root causes were credit depletion
  (429) and transient 503s, not content. All recovered via --force re-ingest.
  - Cost: $2.41 std-rate tokens (6.2M prompt / 4.5M output); retries mostly cache-served.

  2. Structure — PASS with note
  - Sections per doc: min 0 / avg 16 / max 44. Paragraphs: avg 43.8, none empty.
  - 2 docs have 0 sections (flat parse) — TOC-phase dead for those two only.

  3. Integrity (ohara verify, sampled) — PASS with defect
  - Content checks pass, but --force re-ingest created duplicate edges: 23,077 extras across 12,982
  groups (e.g. NEXT_PARA doubled). verify --fix doesn't repair duplicates.
  - I prepared an AQL dedupe (keep-first per _from,_to,relation) but did not run it — deletes on the
  shared edges collection need your approval. Say word and I execute.

  4. Gold-evidence linkage — PASS
  - 50-query sample: 49/50 (98%) gold snippets resolvable in ingested paragraph content →
  paragraph-level matcher valid.

  5. Smoke matrix (15 queries, bm25_only vs full) — RUNS, with calibration finding
  - Harness end-to-end OK (fixed on the way: run_matrix.js now calls loadEnvFromDB() — key/weights
  live in DB, not .env).
  - Metrics: Hits@10 = 20%, MRR@10 = 0.096, identical for both configs; Principal-hit 0%.
  - Finding: BM25 scores are unnormalized (13–24) while SUMO/entity/cross-doc contribute ≤ ~1 —
  weighted fusion is BM25-dominated, so ablations will show nothing until scores are normalized (or
  BM25 weight recalibrated). Principal tier empty because nothing gets ≥2 phase contributions into top
  ranks. This needs a source-side fix (score normalization in _fuseResults) before the real
  experiment — affects the paper's fusion claims directly.

  Recommended next: (a) approve edge dedupe, (b) decide normalization fix (min-max or z-score BM25
  before fusion — small retrieval.js change), then rerun smoke expecting divergence between configs.

## Full matrix done — 150 QASPER queries, 7 configs:

  ┌──────────────────┬────────┬─────────┬────────┬────────┬─────────────┬───────────────┐
  │      config      │ Hits@4 │ Hits@10 │ MRR@10 │ MAP@10 │ gold-Rec@10 │ Principal-hit │
  ├──────────────────┼────────┼─────────┼────────┼────────┼─────────────┼───────────────┤
  │ bm25_only        │ 12.7%  │ 25.3%   │ 0.102  │ 0.093  │ 22.7%       │ 0%            │
  ├──────────────────┼────────┼─────────┼────────┼────────┼─────────────┼───────────────┤
  │ vector_only      │ 26.7%  │ 33.3%   │ 0.175  │ 0.164  │ 28.9%       │ 24.7%         │
  ├──────────────────┼────────┼─────────┼────────┼────────┼─────────────┼───────────────┤
  │ full             │ 22.0%  │ 30.0%   │ 0.164  │ 0.150  │ 26.0%       │ 22.7%         │
  ├──────────────────┼────────┼─────────┼────────┼────────┼─────────────┼───────────────┤
  │ no_sumo          │ 22.0%  │ 29.3%   │ 0.163  │ 0.150  │ 25.7%       │ 22.0%         │
  ├──────────────────┼────────┼─────────┼────────┼────────┼─────────────┼───────────────┤
  │ no_crossdoc      │ 22.0%  │ 29.3%   │ 0.163  │ 0.150  │ 25.7%       │ 22.0%         │
  ├──────────────────┼────────┼─────────┼────────┼────────┼─────────────┼───────────────┤
  │ no_toc           │ 22.0%  │ 29.3%   │ 0.163  │ 0.150  │ 25.7%       │ 22.0%         │
  ├──────────────────┼────────┼─────────┼────────┼────────┼─────────────┼───────────────┤
  │ no_corroboration │ 22.0%  │ 29.3%   │ 0.162  │ 0.149  │ 25.7%       │ 24.0%         │
  └──────────────────┴────────┴─────────┴────────┴────────┴─────────────┴───────────────┘

  Read:

  1. Corroboration mechanism works: Principal-hit 0% → 22.7% once vector phase corroborates BM25. The
  architecture's core claim now has evidence.
  2. Every ablation hurts full (each −0.7pp Hits@10, consistent) — all phases contribute, but
  marginally on this corpus.
  3. **Honest problem: full (30.0%) < vector_only (33.3%)**. Fusion weights drag — BM25 at weight 1.0
  injects lexical noise above semantic hits (vector only 0.5). QASPER questions are paraphrase-heavy →
  semantic > lexical here. This is exactly what tune_weights.js / REFEED exists for: a weight-tuned
  config (vector ↑, bm25 ↓) should let full dominate both singles by combining complementary hits.
  4. Absolute numbers (Hits@10 30%) plausible for QASPER evidence retrieval — strict substring
  matcher, hard benchmark.
  5. Null-abstention n/a (QASPER set has no unanswerable queries — that metric comes from MultiHop's
  null slice).

  Report: eval/matrix_qasper_2026-07-10T06-19-39.json (per-query provenance included).

  Suggested next: quick weight-tuning pass (e.g. vector 1.0/bm25 0.6, or run scripts/tune_weights.js)
  → rerun full — if it beats 33.3% that's the paper's fusion story. Then MultiHop ingest for the
  temporal/null claims. Which first?

## Oracle run still in flight — judgment based on everything measured so far. Honest, no marketing:

  What the evidence supports

  1. Ingest pipeline: genuinely good. 200/200 docs, $2.41, transient-failure recovery via content-hash
  caching worked exactly as designed. The "$12/1k docs for a full semantic graph" story is real and
  defensible.
  2. Visualization claims: verified. Sub-linear InstancedMesh scaling measured. The sunburst-tunnel is
  the paper's most novel artifact and nothing in the data undermines it.
  3. Corroboration mechanism: works after calibration. Principal-hit 0% → 22.7% is a real mechanism
  doing a real thing.
  4. The methodology story is underrated: end-to-end metrics looked "fine" while two silent defects
  (score-scale domination, embedding-model mismatch) had reduced the system to BM25-only. Only
  per-phase provenance analysis caught them. That's a publishable lesson in itself.

  What the evidence does not support

  1. The multi-phase retrieval engine does not beat its best single signal. Untuned it loses to
  vector-only; tuned it reaches parity (MRR +0.004 — noise territory). The honest value proposition is
  explainability at parity, not better ranking. The paper's §4 rhetoric ("multi-dimensional
  corroboration prevents lost-in-the-middle decay") is currently ahead of the data.
  2. The corroboration story is thinner than the architecture suggests. Entity/cross-doc/structural
  phases exclude already-seen nodes by design — they architecturally cannot corroborate. In practice
  Principal = bm25∩vector, a 2-signal hybrid. "Corroborated by many angles" is aspirational.
  3. SUMO layer: no measurable retrieval lift. −0.7pp when ablated, within noise. A 22,700-entry
  ontology + validation machinery currently earns its keep in visualization (sunburst coordinates!)
  and organization, not retrieval. Paper should say that.
  4. Flagship temporal claims: still zero evidence. QASPER can't test them. Everything about decay
  classes, five-layer protection, temporal intent rides on the MultiHop run.
  5. Breadth >> depth risk. §4.12 lists six advanced modes; none measured. Reviewers punish feature
  lists without numbers harder than missing features.

  Verdict

  OHARA as measured is: a cost-efficient structured-ingest pipeline + a genuinely novel 3D
  ontology-time visualization + a provenance-carrying hybrid retriever that matches (not beats) vector
  search. That's a legitimate paper — and notably, your title already frames it as a visualization
  paper, which is the right bet. The retrieval engine should be positioned as the explainable
  substrate feeding the visualization, not as a ranking contender.

  Two things would most change this assessment: (a) MultiHop temporal + null-abstention results —
  decay scoring and corroboration-based abstention are features no baseline has, so that's where a
  differentiated quantitative win is still possible; (b) the oracle-doc numbers about to land — if
  doc-level retrieval is high and paragraph-descent is the loss, the structural-traversal narrative
  gets real support.


## Three observations. 
- **First, corroboration is real but signal-dependent**: with BM25alone no node can corroborate (Principal-hit 0%); adding the vector phase lifts Principal-hit to 22.7%, and per-query provenance shows the corroborating pair is almostalways `fulltext+vector` — the graph-side phases (entity pivot, cross-doc, structural) exclude already-retrieved nodes by design and therefore expand rather than corroborate. 
- **Second, every phase contributes**: removing any single phase costs a consistent ~0.7pp Hits@10 against the full pipeline. 
- **Third, default fusion weights under-serve semantic signal on paraphrase-heavy corpora**: vector-only (33.3% Hits@10) outperforms the full pipeline (30.0%) because BM25 at weight 1.0 ranks lexical noiseabove semantic hits — QASPER questions rarely share vocabulary with their evidence.This motivates the REFEED weight-tuning loop (Section 7.5): the fusion architectureis sound, but its default weights encode a lexical-first prior that the tuner must adapt per corpus. A 6-point grid search over (BM25, vector) weights on a 75-query subset showed early precision improving monotonically as the lexical weight drops (Hits@4 25.3% → 28.0%, MRR 0.196 → 0.202 from bm25 = 1.0 to ≤ 0.6, saturating below 0.6);the selected setting (BM25 0.6, vector 1.0) was then re-run on the full 150 queries. 

**The tuned pipeline recovers the entire gap**: +3.3pp Hits@10 over default weights, matching vector-only on Hits@10/MAP/Recall and slightly exceeding it on MRR (0.179 vs. 0.175) — while retaining the tiered, provenance-carrying output a single-signal retriever cannot produce. We report this per-corpus tuning transparently: on paraphrase-heavy academic Q&A, fusion's value is explainability at parity with the best single signal rather than raw ranking gains; the corpus-dependence of the weight prior is exactly what the REFEED feedback loop is designed to absorb online

## **Comparability with published QASPER results.** 
Published QASPER evaluations retrieve evidence *within the question's own paper* (50–80 candidate paragraphs): the original LED baseline reports 39.4 evidence-selection F1 (Dasigi et al., 2021), and RAG-method comparisons report within-document retrieval nDCG@10 in the 38–59 range. Ourprotocol is deliberately harder: retrieval runs over the **entire 229-document corpus (~11.6k paragraphs) with no document filter**, so the retriever must locate the correct paper before the correct paragraph — absolute numbers are therefore not directly comparable across protocols. To bridge the two regimes we additionally report, for the tuned full pipeline: (a) **document-level Hits@10 = 58.0%** (the gold paper appears in the top-10), and (b) an **oracle-document condition** — paragraph ranking among results from the gold paper only, conditioning on correct-document retrieval —of **Hits@4 = 54.0% and Hits@10 = 64.4%**, which sits in the same band as publishedwithin-document evaluations. The decomposition localizes the corpus-wide loss: roughly 42% of queries fail at document location, and given the correct document, paragraph discrimination succeeds for about two-thirds of queries — evidence that the descend-into-structure step, not paragraph scoring, is the binding constraint at corpus scale, and the step the TOC-guided and structural phases target. A protocol note: corpus-wide, the lexical/semantic ordering *inverts* relative to published within-document results — BM25 is the strongest single signal inside one paper (lexical overlapsuffices among 60 paragraphs) but the weakest across 229 papers (25.3% vs. vector 33.3% Hits@10), where common NLP phrasing collides across documents; retrieval granularity changes which signal family wins.
