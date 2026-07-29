# OHARA → Medical Pivot Proposal

## 1. What OHARA Achieved

OHARA (RIVF 2026 submission) is a Space-Time Graph framework for knowledge-base retrieval and visualization, evaluated on QASPER (200 academic papers) and MultiHop-RAG (609 news articles). Key results:

- **Space-Time Graph substrate**: 5-tuple $G=(V,E,\tau,\delta,\sigma)$ unifying document structural hierarchy, temporal decay, and cross-document entity pivots. Seven relation types (`has_child`, `next_sibling`, `belongs_to`, `mentions`, `related_to`, `similar_to`, `toc_ref`).
- **Temporal decay scoring**: four decay classes (evergreen/scholarly/current/ephemeral) with exponential decay $w \cdot e^{-\lambda \Delta t}$, guarded by a five-layer protection mechanism against over-penalizing relevant-but-old content.
- **Eight-phase hybrid retrieval engine**: fuses BM25, dense vector (gemini-embedding), SUMO ontology overlap, multi-hop traversal, entity pivot, and structural traversal signals via weighted fusion.
- **Tiered, corroboration-gated output**: Principal / Integrity / Explorer tiers. Principal tier requires ≥2 independent signal sources + score threshold + cross-document evidence. This tier abstains on 45.6% of unanswerable queries (vs. 0.0% for plain top-k cutoffs) while holding 91.5% hit rate on answerable queries — i.e., the system knows when *not* to answer.
- **3D Space-Time visualization**: Z-axis = time, polar plane = ontology (SUMO), radial discs = document structure. Renders up to 12,323 nodes with sub-linear scaling (InstancedMesh batching).
- **Cost/scale numbers**: ~$12/1,000 documents to ingest and build the full semantic graph; content-hash caching makes re-ingest idempotent (at chunk level, not edge level — known gap).
- **Honest limitations already documented**: Gemini-backend dependent, English clean-text only (no OCR/noisy input evaluated), decay scoring helps corpus tasks but not event-ordering tasks, visual clutter beyond ~50 document discs.

The core intellectual contribution is not "better ranking" — OHARA explicitly matches (not beats) single dense-vector retrieval on Hits@10. The contribution is **auditability**: structural/temporal/ontological provenance baked into the graph, and a gating mechanism that abstains rather than hallucinates when evidence is thin.

## 2. Proposed Pivot: Medical / Clinical Decision Support

Professor's original ask (6 clinical agents: Radiology, Pathology, Oncology, ICU, Pharmacy, Treatment Recommendation, using RAG + Medical KG + Tool Calling → full CDSS) is thesis/product scale, not a single-paper extension. A more concrete draft direction (Minkowski spacetime graphs + Med-VLM + MMed-RAG + RL) is architecturally sound but bundles four separate research problems (causal graph modeling, multimodal alignment, retrieval, RL) into one deliverable.

**Recommendation: scope to a single vertical slice that reuses OHARA's existing, already-evaluated machinery**, deferring imaging (Med-VLM/DICOM) and RL to a later phase.

### 2.1 What maps directly from OHARA (low new-engineering cost)

| OHARA component | Medical analog |
|---|---|
| $\tau$ (temporal mapping), $\delta$ (decay class) | Patient worldline position, disease progression rate (replaces Minkowski "velocity β" with existing decay-class machinery) |
| 7 relation types in $R$ | Add 2 new types: `precedes_causally` (time-like edge) and `co_occurs_independent` (space-like edge) — same edge-typing pattern already used for `similar_to`/`related_to` |
| SUMO ontology grounding | Swap for UMLS/RadLex concept grounding — same "tag-expansion candidate retrieval" role Phase 1b already plays |
| Principal/Integrity/Explorer tiers + corroboration gating | **Directly reusable as-is.** This *is* the FDA "Retrieval-Only, provenance-pointer, no autonomous diagnosis" constraint the professor's draft requires. No new design needed — it's already built and evaluated (45.6% abstention on unanswerable queries is exactly the behavior FDA SaMD Class II avoidance wants). |
| Eight-phase fusion engine (BM25 + vector + ontology + entity + structural) | Reusable unchanged for EHR text retrieval (clinical notes, discharge summaries) |
| 3D Space-Time visualization | Reframe Z-axis as literal patient timeline; radial discs become encounter/note structure per patient instead of per-document |

### 2.2 What is genuinely new work (not reuse)

- **Causal edge classification** (time-like vs. space-like): can start as a **rule-based heuristic** (temporal precedence + code-based causality priors, e.g. medication → lab value change within a clinical window) rather than full Minkowski-metric math. Defer the physics formalism unless a reviewer specifically demands it — it adds narrative rigor but not necessarily retrieval accuracy.
- **UMLS/RadLex integration**: requires UMLS license (UTS account, signed agreement, non-trivial lead time) before any ontology mapping work can start. This is a blocking dependency to resolve first.
- **EHR/PACS data access**: no dataset currently in scope. Realistic path is **MIMIC-IV** (structured EHR, FHIR-adjacent) as v1 corpus, since it's public + credentialed access is well-trodden (PhysioNet CITI training). MIMIC-CXR (imaging) deferred to phase 2.
- **Med-VLM alignment (MedCLIP/DCFormer/Med3DVLM)**: entire new modality, zero overlap with current OHARA pipeline. Explicitly out of scope for v1.
- **RL-based retrieval trigger (Med-RwR)**: new component, no RL anywhere in OHARA today. Explicitly out of scope for v1.

### 2.3 Proposed v1 scope (paper/thesis-sized, buildable on current codebase)

**"Clinical Space-Time Graph": text-only EHR retrieval with causal edge typing and FDA-aligned retrieval-only output.**

1. Ingest MIMIC-IV clinical notes/timelines into the existing Space-Time Graph structure (reuse ingest pipeline, swap SUMO tagger for UMLS concept extractor).
2. Add two new edge types to $R$: time-like (causal) and space-like (independent), using rule-based temporal/code priors — not full Minkowski metric initially.
3. Reuse the eight-phase retrieval engine unchanged for note/timeline retrieval.
4. Reuse Principal/Integrity/Explorer tiering unchanged as the FDA "Retrieval-Only + provenance" output layer — this is the one part of the professor's draft that OHARA already solves.
5. Evaluate: does causal edge typing measurably reduce retrieval of stale/contradicted diagnoses (the "rebuttal edge" idea) compared to the existing temporal-decay-only approach?

**Deferred to phase 2 (separate paper/thesis milestone):** Med-VLM imaging alignment, DICOM/PACS ingestion, full Minkowski geometric formalism, RL-optimized retrieval trigger, multi-agent (Radiology/Pathology/Oncology/ICU/Pharmacy) decomposition.

### 2.4 Open questions before starting

- Is UMLS-license lead time acceptable for the target submission deadline?
- Does the professor need the Minkowski/relativity framing specifically for narrative/novelty reasons, or is a simpler causal-DAG-with-conflict-resolution equally acceptable? Affects whether math formalism is worth the write-up cost.
- Confirm MIMIC-IV access (PhysioNet credentialing) can be completed in time.
