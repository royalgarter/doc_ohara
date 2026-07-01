# **The OHARA Space-Time Graph Architecture**

---

## **1. Introduction**

- **1.1 The Scalability Impasse in RAG** — Modern RAG variants sound powerful on paper: GraphRAG builds community clusters, PageIndex exploits document structure via TOC-guided tree descent, LLM Wiki incrementally grows a semantic network. Yet each breaks down when data explodes. Flat-chunk RAG suffers "lost in the middle" (Liu et al., 2024). GraphRAG's community Detection has O(n²) entity extraction cost and degrades as entity overlap saturates across thousands of documents. PageIndex is single-document — it has no cross-document reasoning at all, so scaling beyond one PDF means N independent trees with no connections. LLM Wiki lacks structural document hierarchy (Markdown files with wiki links, no DoCO types), so documents with complex internal structure (textbooks, legal contracts, technical standards) flatten into an undifferentiated graph soup. These systems optimize one dimension (structure *or* semantics *or* community) but none handle all three simultaneously as corpora grow.
- **1.2 The OHARA Thesis** — A knowledge base that is exploding in size demands a *spatial* and *temporal* mental model — not a longer flat list, not a 2D node-link diagram that becomes hairballs, but a **Space-Time Graph** where time flows along a navigable tunnel axis and document structure unfolds as radial discs at each temporal position. This metaphor turns "more data" from a liability into a visual advantage: more documents fill more disc positions along the timeline, making cross-document patterns *more* visible, not less.
- **1.3 Contributions** — (a) Space-Time Graph data model unifying structural hierarchy (DoCO), temporal exponential decay, and cross-document entity/SUMO pivots; (b) Multi-phase hybrid retrieval engine with explainable tier classification; (c) 3D tunnel visualization mapping time → Z-axis, document structure → concentric disc rings, decay class → aura fins; (d) SUMO-ontology-grounded semantic validation (22,700-entry index); (e) Unified architecture that subsumes 20+ RAG patterns (Standard, Corrective, Self, Speculative, REFEED, Agentic, CoR, Reasoning, Conversational, Adaptive, Fusion, Hybrid, Context-Aware, Citation-Aware, Hierarchical, Memory-Augmented, Multi-Hop, Prompt-Augmented, Context-Ranking, Entity-Pivot).
- **1.4 Paper Organization** — Roadmap of §2–§9.

**TODO**: Quantify "data explosion" claim with corpus-size benchmarks. Cite GraphRAG scaling limits (entity extraction cost). Frame PageIndex's single-doc limitation concretely. Frame LLM Wiki's structural flattening.

---

## **2. Why Existing RAG Architectures Break at Scale**

- **2.1 Flat-Chunk RAG: The List That Grows Forever** — As corpus size grows from 10 to 10,000 documents, the retrieved chunk list grows proportionally. The "lost in the middle" problem worsens. No spatial or temporal model helps the user understand *where* retrieved knowledge sits relative to other knowledge. You get ranked text, not a map.
- **2.2 GraphRAG / Community-Based: The Entity Saturation Problem** — GraphRAG's power is cross-document entity linking. But entity extraction cost is O(n × chunks_per_doc), and as corpora grow, entity overlap saturates — "Bitcoin" appears in 200 documents, creating a star topology that collapses community Detection into one giant cluster. The graph becomes a hairball. No temporal dimension means you cannot see *when* documents were written, only that they share entities.
- **2.3 PageIndex: Structure Without Connection** — PageIndex achieves 98.7% on FinanceBench by exploiting within-document TOC hierarchy. But it is fundamentally single-document: no `SIMILAR_TO` edges, no entity pivot, no SUMO tags, no temporal scoring, no multi-phase fusion, no tier system, no feedback loop. Scaling to 100 documents means 100 independent trees with zero cross-pollination. A user asking "how do these three contracts differ?" gets nothing from PageIndex — it has no inter-document graph.
- **2.4 LLM Wiki: Semantics Without Structure** — LLM Wiki builds an elegant persistent semantic network with Louvain community detection, Adamic-Adar weighting, and "surprising connections." But it discards document structure entirely — no DoCO types (Chapter/Section/Paragraph/Table), no structural traversal, no TOC-level navigation. A 300-page technical standard becomes a bag of wiki links. The graph handles cross-document semantics well but cannot guide a user *within* a document's architecture.
- **2.5 The Dimension Gap** — Summary table showing what each system lacks:

  | Capability | Flat RAG | GraphRAG | PageIndex | LLM Wiki | **OHARA** |
  |---|---|---|---|---|---|
  | Structural hierarchy (DoCO) | — | — | ✓ | — | **✓** |
  | Cross-document graph | — | ✓ | — | ✓ | **✓** |
  | Temporal decay model | — | — | — | — | **✓** |
  | Ontology-grounded tags | — | — | — | — | **✓** |
  | Spatial visualization | — | — | — | 2D graph | **3D tunnel** |
  | Multi-phase fusion | — | partial | — | 4-signal | **5-phase** |
  | Tier explainability | — | — | — | — | **3-tier** |

  **Key observation**: No prior system combines structural hierarchy + cross-document graph + temporal model + spatial visualization. The gap is the missing *spatiotemporal* dimension in knowledge base navigation.

