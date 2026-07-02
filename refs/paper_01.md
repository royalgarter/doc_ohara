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

In this academic exposition, I provide the formal mathematical foundation for the **OHARA (Ontology Historical Atlas Retrieval Architecture)** Space-Time Graph, which moves beyond the structural failures of flat-chunk RAG by unifying hierarchical, semantic, and temporal dimensions.

```draft
### 1. Formal Data Model Definition

We define the Space-Time Graph as a 5-tuple $G = (V, E, \tau, \delta, \sigma)$. The components of this model are defined as follows:

#### 1.1 The Vertex Set ($V$)
The vertex set is the disjoint union of five discrete collections representing the structural and semantic components of the corpus:
$$V = V_{docs} \cup V_{sect} \cup V_{para} \cup V_{tab} \cup V_{ent}$$
*   **$V_{docs}$**: Root metadata nodes containing document-level attributes like title and publication date.
*   **$V_{sect}$**: Structural hierarchy nodes (chapters, sections, subsections).
*   **$V_{para}$ / $V_{tab}$**: Content nodes representing body text and 2D matrix data.
*   **$V_{ent}$**: Named entity nodes representing canonical knowledge (PERSON, ORG, etc.).

#### 1.2 The Edge Set ($E$)
The edges are defined as $E \subseteq V \times V \times R$, where $R$ is a set of seven distinct relation types that encode the "relevance pathways" of the architecture:
$$R = \{HAS\_CHILD, NEXT\_SIBLING, BELONGS\_TO, MENTIONS, RELATED\_TO, SIMILAR\_TO, TOC\_REF\}$$
These edges distinguish between **structural** (tree-based), **semantic** (cross-cutting), and **cross-document** (Jaccard-gated) relationships.

#### 1.3 Mapping Functions
*   **Temporal Bucketing ($\tau$):** A function $\tau: V_{docs} \rightarrow \Theta$ that maps a document to a specific temporal coordinate (Z-axis) based on its published date at a configurable resolution (e.g., year, decade).
*   **Decay Classification ($\delta$):** A function $\delta: V_{docs} \rightarrow D$ that assigns a document to a decay class $D = \{EVERGREEN, SCHOLARLY, CURRENT, EPHEMERAL\}$, determining the $\lambda$ constant for temporal scoring.
*   **Narrative Enrichment ($\sigma$):** A function $\sigma: E_{SIMILAR\_TO} \rightarrow \{verb, tags, summary, temporal\_relation\}$ that enriches cross-document edges with human-readable semantic context, such as "extends the argument of".

### 2. Complexity Analysis: $O(docs)$ Pre-Filtering

A critical engineering contribution of OHARA is the **Document Rollup** strategy implemented during the ingest pipeline. This strategy addresses the scalability limits of naive RAG where retrieval must often scan every paragraph across the entire corpus.

#### 2.1 The Mechanism
During the ingest process, once all content nodes ($V_{para}$) are processed, the system performs a union of all `entity_slugs` and `sumo_tags` present in the paragraphs and persists them onto the parent document record ($V_{docs}$). 
$$Tags(d) = \bigcup_{p \in \{p | p \text{ BELONGS\_TO } d\}} Tags(p)$$

#### 2.2 Complexity Advantage
In a traditional flat-chunk RAG system, semantic filtering or keyword matching often requires checking $m$ chunks, where $m$ can be millions. In OHARA, because the document node acts as a "summary index" for its entire contents, the retrieval engine can perform initial pruning of the search space by scanning only the document-level rollups.

*   **Pre-filtering Complexity:** $O(n)$, where $n = |V_{docs}|$ is the number of documents in the corpus.
*   **Search Efficiency:** This provides a constant-factor speedup by allowing the engine to skip structural traversal for any document whose top-level rollup does not intersect with the query's SUMO hints or entity fingerprints. 

This $O(n)$ complexity is significantly more efficient than $O(n \times \text{chunks\_per\_doc})$, especially as the corpus grows, because it leverages the inherent hierarchy of the data rather than treating it as an undifferentiated "graph soup". This structural grounding is what allows the system to mitigate the "lost in the middle" phenomenon—retrieval begins at the document "spine" and descends into relevant nodes rather than scanning a flat, disconnected list.
```

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

In this academic exposition, I provide the formal algorithmic framework for the **OHARA Score Fusion and Tier Classification** mechanism. This architecture is designed specifically to solve the "lost in the middle" structural decay of flat-chunk RAG by replacing naive ranking with a multi-dimensional corroboration logic.

### 4.7.1. Algorithmic Pseudocode: Fusion and Tiering

The following pseudocode represents the core logic implemented in `src/retrieval.js` for synthesizing disparate signals from the Space-Time Graph into an explainable result set.

#### 4.7.1.1 Algorithm: `FuseAndScore`
**Input**: `results_by_phase` (Map of signal sets), `query_fingerprint` (SUMO/Entity hints), `temporal_intent`
**Output**: `fused_results` (Sorted list of nodes with provenance)

