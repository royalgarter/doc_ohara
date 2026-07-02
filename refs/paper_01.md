# **Efficient Visualization of Knowledge Bases via Space-Time Graphs: The OHARA Architecture**

## **1. Introduction**

- **1.1 Problem Statement** - Traditional RAG systems use flat chunk lists; users "get lost in the middle" when retrieving from large corpora. No spatial or temporal mental model of where knowledge resides.
- **1.2 Contributions** - (a) Space-Time Graph data model combining structural hierarchy + temporal decay + cross-document entity pivots; (b) Multi-phase hybrid retrieval engine with tiered result classification; (c) Efficient 3D tunnel visualization mapping time → Z-axis, document structure → radial discs, decay class → fin aura; (d) SUMO ontology-grounded semantic layer enabling tag-expansion retrieval.
- **1.3 Paper Organization** - Brief roadmap of sections 2–8.

**TODO**: Articulate the "lost in the middle" / flat-RAG limitation claim with citations (e.g., Liu et al. 2024). Define scope: document corpora with structural metadata.

---

## **2. Related Work**

- **2.1 Graph-Based RAG** - GraphRAG (Microsoft), LightRAG, HippoRAG. Compare: they use entity/relation subgraphs; OHARA adds structural hierarchy (DoCO types) + temporal decay + cross-document similarity edges with LLM-enriched verbs.
- **2.2 Explainable AI / Provenance in Retrieval** - Self-RAG (Asai et al.), Corrective RAG, retrieval provenance. OHARA's tier system (Principal/Integrity/Explorer) with per-node provenance arrays is a form of built-in explainability.
- **2.3 Knowledge Graph Visualization** - 3D graph layouts (n3.js, GONE, VR graph tools), temporal graph visualization (Time-arc, Storyline). OHARA's tunnel metaphor + radial disc layout + decay fins is novel - no prior work places document structure as concentric rings on time-anchored discs.
- **2.4 Ontology-Tagged Retrieval** - SUMO, BERT-based taggers. OHARA validates LLM-emitted SUMO tags against a 22,700-entry index with alias resolution.

**TODO**: Add a comparison table (system × features): GraphRAG, LightRAG, HippoRAG vs OHARA. Surface the gap: none offer both (a) structural document hierarchy and (b) temporal-aware visualization.

---

## **3. The Space-Time Graph Data Model**

- **3.1 Collections** - documents, sections, paragraphs, tables, entities, edges. Each with typed schema; documents carry `entity_slugs`, `sumo_tags`, `decay_class`, `temporal_coverage`, `effective_decay_class`.
- **3.2 Edge Taxonomy** - 7 edge types: `HAS_CHILD`, `NEXT_SIBLING`, `BELONGS_TO`, `MENTIONS`, `RELATED_TO`, `SIMILAR_TO`, `TOC_REF`. Distinguish structural (tree) vs. semantic (cross-cutting) vs. cross-document (Jaccard-gated) edges.
- **3.3 Temporal Model** - Four decay classes (EVERGREEN λ=10⁻⁶, SCHOLARLY λ=10⁻⁴, CURRENT λ=10⁻², EPHEMERAL λ=10⁻¹). Auto-promotion rule: `similar_to_indegree ≥ 5 → EVERGREEN`. Exponential decay scoring: `w × e^(−λΔt)` with three guards (Principal tier immune, high-BM25 immune, no temporal intent → skip).
- **3.4 Formal Definition** - Define G = (V, E, τ, δ) where V = ∪Cᵢ (collections), E typed by relation ∈ R, τ maps docs → temporal bucket, δ maps docs → decay class. State the "lost in the middle" resolution: retrieval navigates G instead of scanning a flat list.

**TODO**: Express the data model formally (sets, functions). Provide complexity: O(docs) pre-filtering via document rollup of entity_slugs/sumo_tags.

---

## **4. Multi-Phase Hybrid Retrieval Engine**

