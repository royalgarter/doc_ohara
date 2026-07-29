# Peer Review Critique — paper_rivf2026.tex

Independent review, critical pass. Verdict: borderline reject / weak accept. Honest empirical reporting is a strength; missing baseline comparison is the killer gap for RIVF.

## Major

1. **Table 2 P-hit column misleading.** BM25-only 4.3% is degenerate (near-empty Principal tier per footnote) but reads as a real number on first scan. Footnote easy to miss.

2. **Abstract overstates corroboration gate.** Claims Principal tier "purifies results," but Table 2 shows removing corrob. barely changes H@10/MRR (96.8% vs 96.5%, 0.795 vs 0.791) and even raises P-hit (92.0% vs 91.5%). Corrob. gate buys abstention behavior, not ranking quality — abstract conflates the two.

3. **"Parity" used inconsistently.** Sec 5.2 MultiHop: Full(tuned) MRR 0.812 > vector's 0.811 — a marginal win reported as "parity," underselling it. Elsewhere (QASPER) "parity" explains away a tie achieved only via post-hoc tuning. Same word doing different rhetorical work in different places.

4. **QASPER "parity" possibly tuned-on-test.** Grid search selects (0.6 BM25, 1.0 Vector) achieving Hits@10 tie with vector-only (33.3%=33.3%) — no stated held-out split. Risk of overfitting weights to the same 150 questions being reported. Reused successfully on MultiHop (Finding 1) helps credibility but doesn't resolve the QASPER-internal question.

5. **No confidence intervals on small-n claims.** 150 QASPER questions, 500 MultiHop queries (125 null). 45.6% abstention on n=125 swings ~±8-9pp at typical CI. Percentages reported bare, no raw counts, no variance.

6. **Cost extrapolation from single run.** "$12/1000 docs" derived from one 200-doc run ($2.41 total). No variance across doc types/sizes. Abstract phrasing ("roughly") undersells that it's a single-corpus extrapolation.

7. **Scaling claim from one benchmark pair.** "Sub-linear" rendering claim rests on two data points (713 → 12,323 nodes), no repeated trials, no variance reported for a scalability claim.

8. **No head-to-head baseline vs cited graph-RAG systems.** Table 1 compares GraphRAG/LightRAG/HippoRAG only qualitatively (capability checkmarks). Sec 7 evaluation only runs internal ablations (BM25/vector/full/tuned) — never runs those cited systems on QASPER/MultiHop. Biggest gap: paper implies capability superiority in Table 1 but never empirically tests it against those baselines.

## Minor

- "In our point of view" repeated 6+ times — hedge-filler, undermines empirical authority.
- Decay class λ values (10⁻⁶, 10⁻⁴, 10⁻², 10⁻¹) stated without justification/citation.
- Evergreen promotion threshold (in-degree ≥5) has no ablation.
- Sec 3 edge-type relation set split oddly across two `equation*` blocks (LaTeX cosmetic).
- Figures eat page budget without explicit tie-back to eval results — fine for systems paper, but conference page limit may not afford it.

## Bottom line

Reward: explicit parity-not-superiority framing, negative Finding 3 reported honestly. Blocker: #8 (no baseline runs) is the standard reviewer objection for a paper citing 3 competing systems by name and never running them. Fix #8 or explicitly preempt it in Limitations before submission.