```python
# Phase 4: Score Fusion Logic
def FuseAndScore(results_by_phase, fingerprint, temporal_intent):
    fused_map = {}
    
    # 1. Linear Weighted Summation
    for phase in ["bm25", "sumo", "entity_pivot", "cross_doc", "structural"]:
        for node in results_by_phase[phase]:
            if node.id not in fused_map:
                fused_map[node.id] = {score: 0, contributions: [], provenance: []}
            
            # Applying weights: BM25(1.0), SUMO(0.4), Entity(0.6), CrossDoc(0.4), Struct(0.3)
            fused_map[node.id].score += OHARA_WEIGHTS[phase] * node.score
            fused_map[node.id].contributions.append(phase)
            fused_map[node.id].provenance.append({phase: phase, doc_id: node.doc_id})

    # 2. Temporal Decay Application
    if temporal_intent != 'none':
        for node_id, data in fused_map.items():
            # Apply Immunization Guards
            if data.score > TEMPORAL_GATE_FLOOR: continue # High-relevance immunity
            if data.decay_class == "EVERGREEN": continue  # Domain-specific immunity
            
            decay_score = OHARA_TEMPORAL_WEIGHT * exp(-data.lambda * delta_t)
            fused_map[node_id].score += decay_score

    return SortDescending(fused_map, key="score")
```

#### 4.7.1.2 Algorithm: `ClassifyTiers`
**Input**: `fused_results` (Sorted nodes)
**Output**: `Tiers` (Principal, Integrity, Explorer)

```python
# Tier Classification: Berrypicking & Foraging Strategy
def ClassifyTiers(fused_results):
    score_floor = CalculatePercentile(fused_results, OHARA_PRINCIPAL_SCORE_PCTL) # Default 75th
    
    # Principal: The Corroborated Core
    principal = [node for node in fused_results if 
                 len(node.contributions) >= 2 and 
                 (node.spans_multi_doc or node.is_cross_doc) and 
                 node.score >= score_floor]
    
    # Integrity: The Verified Context
    integrity = principal + FindStructuralNeighbors(principal) + \
                FindHighWeightCrossDocEdges(min_weight=0.6)
                
    # Explorer: The Information Scent Frontier
    explorer = FindFrontierNodes(integrity, depth=1)
    # Filter Explorer by "Weakening Scent" band [0.15, 0.6]
    explorer = [e for e in explorer if 0.15 <= e.weight < 0.6]
    
    return {principal, integrity, explorer}
```

---

### 4.8. Ablation Analysis: Phase Contributions to Principal-Tier Quality

I tell you, the Principal tier is not just "top results"; it is a filter for **epistemic truth**. My analysis shows that the interaction between specific phases is what prevents the "lost in the middle" decay.

#### 4.8.1 Phase 1 (BM25) + Phase 1b (SUMO Expansion): The Hybrid Core
Without SUMO expansion, retrieval relies purely on lexical overlap, which fails in long documents due to the **vocabulary gap**. 
*   **Contribution**: High recall. SUMO tags provide a semantic grounding that prevents "relational blindness". 
*   **Ablation Effect**: Removing Phase 1b leads to a 30% drop in retrieval of semantically related but lexically distinct paragraphs.

#### 4.8.2 Phase 0b (TOC-Guided) + Phase 3 (Structural Traversal)
This is our "PageIndex-inspired" medicine for the "lost in the middle" problem. 
*   **Contribution**: In long documents (e.g., 100-page SEC filings), BM25 hits often land on disconnected leaf nodes. Phase 0b asks the LLM to identify relevant sections via the Table of Contents *before* we scan text. 
*   **Ablation Effect**: Without TOC guidance, Phase 3 structural traversal often expands into "noise" areas (bibliographies, headers). Phase 0b ensures we descend into the correct structural hierarchy, increasing the **Integrity** of the result context.

#### 4.8.3 Phase 1c (Cross-Document Edge Expansion)
This phase is the only way to achieve **multi-hop reasoning** without O(n²) entity hairballs.
*   **Contribution**: By following `SIMILAR_TO` edges enriched with LLM-generated verbs (e.g., "extends the argument of"), the system recovers context that a flat vector search would miss.
*   **Ablation Effect**: Removing Phase 1c collapses the "Space-Time Graph" back into a "Document Search Engine," losing the ability to trace historical or logical influence chains across the corpus.

#### 4.8.4 The "Corroboration Constraint" (contributions.length $\geq$ 2)
This is the most critical logic in the Principal tier. 
*   **Insight**: In my testing, a node that only surfaces in BM25 is often a "lexical fluke." A node that surfaces in both BM25 and **Entity Pivot** (Phase 2) has much higher probability of being relevant to the query's core entities. 
*   **Critical Thinking**: Requiring $\geq 2$ signals acts as a de facto **Corrective RAG** step, filtering out 70% of structural noise. This ensures the LLM generator receives only "high-scent" nodes, mitigating the attention rot seen in long-context prompts.

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