- **4.1 Phase 0 - Input Parsing & Query Fingerprinting** - Tokenization → keyword/phrase/paragraph classification. Gemini extracts `sumo_tags`, `entity_hints`, `temporal_intent` for phrase+ queries. Conversational RAG: session history prepended for anaphora resolution.
- **4.2 Phase 1 - Shallow Context (BM25)** - ArangoSearch full-text + fallback term-overlap. TOC-guided section selection (Phase 0b): LLM picks relevant sections from top-3 seed docs before structural traversal.
- **4.3 Phase 1b - SUMO Tag Expansion** - Tag overlap + entity-type affinity scoring. SUMO hierarchy expansion up to `HIERARCHY_DEPTH` ancestors.
- **4.4 Phase 1c - Cross-Document Edge Expansion** - Multi-hop `SIMILAR_TO` traversal with weight/tag filters. Carries `edge_verb`, `edge_summary`, `hops` for explainability.
- **4.5 Phase 2 - Entity Pivot** - Shared entity slugs across documents, damped by configurable weight. Type-affinity scoring via parallel `entity_types` array.
- **4.6 Phase 3 - Structural Traversal** - AQL graph outbound from top node (depth 2). Corrective RAG: drop zero-SUMO-overlap structural nodes (TOC-guided nodes exempt).
- **4.7 Phase 4 - Score Fusion & Temporal Scoring** - Weighted sum across phases. Temporal decay contribution with three immunization guards. Final ranking.
- **4.8 Tier Classification** - Principal (≥2 phases, cross-doc, score ≥ 75th pctl), Integrity (Principal + verified neighbours with provenance), Explorer (frontier beyond Integrity, metadata-only). Grounded in Bates' Berrypicking + Pirolli's Information Foraging Theory.
- **4.9 Advanced Modes** - Chain-of-Retrieval (iterative), Agentic RAG (Gemini-driven tool dispatch), Reasoning RAG (sub-query gap fill), Speculative RAG (pre-warm frontier), Self-RAG (responsiveness verification), REFEED RAG (human feedback → weight tuning).

**TODO**: Provide algorithmic pseudocode for the fusion + tier classification. Ablation: which phases contribute most to Principal-tier quality.

---

## **5. Ingest Pipeline: Document → Space-Time Graph**

- **5.1 Parsing & Chunking** - LiteParse for PDF/EPUB/DOCX; Markdown pass-through. SHA-256 dedup.
- **5.2 LLM Structuring** - Gemini `gemini-2.5-flash-lite` maps chunks → DoCO nodes (Chapter, Section, Paragraph, Table, Figure, Authors, Bibliography). Content-hash caching. Parallel batches (concurrency=4).
- **5.3 SUMO Tag Validation** - Three-stage resolution (exact → case-insensitive → alias). Invalid tags dropped + logged.
- **5.4 Entity Extraction & Canonical Dedup** - 8 entity types, canonical slug normalization, opaque-token noise filter (`isOpaqueToken`).
- **5.5 Collection Transform** - Normalize into document/section/paragraph/table collections. Artifact filter (TOC noise, separator lines, short nodes). Fragment reattachment (orphaned short paragraphs).
- **5.6 Edge Creation & Document Rollup** - Structural edges → semantic edges (MENTIONS, RELATED_TO). Rollup: union entity_slugs + sumo_tags onto document node for O(docs) pre-filtering. `structure_needs_review` flag if level jumps > 1.
- **5.7 Cross-Document Similarity & Edge Enrichment** - Jaccard on entity sets ≥ threshold → `SIMILAR_TO` edge. Gemini enrichment: verb + tags + summary stored on edge (cached). `temporal_relation` derived from verb. EVERGREEN auto-promotion.

**TODO**: Benchmark: tokens per document, latency per stage, cache hit rate. Compare with naive chunk-and-embed pipeline.

---

## **6. Space-Time Graph Visualization**