**TODO**: Add quantitative scaling analysis (entity extraction time vs. corpus size for GraphRAG; chunk-list length vs. recall at different corpus sizes for flat RAG). Obtain PageIndex multi-doc benchmark if available.

---

## **3. The Space-Time Graph Data Model**

- **3.1 Design Principle: Two Irreducible Dimensions** — Knowledge bases have two orthogonal dimensions that no single 2D projection can faithfully represent: **time** (when was this written? how stale is it?) and **structure** (where does this paragraph sit within its document's hierarchy?). OHARA makes both first-class by encoding them into a multi-modal graph stored in ArangoDB with a one-to-one mapping to the 3D tunnel visualization.
- **3.2 Collections** — `documents` (root: source, title, entity_slugs, sumo_tags, published_date, decay_class, effective_decay_class, similar_to_indegree, description, structure_needs_review), `sections` (structural: level, title, summary), `paragraphs` (content: body, sumo_tags, entity_slugs, entity_types), `tables` (2D matrix), `entities` (canonical name, type, aliases, description, document_ids, mention_count), `edges` (single collection, typed by `relation` field).
- **3.3 Edge Taxonomy** — 7 typed edges partitioned into three categories: (a) Structural: `HAS_CHILD` (parent→child), `NEXT_SIBLING` (sequential ordering), `BELONGS_TO` (paragraph→document); (b) Semantic: `MENTIONS` (paragraph→entity), `RELATED_TO` (entity↔entity co-occurrence); (c) Cross-document: `SIMILAR_TO` (Jaccard-gated, LLM-enriched with verb/tags/summary/temporal_relation), `TOC_REF` (document→section resolved TOC entry). The key insight: `SIMILAR_TO` edges carry *narrative* metadata (`edge_verb`: "extends the argument of", `edge_summary`, `temporal_relation`: extends/supersedes/discusses) — not just a numeric weight. This is what makes cross-document traversal *explainable*, not just ranked.
- **3.4 Temporal Model** — Four decay classes with exponential decay rates: EVERGREEN (λ=10⁻⁶, ~infinite half-life — laws, math, classics), SCHOLARLY (λ=10⁻⁴, ~20-year half-life — papers, textbooks), CURRENT (λ=10⁻², ~70-day half-life — news, blogs), EPHEMERAL (λ=10⁻¹, ~7-day half-life — social posts, changelogs). Auto-promotion: `similar_to_indegree ≥ OHARA_SIMILAR_TO_EVERGREEN_THRESHOLD (5)` → `effective_decay_class = EVERGREEN` (often-cited documents are timeless regardless of declared class). Temporal scoring: `OHARA_TEMPORAL_WEIGHT × e^(−λ × Δt)` with three immunization guards (Principal tier immune, high-BM25 immune, no temporal intent → skip).
- **3.5 Formal Definition** — G = (V, E, τ, δ, σ) where V = ∪Cᵢ (C ∈ {documents, sections, paragraphs, tables, entities}), E ⊆ V × V × R (R = 7 relation types), τ: V_docs → Θ (temporal bucket function at configurable resolution), δ: V_docs → D (decay class ∈ {EVERGREEN, SCHOLARLY, CURRENT, EPHEMERAL}), σ: E_SIMILAR_TO → {verb, tags, summary, temporal_relation} (narrative enrichment). The graph supports O(|D|) pre-filtering at query time via document-rollup of entity_slugs and sumo_tags — a constant-factor speedup that flat RAG cannot achieve.

**TODO**: Formal complexity analysis of pre-filtering. State the "navigability" property: any node reachable via at most 3 edge-type hops from any document root.

---

## **4. Multi-Phase Hybrid Retrieval Engine**

- **4.1 Overview: From Flat List to Navigable Result** — OHARA's retrieval does not just rank chunks — it *navigates* a Space-Time Graph, crossing structural, semantic, temporal, and cross-document dimensions. Five phases run in configurable pipeline; results carry provenance for explainability.
- **4.2 Phase 0 — Input Parsing & Query Fingerprinting** — Tokenize → classify keyword (≤3 tokens) / phrase (4–30) / paragraph (>30). For phrase+: Gemini extracts `{sumo_tags, entity_hints, temporal_intent}` (cached, temperature 0). Conversational RAG: last N Q&A turns prepended for anaphora resolution. This is *Adaptive RAG* — shallow retrieval for simple queries, deep fingerprinting for complex ones.
- **4.3 Phase 0b — TOC-Guided Section Selection (PageIndex-inspired)** — For phrase/paragraph queries, fetch top-3 seed document section trees (titles + LLM-generated summaries, no content) → ask Gemini which sections are relevant → use as structural traversal entry points. This directly addresses the PageIndex critique: OHARA borrows PageIndex's within-document precision but applies it as a *phase* within a multi-phase pipeline, not as the entire strategy.
- **4.4 Phase 1 — BM25 + SUMO Expansion** — ArangoSearch BM25 over content/title/markdown. Phase 1b: SUMO tag overlap + entity-type affinity. Hierarchy expansion up to `SUMO_HIERARCHY_DEPTH` ancestors. This is *Hybrid RAG* — keyword + ontology-semantic fused.
- **4.5 Phase 1c — Cross-Document Edge Expansion** — Multi-hop `SIMILAR_TO` traversal (graph `1..expandDepth ANY`). Results carry `edge_verb`, `edge_summary`, `hops`. This is *Multi-Hop RAG* — but with narrative edges, not latent-hops through embedding space. Narratively-enriched edges mean the user can *read why* two documents are connected, not just see a proximity score.
- **4.6 Phase 2 — Entity Pivot** — Shared entity slugs across documents, damped by weight. `entity_types` array enables type-affinity scoring without extra AQL joins. This is *Memory-Augmented RAG* — persistent entity graph across all ingested docs.
- **4.7 Phase 3 — Structural Traversal + Corrective RAG** — AQL graph outbound from top node via structural edges (depth 2). Corrective RAG: zero-SUMO-overlap structural nodes dropped (TOC-guided nodes exempt). Structural proximity ≠ semantic relevance — a corrective filter that PageIndex lacks (PageIndex trusts tree structure implicitly).
- **4.8 Phase 4 — Score Fusion & Temporal Scoring** — Weighted sum: BM25×1.0 + SUMO×0.4 + entity×0.6 + cross-doc×0.4 + structural×0.3. Temporal decay added per node when `temporal_intent ≠ 'none'`, with three immunization guards. This is *Context-Aware RAG* — temporal intent gates temporal scoring.
- **4.9 Tier Classification — Berrypicking Meets Foraging Theory** — Inspired by Bates' Berrypicking (incremental info-seeking) and Pirolli's Information Foraging (follow scent, stop when weak): **Principal** (≥2 phases, cross-doc or multi-doc, score ≥ 75th pctl, capped at 5), **Integrity** (Principal + verified neighbours with provenance trail + optional LLM cross-check), **Explorer** (frontier one hop beyond Integrity, metadata-only, `stopped_reason` when scent weakens). This is *Citation-Aware RAG* + *Hierarchical RAG* + *Context-Ranking RAG* in one unified tier system.
- **4.10 Advanced Modes as RAG Pattern Orthography** — Table showing how OHARA subsumes 20+ RAG types as configuration toggles: Self-RAG (Principal responsiveness filter), Reasoning RAG (sub-query gap fill), Speculative RAG (pre-warm frontier), REFEED RAG (thumbs up/down → weight tuning), Agentic RAG (Gemini-driven tool dispatch loop), Chain-of-Retrieval (iterative Explorer-chasing). Each is a toggle, not a separate system. This architectural economy is itself a contribution — one engine, many behaviors.

**TODO**: Pseudocode for fusion + tier classification. Ablation: which phases contribute to Principal-tier quality at different corpus sizes (10, 100, 1000 docs).

---

## **5. Ingest Pipeline: From Documents to Space-Time Graph**

- **5.1 Parsing & Dedup** — LiteParse (PDF/EPUB/DOCX) → Markdown; `.md` pass-through. SHA-256 dedup (skip if seen, override with `--force`). Web crawl: all pages from same hostname bundled into single document (one `documents` node per domain).
- **5.2 LLM Structuring — DoCO Typing** — Gemini `gemini-2.5-flash-lite` maps Markdown chunks to DoCO nodes (Chapter, Section, Paragraph, Table, Figure, Authors, Bibliography). Content-hash caching. Parallel batches (concurrency=4). Output schema includes per-node `sumo_candidate_tags`, `candidate_entities`, and document-level temporal fields (`published_date`, `temporal_coverage`, `temporal_granularity`, `temporal_confidence`, `decay_class`).
- **5.3 SUMO Tag Validation — Ontology Grounding** — Three-stage resolution against 22,700-entry SUMO index: exact → case/separator-insensitive → alias table (~50 LLM-emitted terms → canonical). Invalid tags dropped + logged. This is a precision gate that prevents hallucinated ontology mappings — a problem LLM Wiki faces directly (it relies on emergent clusters, not grounded ontology).
- **5.4 Entity Extraction & Canonical Dedup** — 8 entity types (PERSON, ORG, LOCATION, DATE, TECH, AMOUNT, EVENT, CONCEPT). Canonical dedup within node. `isOpaqueToken()` heuristic rejects machine-generated identifiers (hashes, UUIDs, base58) — domain-agnostic noise filter. Cross-document dedup (`entity_dedup.js`) merges entity nodes with matching `norm_key`, repoints all `MENTIONS` edges.
- **5.5 Collection Transform** — Normalize into 4 collections. Artifact filter: remove separator lines, TOC noise, short nodes. Fragment reattachment: merge orphaned short paragraphs into parent section. This is *Sparse RAG* at ingest time — the problem is solved structurally, not at retrieval time.
- **5.6 Edge Creation & Structural Verification** — Structural edges (`HAS_CHILD`, `NEXT_SIBLING`, `BELONGS_TO`) + semantic edges (`MENTIONS`, `RELATED_TO`). Document rollup: union entity_slugs + sumo_tags onto document node → O(docs) pre-filtering. `structure_needs_review: true` if level jumps > 1 detected — the PageIndex-inspired verification gate.
- **5.7 Cross-Document Similarity & Narrative Enrichment** — Jaccard on entity sets ≥ threshold → `SIMILAR_TO` edge. Gemini generates per-edge: `verb` (e.g. "extends the argument of"), `tags` (1–4 SUMO-style concepts), `summary` (≤60 words), `temporal_relation` (extends/supersedes/discusses, derived from verb at zero extra LLM cost). EVERGREEN auto-promotion: `similar_to_indegree ≥ 5` → `effective_decay_class = EVERGREEN`. This narrative enrichment means every cross-document edge is *human-readable* — the graph can be traversed by a reader, not just an algorithm.

**TODO**: Benchmark: cost per document (tokens, latency), cache hit rates, entity dedup reduction ratio. Compare with GraphRAG entity extraction cost at same corpus size.

---

## **6. The Space-Time Graph Visualization: A Tunnel Through Knowledge**

- **6.1 Why 3D? The Dimension Argument** — A knowledge base has two irreducible dimensions: time (publication date, temporal coverage) and structure (document hierarchy). Any 2D projection collapses one. OHARA's tunnel layout preserves both: **Z-axis = time, XY-plane = structure**. As data explodes, documents fill more disc positions along the tunnel — the visualization *benefits* from scale, unlike 2D node-link diagrams that become hairballs beyond ~100 nodes.
- **6.2 Tunnel Layout** — Documents sorted by date → mapped to Z position via temporal bucketing at configurable resolution (day/week/month/year/decade/century). Documents sharing the same Z-bucket are arranged radially to avoid overlap. The user "flies through" the tunnel: close = recent, far = historical. This is *time as space* — the same metaphor used in timeline visualizations, but extended into a volumetric graph where each time-slice contains the full structural graph of its documents.
- **6.3 Radial Disc Structure — Document as Spine** — Each document occupies a circular disc perpendicular to Z at its temporal position. Document node at center. Section nodes arranged in concentric rings by level (L1 closest → L5 outermost). Paragraph/table nodes on the outermost ring. Ring radius adapts dynamically: `max(35, ceil(n × (diam + gap) / 2π))`. This directly encodes the PageIndex-style tree hierarchy as a *spatial* structure — the user can see "this is a deep document" (many rings) vs. "this is flat" (few rings).
- **6.4 Entity/Tag Comet Shell** — Named entities (sorted by mention_count) and top-25 SUMO tags float in a cylindrical shell **outside** the tunnel (radius between `maxDiscR + 80` and `maxDiscR + 320`). Deterministic hash-based angular + radial placement. Tether lines connect entities to their document discs, tags to their containing sections. This is the cross-document semantic layer: an entity shared by 5 documents produces 5 tether lines converging on the same comet point — visual proof of cross-document connectivity that PageIndex and flat RAG simply cannot show.
- **6.5 Decay Aura Fins — Time Made Visible** — Semi-transparent planes extending from each document disc along the Z-axis, with length proportional to decay class: EVERGREEN spans 5 disc-lengths (blue), SCHOLARLY spans 2.5 (gray), CURRENT spans 1 (darker gray), EPHEMERAL spans 0.4 (light, pulsing opacity). These fins make *temporal authority* visually immediate: a user can see at a glance that a 1920s mathematics paper (EVERGREEN) still "reaches" into present-day Z positions, while a 2024 news article (EPHEMERAL) barely extends beyond its own disc. No other RAG system makes temporal decay *spatially* legible.
- **6.6 Rendering Architecture — Efficiency at Scale** — Three.js `InstancedMesh`: 1 draw call per shape bucket (sphere=doc, tetrahedron=section, box=paragraph, octahedron=table). Edges: single `LineSegments`. Decay fins: 4 `InstancedMesh` (one per class). Glow textures: cached per hex color. Labels: HTML overlay projected from 3D→2D per frame. **Lazy loading**: nodes fetched per-document on selection; neighbors fetched per-node on click. This means the visualization complexity is O(selected_docs), not O(total_corpus) — the user progressively loads only what they explore. This is the key to scaling: **the tunnel renders at constant frame rate regardless of total corpus size**.
- **6.7 Color Modes as Analytical Lenses** — **by doc**: color from top SUMO category (golden-ratio HSL) → reveals ontology clusters at a glance. **by type**: fixed palette per node type/level → reveals structural patterns. **by SUMO**: per-tag hash → reveals semantic diversity within a document. Each mode is a different "mental spotlight" on the same graph — the user toggles lenses without re-fetching data.
- **6.8 Interaction Design** — Click node → select + expand lazy-loaded neighbors + render selection edges (highlighted graph context). Click disc plane → open section navigation panel. Raycaster for hover tooltips. OrbitControls with tunnel-entrance camera position. Zoom (+/-/0 keyboard). Drag guard (distinguish click from orbit). Query results cross-link: clicking a result card auto-selects its document and pulses the node.
- **6.9 How This Addresses the Scale Problem** — Summary: data explosion makes flat lists un-navigable and 2D graphs into hairballs. The tunnel visualization turns scale into an asset: more documents = denser, more informative temporal spine. Structural rings make within-document navigation immediate. Comet shell makes cross-document entity sharing visible. Decay fins make temporal authority spatial. The user navigates *space and time* instead of scrolling a list.

**TODO**: User study design (flat list vs. tunnel for cross-document retrieval tasks). Rendering performance benchmarks (FPS vs. node count). Side-by-side screenshots: same 50-document corpus as flat list vs. tunnel.

---

## **7. Evaluation**

- **7.1 Retrieval Quality at Scale** — Compare OHARA vs. flat-chunk RAG vs. GraphRAG on labeled queries at corpus sizes 10, 100, 1000 docs. Measure Precision@5, Recall@20, Principal-tier hit rate. Hypothesis: OHARA's multi-phase fusion maintains quality as corpus grows; flat RAG degrades ("lost in the middle"); GraphRAG degrades via entity saturation.
- **7.2 Cross-Document Reasoning** — Queries requiring information from 2+ documents (e.g. "how do Document A and Document B differ on topic X?"). Compare: PageIndex (cannot answer — no cross-doc graph), LLM Wiki (can answer via semantic links but no structural navigation), OHARA (SIMILAR_TO edges + entity pivot + tier provenance). Measure: accuracy, provenance traceability.
- **7.3 Temporal Scoring Ablation** — With/without temporal decay. With/without decay class auto-promotion. Measure ranking shifts on time-sensitive vs. time-agnostic queries.
- **7.4 Visualization Task Performance** — Between-subjects study: (a) "Find all documents about topic X published before year Y" (flat list vs. tunnel). (b) "Which entities connect Document A and Document B?" (2D graph vs. tunnel comet shell). (c) "Which documents are still authoritative despite being old?" (list with date column vs. tunnel with decay fins). Hypothesis: tunnel is faster and more accurate for spatial-temporal tasks; flat list is faster for simple keyword lookup.
- **7.5 Rendering Scalability** — Measure FPS, memory, and interaction latency at 10, 50, 100, 500 selected document nodes. Document: InstancedMesh scales linearly; lazy loading keeps constant frame rate.
- **7.6 REFEED RAG Feedback Loop** — Measure accuracy-by-rank improvement across feedback iterations. Show that `tune_weights.js` suggestions converge.

**TODO**: Define labeled query dataset. Obtain baselines. Run pilot user study (even n=3 informal).

---

## **8. Discussion**

- **8.1 When PageIndex Is Still Better** — For single-document QA on well-structured PDFs (financial reports, legal contracts), PageIndex's dedicated TOC-correction pipeline may outperform OHARA's more general approach. Acknowledge this: OHARA is designed for *multi-document, multi-temporal* corpora, not single-doc precision benchmarks.
- **8.2 What OHARA Can Learn from LLM Wiki** — Louvain community detection on `SIMILAR_TO` graph for emergent (not just top-down SUMO) clusters. "Surprising connections" — flagging unexpected cross-community edges. Adamic-Adar weighting for Phase 1c cross-doc edges. Two-step ingest (analyze contradictions before writing nodes). Web-augmented deep research tool for Agentic RAG when local corpus is insufficient.
- **8.3 Limitations** — Single LLM backend (Gemini); no vector ANN released (Phase 1d planned but not benchmarked); 3D visualization requires WebGL and may be disorienting for first-time users; no formal user study yet; web crawl ingest per-hostname bundling may obscure important page-level distinctions; entity dedup is batch-only (not streaming).
- **8.4 Threats to Validity** — Evaluation corpus may not represent all domains. Visualization study may have learning-curve bias. Gemini-specific prompts may not transfer to other LLMs.

**TODO**: Address each limitation with concrete mitigation or future work plan.

---

## **9. Conclusion**

- The Space-Time Graph is a data model and visualization metaphor designed for the regime where data outgrows flat lists and 2D graphs. By encoding time as a spatial axis (tunnel Z) and structure as a spatial geometry (radial disc rings), OHARA turns corpus growth from a retrieval liability into a navigable landscape. Multi-phase retrieval with tiered provenance provides explainability. SUMO-validated ontology tags prevent hallucinated semantics. Temporal decay fins make document authority spatially legible. The system subsumes 20+ RAG patterns as configuration toggles rather than separate architectures. Future work: vector ANN hybrid, Louvain emergent clusters, formal user study, multi-LLM backend support.

---

**Appendix A: RAG Pattern Coverage Matrix** — Full 25-type table from `refs/ohara_vs_25_rag.md` showing "Covered" / "Implemented" / "Skip" with OHARA mechanism mappings.

**Appendix B: OHARA vs PageIndex Feature Comparison** — From `refs/ohara_vs_pageindex.md`: cross-doc, entity pivot, SUMO, temporal, multi-phase, tier, feedback — all absent in PageIndex.

**Appendix C: OHARA vs LLM Wiki Feature Comparison** — From `refs/ohara_vs_llm_wiki.md`: structural graph, temporal, SUMO, tiers, CoR/Speculative — absent in LLM Wiki; Louvain, surprising connections, Adamic-Adar — absent in OHARA.

---

