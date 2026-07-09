# Plan: Finish refs/paper_01.md (OHARA paper)

Goal: resolve all `draft`/TODO blocks and realign paper with current platform, especially the **sunburst polar layout** (commit fbcf57c) which supersedes the pure radial-disc tunnel described in Section 6.

## A. Verified alignment audit (paper vs code)

### ✓ Accurate (keep as-is)
- Phase weights in 4.7.1.1 pseudocode: BM25 1.0, SUMO 0.4, Entity 0.6, CrossDoc 0.4, Struct 0.3 (`src/retrieval.js:50-55`, `.env.example`).
- Tier thresholds: 75th pctl (`OHARA_PRINCIPAL_SCORE_PCTL=0.75`), Integrity min weight 0.6, Explorer band floor 0.15, temporal weight 0.2.
- Decay λ values (10⁻⁶/10⁻⁴/10⁻²/10⁻¹) match `.env.example:56-59`.
- Ring radius formula 6.3 `max(35, ceil(n(d+g)/2π))` matches `index.html:1763`.
- Fin Z-extents (5 / 2.5 / 1 / 0.4 disc spans) match `DECAY_FIN` config.
- Rollup formula (5.6 / draft §2.1) matches ingest behavior.

### ✗ Stale — Section 6 must be rewritten for sunburst layout
1. **6.2 Tunnel Layout**: docs are NOT "arranged radially when sharing a Z-bucket". Now: doc XY = sunburst polar coordinate of its top SUMO category — θ = category slice midpoint (precomputed by `scripts/build_sunburst_layout.js`: recursive angular partition of SUMO category tree, slice width ∝ sqrt-damped tag count, 8° min slice floor), r = 700·√(depth/5) (ontology depth: abstract center → specific rim). Docs of one category form a fixed **topic column** along Z. Radial offset (80u) only for true (x,y,z) collisions.
2. **New subsection needed — Sunburst Ontology Plane**: XY plane now *encodes semantics* (ontology position), not just collision avoidance. Visual guides: depth rings on front reference plane, L2 topic-column spines colored by L1 (Abstract/Physical), tunnel spine, resolution-aware timeline ticks. This is a headline contribution — update 1.2(c) and 2.3 novelty claim accordingly ("ontology sunburst × time tunnel").
3. **6.4 Comet shell**: entities are NOT in a cylindrical shell. Now placed at centroid of their mentioning docs + outward offset (`ENTITY_OFFSET = maxDiscR+120`); multi-doc entities float between docs. Top-25 tags placed near tagged sections' centroid. Hash used for determinism only.
4. **6.5 Decay fins**: not "planes perpendicular to disc" anymore — now ellipsoid **auras** (unit sphere scaled to (discR, discR, zH/2)) hugging the disc, InstancedMesh per decay class, per-instance SUMO color. EPHEMERAL pulse: verify still present, then keep or cut.
5. **6.1 Design rationale**: strengthen — 3D now has THREE encoded dims: time (Z), ontology (XY sunburst), structure (disc rings). This is the real answer to "why 3D".

### ⚠ Inconsistencies to fix
- **3.4 vs draft §1**: outline says 4-tuple G=(V,E,τ,δ); draft says 5-tuple with σ. Adopt 5-tuple; consider adding sunburst layout function π: V_docs → (θ, r) as presentation-layer mapping (or keep viz separate — decide).
- **8.2 future work (a) "Vector ANN hybrid Phase 1d"**: `OHARA_VECTOR_WEIGHT` (0.5) and vector path already exist in `retrieval.js:810`. Verify implementation status; if live, move from future work to Section 4.
- **4.x adaptive weights**: code has mode-multiplier adaptive weights (`OHARA_ADAPTIVE_WEIGHTS`, retrieval.js:1393) — absent from paper. Add short note in 4.7.
- **Ablation numbers (30% recall drop, 70% noise filter)** in 4.8 are asserted, not measured. Either run eval to back them or soften to qualitative claims.
- **Tone**: "I tell you...", "medicine", "epistemic truth" — rewrite draft prose to academic register; unify "I"/"we".
- **Ingest cost table (§5)**: numbers unverified. Re-run on real corpus via eval/ scripts or label as representative.

## B. Task list (verifiable steps)

1. [x] Rewrite Section 6 (6.1–6.8) for sunburst layout per audit above; verify every constant against `index.html` layout code. ✅ done when each 6.x claim maps to a code line.
2. [x] Update 1.2 contribution (c) + 2.2/2.3 related-work comparisons to sunburst ontology plane; add sunburst layout row to Table if useful.
3. [x] Reconcile formal model: promote draft §1 5-tuple into Section 3 body, fix 3.4, academic tone pass; keep O(docs) rollup analysis.
4. [x] Verify vector phase status in retrieval.js; adjust 4.x/8.2.
5. [x] Add adaptive-weights note to 4.7; verify TEMPORAL_GATE_FLOOR guard name in code, fix pseudocode if wrong.
6. [x] Back or soften ablation percentages (check eval/ for existing harness).
7. [x] Validate/re-measure ingest table or mark representative.
8. [x] TODOs: draft user-study protocol (§6), concrete dataset+baselines plan (§7), threats-to-validity paragraph (§8).
9. [ ] Screenshots: 3 color modes + sunburst guide view (needs running app).
10. [x] Final consistency pass: terminology (tunnel vs sunburst-tunnel), citation format, remove ```draft fences.