- **6.1 Design Rationale** - Why 3D? The knowledge base has two irreducible dimensions: time (publication date) and structure (document hierarchy). A 2D projection always hides one. The tunnel metaphor lets both coexist.
- **6.2 Tunnel Layout** - Z-axis = time (temporal Z from bucketed `published_date`). Each document = a circular disc perpendicular to Z at its temporal position. Documents sharing the same Z-bucket are arranged radially.
- **6.3 Radial Disc Structure** - Document node at center. Section nodes arranged in concentric rings by level (L1 closest → L5 outermost). Paragraph and table nodes on the outermost ring. Ring radius computed dynamically: `max(35, ceil(n × (d+g) / 2π))`.
- **6.4 Entity/Tag Comet Shell** - Named entities and top-25 SUMO tags float in a cylindrical shell outside the tunnel. Deterministic hash-based placement. Tether lines connect entities to their document discs, tags to their section nodes.
- **6.5 Decay Aura Fins** - Semi-transparent planes perpendicular to each disc, extending along the Z-axis by decay class (EVERGREEN = 5 disc spans, SCHOLARLY = 2.5, CURRENT = 1, EPHEMERAL = 0.4). EPHEMERAL fins pulse in opacity. Fins use per-instance coloring from doc SUMO category.
- **6.6 Rendering Architecture** - Three.js `InstancedMesh` (1 draw call per shape bucket: sphere/tetrahedron/box/octahedron). Edge lines via `LineSegments`. Glow textures cached per hex. `OrbitControls` with tunnel entrance camera. HTML label overlay projected from 3D→2D per frame. Lazy neighbor loading on click.
- **6.7 Color Modes** - **by doc**: color from top SUMO category. **by type**: fixed palette per node type/level. **by SUMO**: golden-ratio HSL hue from ontology category. Resolution selector (day/week/month/year/decade/century) re-buckets temporal Z.
- **6.8 Interaction** - Click node → select + expand lazy-loaded neighbors + show selection edges. Click disc plane → open section panel. Raycaster with drag guard. Zoom (+/-/0 keyboard shortcuts).

**TODO**: User study (even informal) comparing task completion: "find all documents about X published before Y" on flat list vs tunnel visualization. Screenshots for each color mode.

---

## **7. Evaluation**

- **7.1 Retrieval Quality** - Precision@k / Recall@k on labeled query set. Compare: BM25-only, BM25+SUMO, full pipeline, full+Corrective RAG, full+Agentic. Measure Principal tier hit rate.
- **7.2 Tier Explainability** - For each Principal-tier node, analyze `contributions` array provenance. Hypothesis: multi-phase corroboration > single-phase retrieval.
- **7.3 Temporal Scoring Ablation** - With/without temporal decay. Measure ranking shifts on time-sensitive vs. time-agnostic queries.
- **7.4 Visualization Efficiency** - Render time vs. node count (InstancedMesh vs. individual meshes). Memory footprint. Interaction latency (hover, click, expand).
- **7.5 REFEED RAG Feedback Loop** - Measure accuracy-by-rank improvement after weight tuning from user feedback.

**TODO**: Concrete dataset + query set. Baselines: vanilla RAG (flat chunks), GraphRAG, vanilla BM25.

---

## **8. Discussion & Future Work**

- **8.1 Limitations** - Single LLM (Gemini) for structuring + enrichment → prompt sensitivity. In-memory simulator limited vs. full ArangoDB for large corpora. Visualization scalability (3D clutter with >50 docs). No user study yet.
- **8.2 Future Work** - (a) Vector ANN hybrid (Phase 1d with `text-embedding-004`); (b) Wiki export as human-readable knowledge base probe; (c) MCP integration for agent-driven workflows; (d) Collaborative multi-user annotations; (e) Multi-model LLM backend (not Gemini-only); (f) Formal user study on tunnel vs. flat-list retrieval.

**TODO**: Address reviewer-expected threats to validity.

---

## **9. Conclusion**

- Summarize: Space-Time Graph = structural hierarchy × temporal decay × cross-document ontology, visualized as a navigable 3D tunnel. Multi-phase retrieval with tiered provenance = explainable results. Efficient rendering via InstancedMesh + lazy loading.

---