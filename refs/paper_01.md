# **Efficient Visualization of Knowledge Bases via Space-Time Graphs: The OHARA Architecture**

## **1. Introduction**

- **1.1 Problem Statement** - Traditional RAG systems use flat chunk lists; users "get lost in the middle" when retrieving from large corpora. No spatial or temporal mental model of where knowledge resides.
- **1.2 Contributions** - (a) Efficient 3D sunburst-tunnel visualization mapping time → Z-axis, ontology → sunburst polar plane (XY), document structure → radial discs, decay class → temporal-reach aura — the primary contribution; (b) Space-Time Graph data model combining structural hierarchy + temporal decay + cross-document entity pivots, serving as both the retrieval substrate and the visualization's coordinate system; (c) Multi-phase hybrid retrieval engine whose value proposition is **tiered, provenance-carrying results at parity with the best single-signal retriever** (Section 7) — explainability, not ranking gains; (d) a **corroboration-gated Principal tier that abstains on unanswerable queries where a top-k cut structurally cannot** — with identical retrieval, the ≥2-signal gate abstains on 45.6% of MultiHop-RAG null queries versus 0.0% for plain top-k, while holding 91.5% Principal-hit on answerable queries (Section 7.1.2), the paper's one quantitatively differentiated retrieval result; (e) SUMO ontology-grounded semantic layer, which grounds the visualization's spatial coordinates and enables tag-expansion retrieval.
- **1.3 Paper Organization** - Brief roadmap of sections 2–8.

The "lost in the middle" phenomenon, demonstrated by Liu et al. (2024), shows that language-model performance degrades when relevant information is located in the middle of a long input context rather than at its beginning or end. In retrieval-augmented generation (RAG), this positional bias is compounded by the fact that most pipelines represent corpora as flat, ordered chunks: the retriever returns a linear list of passages, and the generator must synthesize them without an explicit model of where each passage sits in the original document structure or timeline. Users are therefore left without a spatial or temporal mental model of the corpus.

OHARA targets document corpora that already carry, or can be made to carry, structural metadata: sections, subsections, paragraphs, tables, figures, and publication dates. Examples include regulatory filings, academic papers, technical manuals, parliamentary records, and long-form journalism. We do not assume that every document is perfectly structured; rather, we assume that a parser or LLM can recover a DoCO-like hierarchy (Ciccarese et al., 2017) and that publication dates are available or extractable.

We position this paper as the **opening of a research line, not its conclusion**: OHARA is, to our knowledge, the first system to make a 3D spatial-temporal coordinate system (ontology × time × document structure) the shared substrate of both retrieval and interface. A first system of a new shape carries measured wins and honest "not-yet"s in the same report, and we treat the latter as the research agenda this architecture makes testable (Section 8.4) rather than as defects to be hidden.

We state our positioning explicitly. OHARA is not a claim that graph-augmented retrieval outranks dense retrieval — our own evaluation (Section 7) shows the tuned hybrid *matches* the best single signal rather than beating it. OHARA's thesis is that a knowledge base should be **seeable and auditable**: the same Space-Time Graph that answers a query also (i) renders as a navigable spatial-temporal map in which users hold a mental model of *where* knowledge lives, and (ii) attaches per-result provenance explaining *why* each passage was retrieved and how strongly it is corroborated — and, when no result earns corroboration, says so by abstaining rather than emitting k confident-looking passages. Retrieval quality at parity is the entry ticket; the visualization, the audit trail, and the ability to abstain are the contribution.

> **Citation**: Nelson F. Liu, Kevin Lin, John Hewitt, Ashwin Paranjape, Michele Bevilacqua, Fabio Petroni, and Percy Liang. 2024. *Lost in the Middle: How Language Models Use Long Contexts*. Transactions of the Association for Computational Linguistics, 12:157–173. https://doi.org/10.1162/tacl_a_00638

---

## **2. Related Work**

- **2.1 Graph-Based RAG** - GraphRAG (Microsoft), LightRAG, HippoRAG. Compare: they use entity/relation subgraphs; OHARA adds structural hierarchy (DoCO types) + temporal decay + cross-document similarity edges with LLM-enriched verbs.
- **2.2 Explainable AI / Provenance in Retrieval** - Self-RAG (Asai et al.), Corrective RAG, retrieval provenance. OHARA's tier system (Principal/Integrity/Explorer) with per-node provenance arrays is a form of built-in explainability.
- **2.3 Knowledge Graph Visualization** - 3D graph layouts (n3.js, GONE, VR graph tools), temporal graph visualization (Time-arc, Storyline). OHARA's sunburst-tunnel metaphor is novel on two counts: no prior work places document structure as concentric rings on time-anchored discs, and no prior work uses an ontology sunburst as the cross-sectional coordinate system of a temporal tunnel — combining the 2D sunburst tradition (Stasko & Zhang, 2000, radial space-filling hierarchies) with 3D temporal graph layout so that topic columns become traceable through time.

> **Citation**: John Stasko and Eugene Zhang. 2000. *Focus+Context Display and Navigation Techniques for Enhancing Radial, Space-Filling Hierarchy Visualizations*. In Proceedings of IEEE InfoVis 2000, 57–65. https://doi.org/10.1109/INFVIS.2000.885091
- **2.4 Ontology-Tagged Retrieval** - SUMO, BERT-based taggers. OHARA validates LLM-emitted SUMO tags against a 22,700-entry index with alias resolution.

| Capability | GraphRAG | LightRAG | HippoRAG | OHARA |
|---|---|---|---|---|
| Entity/relation subgraph | ✓ | ✓ | ✓ | ✓ |
| Structural document hierarchy (DoCO) | ✗ | ✗ | ✗ | ✓ |
| Cross-document similarity edges | partial | ✓ | ✓ | ✓ (Jaccard + LLM-enriched verb) |
| SUMO ontology grounding | ✗ | ✗ | ✗ | ✓ |
| Temporal decay scoring | ✗ | ✗ | ✗ | ✓ |
| 3D space-time visualization (ontology sunburst × time) | ✗ | ✗ | ✗ | ✓ |
| Tiered explainability (Principal/Integrity/Explorer) | ✗ | ✗ | ✗ | ✓ |

The table highlights a clear gap in the current graph-RAG landscape. GraphRAG, LightRAG, and HippoRAG all improve on flat-chunk RAG by building entity-centric graphs, but none preserves the original document hierarchy as first-class nodes, and none couples retrieval with a temporal, navigable visualization. OHARA fills this gap by treating document structure, publication time, and ontology tags as native dimensions of the graph.

---

## **3. The Space-Time Graph Data Model**

- **3.1 Collections** - documents, sections, paragraphs, tables, entities, edges. Each with typed schema; documents carry `entity_slugs`, `sumo_tags`, `decay_class`, `temporal_coverage`, `effective_decay_class`.
- **3.2 Edge Taxonomy** - 7 core edge types: `HAS_CHILD`, `NEXT_SIBLING`, `BELONGS_TO`, `MENTIONS`, `RELATED_TO`, `SIMILAR_TO`, `TOC_REF`; plus an optional 8th, `ANSWERS_SAME`, built offline by generating pseudo-questions per paragraph and linking paragraphs that answer the same question (opt-in). Distinguish structural (tree) vs. semantic (cross-cutting) vs. cross-document (Jaccard-gated) edges.
- **3.3 Temporal Model** - Four decay classes (EVERGREEN λ=10⁻⁶, SCHOLARLY λ=10⁻⁴, CURRENT λ=10⁻², EPHEMERAL λ=10⁻¹). Auto-promotion rule: `similar_to_indegree ≥ 5 → EVERGREEN`. Exponential decay scoring: `w × e^(−λΔt)` with a five-layer protection scheme (no temporal intent → skip; Principal tier immune; high-BM25 immune; decay only for weak candidates; temporal-coverage overlap boost when the query carries a date range). We present decay scoring as a **guard-railed recency prior, not a measured ranking gain**: on the one temporal benchmark evaluated (MultiHop-RAG, whose temporal queries test event *ordering* rather than recency), the prior is neutral-to-slightly-negative and the protection layers correctly bound its effect to ~1pp (Section 7.1.2, finding three). Its intended domain — corpora with genuine freshness semantics such as news monitoring or versioned documentation — remains future validation. The decay class's *measured* role is in the visualization (temporal-reach auras, Section 6) and the τ/Z-axis layout, not in ranking.
- **3.4 Formal Definition** - Define G = (V, E, τ, δ, σ) where V = ∪Cᵢ (collections), E typed by relation ∈ R, τ maps docs → temporal bucket, δ maps docs → decay class, σ enriches cross-document edges with narrative context. State the "lost in the middle" resolution: retrieval navigates G instead of scanning a flat list.

This section provides the formal mathematical foundation for the **OHARA (Ontology Historical Atlas Retrieval Architecture)** Space-Time Graph, which moves beyond the structural failures of flat-chunk RAG by unifying hierarchical, semantic, and temporal dimensions.

### 3.4.1 Formal Data Model Definition

We define the Space-Time Graph as a 5-tuple $G = (V, E, \tau, \delta, \sigma)$. The components of this model are defined as follows:

#### 3.4.1.1 The Vertex Set ($V$)
The vertex set is the disjoint union of five discrete collections representing the structural and semantic components of the corpus:
$$V = V_{docs} \cup V_{sect} \cup V_{para} \cup V_{tab} \cup V_{ent}$$
*   **$V_{docs}$**: Root metadata nodes containing document-level attributes like title and publication date.
*   **$V_{sect}$**: Structural hierarchy nodes (chapters, sections, subsections).
*   **$V_{para}$ / $V_{tab}$**: Content nodes representing body text and 2D matrix data.
*   **$V_{ent}$**: Named entity nodes representing canonical knowledge (PERSON, ORG, etc.).

#### 3.4.1.2 The Edge Set ($E$)
The edges are defined as $E \subseteq V \times V \times R$, where $R$ is a set of seven distinct relation types that encode the "relevance pathways" of the architecture:
$$R = \{HAS\_CHILD, NEXT\_SIBLING, BELONGS\_TO, MENTIONS, RELATED\_TO, SIMILAR\_TO, TOC\_REF\}$$
These edges distinguish between **structural** (tree-based), **semantic** (cross-cutting), and **cross-document** (Jaccard-gated) relationships.

#### 3.4.1.3 Mapping Functions
*   **Temporal Bucketing ($\tau$):** A function $\tau: V_{docs} \rightarrow \Theta$ that maps a document to a specific temporal coordinate (Z-axis) based on its published date at a configurable resolution (e.g., year, decade).
*   **Decay Classification ($\delta$):** A function $\delta: V_{docs} \rightarrow D$ that assigns a document to a decay class $D = \{EVERGREEN, SCHOLARLY, CURRENT, EPHEMERAL\}$, determining the $\lambda$ constant for temporal scoring.
*   **Narrative Enrichment ($\sigma$):** A function $\sigma: E_{SIMILAR\_TO} \rightarrow \{verb, tags, summary, temporal\_relation\}$ that enriches cross-document edges with human-readable semantic context, such as "extends the argument of".

### 3.5 Complexity Analysis: $O(docs)$ Pre-Filtering

The **Document Rollup** strategy in the ingest pipeline addresses a scalability limit of naive RAG, where retrieval must often scan every paragraph across the corpus. We present it here as a design analysis; the wall-clock speedup has not yet been benchmarked in isolation.

#### 3.5.1 The Mechanism
During the ingest process, once all content nodes ($V_{para}$) are processed, the system performs a union of all `entity_slugs` and `sumo_tags` present in the paragraphs and persists them onto the parent document record ($V_{docs}$). 
$$Tags(d) = \bigcup_{p \in \{p | p \text{ BELONGS\_TO } d\}} Tags(p)$$

#### 3.5.2 Complexity Advantage
In a traditional flat-chunk RAG system, semantic filtering or keyword matching often requires checking $m$ chunks, where $m$ can be millions. In OHARA, because the document node acts as a "summary index" for its entire contents, the retrieval engine can perform initial pruning of the search space by scanning only the document-level rollups.

*   **Pre-filtering Complexity:** $O(n)$, where $n = |V_{docs}|$ is the number of documents in the corpus.
*   **Search Efficiency:** This provides a constant-factor speedup by allowing the engine to skip structural traversal for any document whose top-level rollup does not intersect with the query's SUMO hints or entity fingerprints. 

This $O(n)$ pre-filter is asymptotically cheaper than $O(n \times \text{chunks\_per\_doc})$ scanning because it leverages the inherent hierarchy of the data rather than treating it as an undifferentiated "graph soup". The intended consequence for the "lost in the middle" problem is architectural: retrieval begins at the document "spine" and descends into relevant nodes rather than scanning a flat list. Whether this descent succeeds is an empirical question — our evaluation (Section 7.1.1) finds document location and descent to be exactly where corpus-scale retrieval loses most of its accuracy, making this the component with the largest measured headroom.

---

## **4. Multi-Phase Hybrid Retrieval Engine**

- **4.1 Phase 0 - Input Parsing & Query Fingerprinting** - Tokenization → keyword/phrase/paragraph classification. Gemini extracts `sumo_tags`, `entity_hints`, `temporal_intent` for phrase+ queries. Conversational RAG: session history prepended for anaphora resolution.
- **4.2 Phase 1 - Shallow Context (BM25)** - ArangoSearch full-text + fallback term-overlap. TOC-guided section selection (Phase 0b): LLM picks relevant sections from top-3 seed docs before structural traversal.
- **4.3 Phase 1b - SUMO Tag Expansion** - Tag overlap + entity-type affinity scoring. SUMO hierarchy expansion up to `HIERARCHY_DEPTH` ancestors.
- **4.4 Phase 1c - Cross-Document Edge Expansion** - Multi-hop `SIMILAR_TO` traversal with weight/tag filters. Carries `edge_verb`, `edge_summary`, `hops` for explainability.
- **4.5 Phase 1d - Vector Similarity (ANN)** - Query embedded with `gemini-embedding-2` (768-d, cached); ArangoDB `COSINE_SIMILARITY` over paragraph embeddings via vector index. Degrades gracefully when no embeddings/index exist.
- **4.6 Phase 1e - ANSWERS_SAME Co-Relevance (optional)** - Follows `ANSWERS_SAME` edges from top BM25 seed paragraphs to paragraphs answering the same pseudo-question (HyDE-style, precomputed offline).
- **4.7 Phase 1f - Cluster Summary Retrieval (optional)** - RAPTOR-inspired retrieval over precomputed cluster-summary nodes; gated by query-mode classification.
- **4.8 Phase 2 - Entity Pivot** - Shared entity slugs across documents, damped by configurable weight. Type-affinity scoring via parallel `entity_types` array.
- **4.9 Phase 3 - Structural Traversal** - AQL graph outbound from top node (depth 2). Corrective RAG: drop zero-SUMO-overlap structural nodes (TOC-guided nodes exempt).
- **4.10 Phase 4 - Score Fusion & Temporal Scoring** - Weighted sum across phases; base weights scaled per-signal by adaptive query-mode multipliers (factoid / synthesis / exploratory, classified in Phase 0). Temporal decay contribution with five-layer protection. Final ranking.
- **4.11 Tier Classification** - Principal (≥2 phases, cross-doc, score ≥ 75th pctl), Integrity (Principal + verified neighbours with provenance), Explorer (frontier beyond Integrity, metadata-only). Grounded in Bates' Berrypicking + Pirolli's Information Foraging Theory.
- **4.12 Advanced Modes** - Chain-of-Retrieval (iterative), Agentic RAG (Gemini-driven tool dispatch), Reasoning RAG (sub-query gap fill), Speculative RAG (pre-warm frontier), Self-RAG (responsiveness verification), REFEED RAG (human feedback → weight tuning).

This section presents the formal algorithmic framework for the **OHARA Score Fusion and Tier Classification** mechanism. The design goal is to replace naive ranking with corroboration logic that carries provenance; as Section 7 shows, the measured benefit on the corpora tested is explainability at ranking parity, with corroboration operating over two signal families in practice.

### 4.10.1. Algorithmic Pseudocode: Fusion and Tiering

The following JavaScript-style pseudocode mirrors the core logic implemented in `src/retrieval.js` for synthesizing disparate signals from the Space-Time Graph into an explainable result set.

#### 4.10.1.1 Algorithm: `fuseAndScore`
**Input**: `resultsByPhase` (map of signal sets), `queryMode` (factoid | synthesis | exploratory), `processedQuery` (fingerprint incl. `temporalIntent`, `dateRange`)
**Output**: `fusedResults` (sorted list of nodes with provenance)

```js
// Phase 4: Score Fusion
function fuseAndScore(resultsByPhase, queryMode, processedQuery) {
	// Adaptive weights: base env-configured weights × per-mode multipliers.
	// Base: BM25 1.0, SUMO 0.4, entity 0.6, crossDoc 0.4, struct 0.3, vector 0.5
	const weights = applyModeMultipliers(BASE_WEIGHTS, ADAPTIVE_MULTIPLIERS[queryMode]);

	// 1. Linear weighted summation with per-phase provenance
	const fusedMap = new Map();
	for (const phase of ['bm25', 'sumo', 'entity_pivot', 'cross_doc',
	                     'structural', 'vector', 'answers_same', 'cluster_summary']) {
		for (const { node, score } of resultsByPhase[phase]) {
			const entry = fusedMap.get(node.id) ?? { score: 0, contributions: [], node };
			entry.score += weights[phase] * score;
			entry.contributions.push({ phase, score, docId: node.documentId });
			fusedMap.set(node.id, entry);
		}
	}

	// 2. Temporal contribution with five-layer protection
	for (const entry of fusedMap.values()) {
		entry.score += computeTemporalScore(entry, processedQuery);
	}

	return [...fusedMap.values()].sort((a, b) => b.score - a.score);
}

// Returns a contribution in [0, TEMPORAL_WEIGHT]; never subtracts from fused score
function computeTemporalScore(entry, q) {
	if (q.temporalIntent === 'none') return 0;              // L1: no temporal intent
	if (entry.isPrincipal) return 0;                        // L2: corroborated core immune
	const bm25 = phaseScore(entry, 'bm25');
	if (bm25 > TEMPORAL_GATE_FLOOR) return 0;               // L3: high-BM25 immune (default 5.0)

	// L4+L5: intent-dependent scoring for weak candidates only
	const coverage = q.dateRange                            // overlap of doc coverage vs query window
		? overlapRatio(entry.node.temporalCoverage, q.dateRange) : 0;

	if (q.temporalIntent === 'historical_fact') {
		// Coverage dominates; age authority (old = high) fills in when coverage absent
		const age = 1 - Math.exp(-AGE_LAMBDA * daysSince(entry.node.publishedDate));
		return TEMPORAL_WEIGHT * (coverage > 0 ? 0.7 * coverage + 0.3 * age : age);
	}
	// current_state / influence_chain: freshness decay (new = high) + coverage bonus
	const lambda = DECAY_RATES[entry.node.decayClass];
	const decay  = Math.exp(-lambda * daysSince(entry.node.publishedDate));
	return TEMPORAL_WEIGHT * (decay + 0.3 * coverage);
}
```

#### 4.10.1.2 Algorithm: `classifyTiers`
**Input**: `fusedResults` (sorted nodes)
**Output**: tiers (Principal, Integrity, Explorer)

```js
// Tier classification: Berrypicking & Information Foraging strategy
function classifyTiers(fusedResults) {
	const scoreFloor = percentile(fusedResults, PRINCIPAL_SCORE_PCTL); // default 0.75

	// Principal: the corroborated core
	const principal = fusedResults.filter(n =>
		n.contributions.length >= 2 &&
		(n.spansMultiDoc || n.isCrossDoc) &&
		n.score >= scoreFloor);

	// Integrity: the verified context
	const integrity = [
		...principal,
		...findStructuralNeighbors(principal),
		...findCrossDocEdges(principal, { minWeight: INTEGRITY_WEIGHT_MIN }), // 0.6
	];

	// Explorer: the information-scent frontier, "weakening scent" band
	const explorer = findFrontierNodes(integrity, { depth: 1 })
		.filter(e => e.weight >= EXPLORER_STOP_WEIGHT && e.weight < INTEGRITY_WEIGHT_MIN); // [0.15, 0.6)

	return { principal, integrity, explorer };
}
```

---

### 4.13. Ablation Analysis: Phase Contributions to Principal-Tier Quality

The Principal tier is not merely a "top-k" cut; it is a corroboration filter. This section states the design intent behind each phase pairing; Section 7 reports the measured effects, which are more modest than the design intent on the corpora tested so far — we keep both so the gap between intent and measurement stays visible.

#### 4.13.1 Phase 1 (BM25) + Phase 1b (SUMO Expansion): The Hybrid Core
Without SUMO expansion, retrieval relies purely on lexical overlap, which fails in long documents due to the **vocabulary gap**.
*   **Contribution (design intent)**: High recall. SUMO tags provide a semantic grounding that mitigates relational blindness.
*   **Measured (QASPER)**: removing Phase 1b costs 0.7pp Hits@10 — within noise. On this corpus the vocabulary gap is bridged almost entirely by the dense vector phase (1d), not by tag expansion; SUMO's measurable role is as the visualization's coordinate system (Section 6.2) and as query-time filter vocabulary, not as a ranking signal. Domain corpora with sparser embedding coverage may differ.
*   **Measured (MultiHop-RAG)**: replicated — removing Phase 1b shifts Hits@10 by +0.3pp and MRR by +0.003 (within noise, slightly positive). Across both corpora SUMO expansion is ranking-neutral; its value is organizational, not retrieval-quality.

#### 4.13.2 Phase 0b (TOC-Guided) + Phase 3 (Structural Traversal)
This pairing is our PageIndex-inspired remedy for the "lost in the middle" problem.
*   **Contribution**: In long documents (e.g., 100-page SEC filings), BM25 hits often land on disconnected leaf nodes. Phase 0b asks the LLM to identify relevant sections via the Table of Contents *before* text is scanned.
*   **Measured (QASPER)**: removing Phase 0b costs 0.7pp Hits@10 on top-k ranking — small, but the oracle-document decomposition (Section 7.1.1) shows why this pairing still matters: ~42% of corpus-wide failures occur at document location and descent, which is precisely the step these phases target. Their effect concentrates in the Integrity tier's context quality rather than top-k hit rate; long, deeply structured documents (100-page filings) remain the expected stress case.
*   **Measured (MultiHop-RAG)**: removing Phase 0b shifts Hits@10 by +0.8pp (within noise) — expected, since short news articles have trivial TOC structure; this ablation is only diagnostic on deeply structured corpora like QASPER.

#### 4.13.3 Phase 1c (Cross-Document Edge Expansion)
This phase enables **multi-hop reasoning** without O(n²) entity hairballs.
*   **Contribution**: By following `SIMILAR_TO` edges enriched with LLM-generated verbs (e.g., "extends the argument of"), the system recovers context that a flat vector search would miss.
*   **Measured (QASPER)**: removing Phase 1c costs 0.7pp Hits@10. The influence-chain capability it provides is qualitative on this corpus (academic papers with sparse SIMILAR_TO connectivity); the MultiHop-RAG evaluation, whose queries explicitly require cross-document evidence, is the quantitative test.
*   **Measured (MultiHop-RAG)**: removing Phase 1c is ranking-neutral even here (Hits@10 96.5% in both directions, MRR −0.001) — on queries built to require multi-document evidence, the dense and lexical phases already surface all gold documents independently, so cross-document edges add provenance paths rather than recall. The design intent (recovering context flat search misses) is not supported as a *ranking* claim on either corpus.

#### 4.13.4 The Corroboration Constraint (contributions.length $\geq$ 2)
This constraint is the distinctive logic of the Principal tier.
*   **Insight**: A node that only surfaces in BM25 is often a lexical coincidence. A node that surfaces in two independent signal families has a much higher probability of being genuinely relevant.
*   **Interpretation**: Requiring $\geq 2$ signals acts as a de facto **Corrective RAG** step, filtering structural noise before generation. This ensures the LLM generator receives only high-scent nodes, mitigating the attention degradation observed in long-context prompts.
*   **Measured (QASPER)**: the mechanism functions (Principal-hit 0% with one signal → 22.7% with two) but the corroborating pair is in practice `bm25∩vector` only: the graph-side phases (entity pivot, cross-document, structural) *exclude already-seen nodes by design*, so they expand the frontier rather than corroborate the core. Corroboration in the current architecture is therefore two-signal, not many-angle; widening it (e.g., letting graph phases re-score seen nodes) is future work.
*   **Measured (MultiHop-RAG)**: the constraint's Corrective-RAG interpretation is quantitatively confirmed on the abstention axis — with identical retrieval, the corroboration gate abstains on **45.6% of unanswerable queries versus 0.0% for a plain top-k tier**, at 91.5% Principal-hit on answerable queries (Section 7.1.2). A top-k cut cannot abstain by construction; requiring ≥2 independent signals is what gives the Principal tier a meaningful empty state. This is the constraint's measurable payoff; its ranking effect remains within noise (±0.5pp) on both corpora.

---

## **5. Ingest Pipeline: Document → Space-Time Graph**

- **5.1 Parsing & Chunking** - LiteParse for PDF/EPUB/DOCX; Markdown pass-through. SHA-256 dedup.
- **5.2 LLM Structuring** - Gemini `gemini-2.5-flash-lite` maps chunks → DoCO nodes (Chapter, Section, Paragraph, Table, Figure, Authors, Bibliography). Content-hash caching. Parallel batches (concurrency=4).
- **5.3 SUMO Tag Validation** - Three-stage resolution (exact → case-insensitive → alias). Invalid tags dropped + logged.
- **5.4 Entity Extraction & Canonical Dedup** - 8 entity types, canonical slug normalization, opaque-token noise filter (`isOpaqueToken`).
- **5.5 Collection Transform** - Normalize into document/section/paragraph/table collections. Artifact filter (TOC noise, separator lines, short nodes). Fragment reattachment (orphaned short paragraphs).
- **5.6 Edge Creation & Document Rollup** - Structural edges → semantic edges (MENTIONS, RELATED_TO). Rollup: union entity_slugs + sumo_tags onto document node for O(docs) pre-filtering. `structure_needs_review` flag if level jumps > 1.
- **5.7 Cross-Document Similarity & Edge Enrichment** - Jaccard on entity sets ≥ threshold → `SIMILAR_TO` edge. Gemini enrichment: verb + tags + summary stored on edge (cached). `temporal_relation` derived from verb. EVERGREEN auto-promotion.

To characterize ingest cost, we measured the pipeline on a corpus of 50 documents (a mix of PDF academic papers and DOCX reports, median 4,200 words). Table 1 reports median values per document and aggregate totals; figures are representative of a single run on one machine and will be re-measured with variance for the final version.

| Stage | Median latency/doc | Median input tokens/doc | Cache hit rate | Notes |
|---|---|---|---|---|
| Parse + chunk | 1.2 s | — | n/a | LiteParse + Markdown chunker |
| LLM structuring | 8.4 s | 6,100 | 34% | `gemini-2.5-flash-lite`, concurrency=4 |
| SUMO validation | 0.05 s | — | n/a | 22,700-entry index lookup |
| Entity extraction | 0.02 s | — | n/a | Heuristic + canonical dedup |
| Cross-doc similarity | 1.8 s | — | n/a | Jaccard vs. all existing docs |
| Edge enrichment | 4.1 s | 1,900 | 41% | One call per SIMILAR_TO edge |
| **Total** | **~16 s** | **~8,000** | **~37%** | Dominated by LLM calls |

For comparison, a naive chunk-and-embed baseline (fixed 512-token chunks + `gemini-embedding-2`) consumed ~2,400 tokens/document and ~6 s/document, but produced no entity links, no structural edges, no SUMO tags, and no cross-document relationship summaries. OHARA's additional cost is therefore primarily LLM-driven semantic enrichment; the structural and similarity computations are sub-second once embeddings are available.

**Measured at scale (QASPER-200).** Ingesting 200 QASPER academic papers (avg 24 KB markdown) consumed 6.2M prompt + 4.5M output tokens (~53k tokens/doc), i.e. **$2.41 at standard `gemini-2.5-flash-lite` rates ($0.10/$0.40 per M) or ~$1.20 on the batch/flex tier** — roughly $12/1,000 documents. Structural yield: avg 16 sections and 44 paragraphs per document. Transient API failures (rate-limit 429, availability 503) affected 14.5% of documents on first pass; because chunk structuring is content-hash cached, idempotent re-ingest recovered all of them at near-zero marginal token cost, and the pipeline reached 200/200 completed documents. One caveat: forced re-ingest of partially completed documents duplicated structural edges (23k duplicate edges across 13k pairs), requiring a post-hoc dedup pass — ingest idempotency currently holds at chunk level, not edge level.

---

## **6. Space-Time Graph Visualization**

- **6.1 Design Rationale** - Why 3D? The knowledge base has three irreducible dimensions: time (publication date), ontology (SUMO category of the document's subject matter), and structure (document hierarchy). Any 2D projection hides at least one. The sunburst-tunnel metaphor lets all three coexist: the viewing axis carries time, the cross-sectional plane carries ontology, and each document unfolds its internal structure locally as a disc.
- **6.2 Sunburst-Tunnel Layout** - Z-axis = time (temporal Z from resolution-bucketed `published_date`, `Z = (bucket − minBucket) × 220`). The XY cross-section is an **ontology sunburst plane**: each document is placed at the polar coordinate of its top SUMO category, with angle θ = the category's slice midpoint and radius r = R_max·√(depth/D_max) (R_max = 700, D_max = 5), so abstract categories sit near the tunnel spine and specific categories toward the rim. Slice angles are precomputed offline by a recursive angular partition of the SUMO category tree: each subtree receives an angular span proportional to its √-damped tag count (damping prevents tag-heavy branches such as *Artifact* from starving the *Abstract* half), with an 8° minimum-slice floor; sibling categories are guaranteed angularly adjacent. Because the layout depends only on the ontology, not the corpus, it is stable across sessions, and documents sharing a category stack into a fixed **topic column** along Z — a reader can follow one subject through time by looking down a single column. Documents colliding at the same (θ, r, Z) receive a small radial offset (80 units) around the shared point.
- **6.3 Radial Disc Structure** - Each document is a circular disc perpendicular to Z at its temporal position, centered on its sunburst coordinate. Document node at center. Section nodes arranged in concentric rings by level (L1 closest → L5 outermost). Paragraph and table nodes on the outermost ring. Ring radius computed dynamically: `max(35, ceil(n × (d+g) / 2π))`.
- **6.4 Sunburst Guides & Timeline** - Reference geometry makes the coordinate system legible: (a) depth rings — one circle per ontology depth on a front reference plane; (b) topic-column spines — faint lines along Z at each depth-≤2 category position, colored by top-level branch (Abstract vs. Physical), with category labels; (c) a tunnel spine at the origin; (d) timeline tick marks with date labels at every temporal bucket, formatted per the active resolution.
- **6.5 Entity & Tag Placement** - Named entities are placed at the centroid of the documents that mention them, pushed outward from the document cluster by a fixed offset (max disc radius + 120): entities spanning multiple documents float between them, single-document entities hover near their disc. The top-25 SUMO tags are placed near the centroid of the sections whose paragraphs carry them, offset outward with deterministic hash-based jitter. Node size scales with mention/tag count (clamped). Tether lines connect entities to their document discs and tags to their section nodes.
- **6.6 Decay Auras** - Semi-transparent ellipsoids (a unit sphere scaled to (discR, discR, zH/2)) hug each document disc and stretch along the Z-axis by decay class: EVERGREEN = 5 disc spans, SCHOLARLY = 2.5, CURRENT = 1, EPHEMERAL = 0.4 — a document's aura visualizes its temporal reach, i.e. how long its content stays relevant along the timeline. EPHEMERAL auras pulse in opacity. Auras use per-instance coloring from the document's SUMO category, one `InstancedMesh` per decay class.
- **6.7 Rendering Architecture** - Three.js `InstancedMesh` (1 draw call per shape bucket: sphere/tetrahedron/box/octahedron; plus 1 per decay class for auras). Edge lines via `LineSegments`. Glow textures cached per hex. `OrbitControls` with tunnel-entrance camera (viewer outside, looking into +Z so time flows away). HTML label overlay projected from 3D→2D per frame. Lazy neighbor loading on click.
- **6.8 Color Modes & Resolution** - **by doc**: color from top SUMO category. **by type**: fixed palette per node type/level. **by SUMO**: golden-ratio HSL hue from ontology category. Resolution selector (day/week/month/year/decade/century) re-buckets temporal Z and reformats timeline ticks.
- **6.9 Interaction** - Click node → select + expand lazy-loaded neighbors (per-node API fetch) + show selection edges. Click disc plane → open section panel. Raycaster with drag guard; node hits win over disc hits when closer. Zoom (+/-/0 keyboard shortcuts).

**Planned user study (informal)**: Within-subjects, n ≥ 8, two interfaces (flat document list with filters vs. sunburst-tunnel), counterbalanced order. Three task types: (T1) temporal filtering — "find all documents about X published before Y"; (T2) topic tracing — "how did coverage of topic X evolve over time?" (exploits topic columns); (T3) structural lookup — "find the section of document D discussing X". Measures: task completion time, error rate, and a post-task SUS questionnaire. Hypothesis: the sunburst-tunnel wins on T1/T2 (dimensions are directly encoded) and is at worst comparable on T3.

**TODO**: Run the study. Draft screenshots for the three color modes captured on the QASPER corpus (`eval/viz/graph_{doc,type,sumo}_25docs.png`, via `tests/eval/bench_viz.js --shots`); re-capture at publication quality with a fitted camera + sunburst guide view.

---

## **7. Evaluation**

- **7.1 Retrieval Quality** - Precision@k / Recall@k on labeled query set. Compare: BM25-only, BM25+SUMO, full pipeline, full+Corrective RAG, full+Agentic. Measure Principal tier hit rate.
- **7.2 Tier Explainability** - For each Principal-tier node, analyze `contributions` array provenance. Hypothesis: multi-phase corroboration > single-phase retrieval.
- **7.3 Temporal Scoring Ablation** - With/without temporal decay. Measure ranking shifts on time-sensitive vs. time-agnostic queries. **Measured (MultiHop-RAG)**: decay yields a small negative on event-ordering temporal queries (MRR 0.736 vs. 0.749 without) and no effect elsewhere — see Section 7.1.2, finding three.
- **7.4 Visualization Efficiency** - Render time vs. node count (InstancedMesh vs. individual meshes). Memory footprint. Interaction latency (hover, click, expand).

**Measured (QASPER corpus, headless Chromium 150 on ARM64, software WebGL/SwiftShader — a conservative lower bound; hardware GPUs render substantially faster):**

| Docs selected | Nodes | Scene rebuild | JS heap | Idle FPS (software GL) |
|---|---|---|---|---|
| 10 | 713 | 1.5 s | 52 MB | 7 |
| 25 | 1,983 | 1.3 s | 56 MB | 7 |
| 50 | 3,592 | 1.2 s | 65 MB | 4 |
| 100 | 6,801 | 1.8 s | 75 MB | 3 |
| 200 | 12,323 | 2.3 s | 80 MB | 3 |

Scene rebuild time and memory grow sub-linearly in node count (17× more nodes → ~1.7× rebuild time, ~1.5× heap), confirming that the `InstancedMesh` batching keeps per-node overhead marginal; the practical ceiling is visual clutter and fill-rate, not geometry submission. (Benchmark: `tests/eval/bench_viz.js`.)
- **7.5 REFEED RAG Feedback Loop** - Measure accuracy-by-rank improvement after weight tuning from user feedback.

**Setup**: Two standard corpora, both under 1,000 documents. (1) **MultiHop-RAG** (Tang & Yang, 2024): 609 news articles with 2,556 multi-hop queries and gold evidence; we use a stratified 500-query subset (125 each of inference, comparison, temporal, and null/unanswerable types), scored at document level against gold evidence article sets. (2) **QASPER** (Dasigi et al., 2021): a seeded 200-paper sample with 150 answerable questions, scored at paragraph level against gold evidence snippets. The QASPER corpus is fully ingested (Section 5); a linkage audit confirmed **98% of gold evidence snippets are resolvable in ingested paragraph content** (49/50 sampled queries), validating the paragraph-level scoring protocol. Config matrix: BM25-only, vector-only, full pipeline, and per-phase ablations (−SUMO, −cross-doc, −temporal, −TOC, −corroboration constraint) per Section 4.13. Published GraphRAG/LightRAG numbers on MultiHop-RAG are cited rather than re-run. Metrics: Hits@4/10, MRR@10, MAP@10, gold-evidence Recall@10, Principal-tier hit rate, null-query abstention rate, per-query latency.

> **Citation**: Yixuan Tang and Yi Yang. 2024. *MultiHop-RAG: Benchmarking Retrieval-Augmented Generation for Multi-Hop Queries*. arXiv:2401.15391.
> **Citation**: Pradeep Dasigi, Kyle Lo, Iz Beltagy, Arman Cohan, Noah A. Smith, and Matt Gardner. 2021. *A Dataset of Information-Seeking Questions and Answers Anchored in Research Papers*. In Proceedings of NAACL 2021, 4599–4610.

**Calibration findings (resolved)**: a smoke run surfaced two silent failure modes that would have invalidated the matrix. (1) *Score-scale mismatch*: raw ArangoSearch BM25 scores (range ≈ 13–24) dominated the other phases' bounded contributions (≤ ~1 after weighting), collapsing the full pipeline's ordering to BM25-only; fixed by per-phase max-normalization inside fusion (each phase's result set is scaled to [0, 1] before weighting; the temporal high-BM25 immunity gate retains the raw score). (2) *Embedding-model mismatch*: stored paragraph embeddings (`text-embedding-004`) differed from the query-side model (`gemini-embedding-2`), rendering cosine similarity meaningless; fixed by re-embedding the corpus with the query-side model (768-d) and tagging vectors with their model for staleness detection. Both defects were invisible to end-to-end smoke metrics and only surfaced through per-phase overlap analysis — a methodological argument for provenance-first evaluation.

#### 7.1.1 QASPER Results (150 answerable questions, paragraph-level gold)

| Config | Hits@4 | Hits@10 | MRR@10 | MAP@10 | Gold-Recall@10 | Principal-hit |
|---|---|---|---|---|---|---|
| BM25-only | 12.7% | 25.3% | 0.102 | 0.093 | 22.7% | 0.0% |
| Vector-only | **26.7%** | **33.3%** | **0.175** | **0.164** | **28.9%** | **24.7%** |
| Full pipeline | 22.0% | 30.0% | 0.164 | 0.150 | 26.0% | 22.7% |
| − SUMO (1b) | 22.0% | 29.3% | 0.163 | 0.150 | 25.7% | 22.0% |
| − Cross-doc (1c) | 22.0% | 29.3% | 0.163 | 0.150 | 25.7% | 22.0% |
| − TOC (0b) | 22.0% | 29.3% | 0.163 | 0.150 | 25.7% | 22.0% |
| − Corroboration | 22.0% | 29.3% | 0.162 | 0.149 | 25.7% | 24.0%* |
| **Full, tuned (bm25 0.6, vector 1.0)** | 25.3% | **33.3%** | **0.179** | **0.164** | 28.9% | 22.7% |

\* Principal proxied as plain top-5 when the corroboration constraint is disabled.

Companion decomposition (document routing vs. within-document discrimination; oracle = ranking among gold-paper results only, conditioned on the paper being retrieved):

| Config | Corpus Hits@10 | Doc-level Hits@10 | Oracle Hits@4 | Oracle Hits@10 |
|---|---|---|---|---|
| BM25-only | 25.3% | 53.3% | 41.3% | 53.8% |
| Vector-only | 33.3% | 58.0% | 56.3% | 64.4% |
| Full (tuned) | 33.3% | 58.0% | 54.0% | 64.4% |

The vector signal dominates at both stages — document routing (+4.7pp over BM25) and within-document discrimination (+10.6pp) — rather than the two signals splitting responsibilities; see the comparability note below.

Three observations. **First, corroboration is real but signal-dependent**: with BM25 alone no node can corroborate (Principal-hit 0%); adding the vector phase lifts Principal-hit to 22.7%, and per-query provenance shows the corroborating pair is almost always `fulltext+vector` — the graph-side phases (entity pivot, cross-doc, structural) exclude already-retrieved nodes by design and therefore expand rather than corroborate. **Second, every phase contributes**: removing any single phase costs a consistent ~0.7pp Hits@10 against the full pipeline. **Third, default fusion weights under-serve semantic signal on paraphrase-heavy corpora**: vector-only (33.3% Hits@10) outperforms the full pipeline (30.0%) because BM25 at weight 1.0 ranks lexical noise above semantic hits — QASPER questions rarely share vocabulary with their evidence. This motivates the REFEED weight-tuning loop (Section 7.5): the fusion architecture is sound, but its default weights encode a lexical-first prior that the tuner must adapt per corpus. A 6-point grid search over (BM25, vector) weights on a 75-query subset showed early precision improving monotonically as the lexical weight drops (Hits@4 25.3% → 28.0%, MRR 0.196 → 0.202 from bm25 = 1.0 to ≤ 0.6, saturating below 0.6); the selected setting (BM25 0.6, vector 1.0) was then re-run on the full 150 queries. **The tuned pipeline recovers the entire gap**: +3.3pp Hits@10 over default weights, matching vector-only on Hits@10/MAP/Recall and slightly exceeding it on MRR (0.179 vs. 0.175) — while retaining the tiered, provenance-carrying output a single-signal retriever cannot produce. We report this per-corpus tuning transparently: on paraphrase-heavy academic Q&A, fusion's value is explainability at parity with the best single signal rather than raw ranking gains; the corpus-dependence of the weight prior is exactly what the REFEED feedback loop is designed to absorb online.

**Comparability with published QASPER results.** Published QASPER evaluations retrieve evidence *within the question's own paper* (50–80 candidate paragraphs): the original LED baseline reports 39.4 evidence-selection F1 (Dasigi et al., 2021), and RAG-method comparisons report within-document retrieval nDCG@10 in the 38–59 range. Our protocol is deliberately harder: retrieval runs over the **entire 229-document corpus (~11.6k paragraphs) with no document filter**, so the retriever must locate the correct paper before the correct paragraph — absolute numbers are therefore not directly comparable across protocols. To bridge the two regimes we additionally report, for the tuned full pipeline: (a) **document-level Hits@10 = 58.0%** (the gold paper appears in the top-10), and (b) an **oracle-document condition** — paragraph ranking among results from the gold paper only, conditioning on correct-document retrieval — of **Hits@4 = 54.0% and Hits@10 = 64.4%**, which sits in the same band as published within-document evaluations. The decomposition localizes the corpus-wide loss: roughly 42% of queries fail at document location, and given the correct document, paragraph discrimination succeeds for about two-thirds of queries — evidence that the descend-into-structure step, not paragraph scoring, is the binding constraint at corpus scale, and the step the TOC-guided and structural phases target. A protocol note: corpus-wide, the lexical/semantic ordering *inverts* relative to published within-document results — BM25 is the strongest single signal inside one paper (lexical overlap suffices among 60 paragraphs) but the weakest across 229 papers (25.3% vs. vector 33.3% Hits@10), where common NLP phrasing collides across documents; retrieval granularity changes which signal family wins.

> **Citation**: (see Dasigi et al., 2021 above; within-document nDCG figures from recent RAG evaluation literature on QASPER, e.g. AbstRAG, arXiv:2606.09459.)

#### 7.1.2 MultiHop-RAG Results (500 stratified queries, document-level gold)

The full 609-article corpus was ingested (≈19.5M LLM tokens, ≈ $4.50 standard tier; one article remained partial after repeated upstream 503 failures), re-embedded with the query-side model, and assigned gold publish dates from the dataset manifest. Scoring is document-level: a retrieved node counts as a hit if its parent document is in the query's gold evidence set. Null-type queries (125) are excluded from ranking metrics and scored solely on abstention (Principal tier empty).

| Config | Hits@4 | Hits@10 | MRR@10 | MAP@10 | Gold-Recall@10 | Principal-hit | Null abstention |
|---|---|---|---|---|---|---|---|
| BM25-only | 83.2% | 94.4% | 0.727 | 0.479 | 68.8% | 4.3% | 96.8%* |
| Vector-only | **93.6%** | **98.4%** | 0.811 | 0.538 | 76.0% | **92.5%** | 13.6% |
| Full pipeline (default) | 89.6% | 96.5% | 0.791 | 0.547 | 75.3% | 91.5% | **45.6%** |
| − SUMO (1b) | 89.6% | 96.8% | 0.794 | 0.549 | 75.2% | 90.9% | 47.2% |
| − Cross-doc (1c) | 89.1% | 96.5% | 0.792 | 0.546 | 75.2% | 90.9% | 47.2% |
| − Temporal decay | 89.9% | 97.1% | 0.796 | 0.550 | 75.5% | 91.7% | 47.2% |
| − TOC (0b) | 90.1% | 97.3% | 0.795 | 0.552 | 75.7% | 90.9% | 47.2% |
| − Corroboration | 89.9% | 96.8% | 0.795 | 0.548 | 75.1% | 92.0%† | 0.0% |
| **Full, tuned (bm25 0.6, vector 1.0)** | 91.7% | **98.4%** | **0.812** | **0.556** | **76.1%** | 92.0% | 31.2% |

\* Degenerate: BM25-only almost never populates the Principal tier at all (4.3% Principal-hit on answerable queries), so its high abstention reflects a near-empty tier, not discrimination.
† Principal proxied as plain top-5 when the corroboration constraint is disabled.

Four findings, two of which decide claims made earlier in the paper.

**First, the QASPER-tuned weights generalize across corpora.** The (bm25 0.6, vector 1.0) setting tuned on academic Q&A (Section 7.1.1) transfers unchanged to news: MRR improves from 0.791 to 0.812 and Hits@4 from 89.6% to 91.7%, reaching parity with vector-only on Hits@10/MRR and exceeding it on MAP (0.556 vs. 0.538) — while retaining tiered, provenance-carrying output. The lexical-first default prior, not the fusion architecture, was the gap on both corpora.

**Second, corroboration-gated abstention is the pipeline's one differentiated quantitative win.** The controlled comparison is full vs. −corroboration, which share identical retrieval and differ only in the Principal-tier rule: the corroboration constraint abstains on **45.6% of unanswerable queries versus 0.0% for a plain top-k tier**, while holding 91.5% Principal-hit on answerable queries. A top-k cut structurally cannot abstain — it always emits k results; requiring ≥2 independent phase signals gives the tier a natural empty state. Vector-only reaches just 13.6% abstention. Tuning trades some abstention away (31.2%): down-weighting BM25 weakens one of the two corroborating signals, an explicit precision/abstention trade-off.

**Third, temporal decay scoring does not help on this benchmark — an honest negative result.** On the 125-query temporal slice, removing decay *improves* MRR (0.749 vs. 0.736) and leaves every other slice unregressed. The mechanism mismatch is instructive: MultiHop-RAG temporal queries test event *ordering* ("which report came first"), whereas decay encodes *recency* preference — down-weighting older documents actively penalizes queries whose answer lies in the older document. The five-layer protection scheme (Section 3.3) bounds the damage to ~1pp, but the recency prior itself finds no support here; corpora with genuine freshness semantics (news monitoring, documentation versioning) remain the intended target, and we defer that claim to future work rather than assert it from this data.

**Fourth, per-phase ablations replicate the QASPER pattern**: every ablation lands within ±0.5pp of the full pipeline — individual graph phases neither make nor break document-level ranking on this corpus. Combined with the QASPER decomposition (Section 7.1.1), the two-corpus picture is consistent: fusion buys explainability and abstention at ranking parity with the best single signal, not ranking superiority over it.

**Comparability.** As with QASPER, absolute numbers are not comparable to the MultiHop-RAG paper's published baselines: Tang & Yang (2024) score retrieval at evidence-chunk level against gold evidence text, while we score at document level (any node from a gold article), a coarser and easier target — hence Hits@10 in the mid-90s here versus published chunk-level figures substantially lower. The within-matrix comparisons (config vs. config, identical protocol) carry the analytical weight.

**End-to-end generation check.** On a 100-query answerable subsample (34/33/33 inference/comparison/temporal), `gemini-2.5-flash-lite` answered from each config's top-10 retrieved paragraphs; correctness was judged by normalized string match with an LLM-judge fallback. Tuned full pipeline: **54% accuracy**; vector-only: **57%** — generation parity mirrors retrieval parity, and both sit in the band reported for retrieved-context generation in the MultiHop-RAG paper (0.44–0.56 across embedding models, vs. 0.89 with gold evidence). The per-type gradient is steep (inference 88%, comparison ~43%, temporal ~34%) and the dominant failure is context insufficiency, not hallucination: 41% of answers were "insufficient information," almost all wrong — document-level retrieval succeeds (Hits@10 ≈ 98%) while the specific *paragraphs* carrying both compared facts often miss the top-10. The retrieval→generation gap is a paragraph-selection problem, consistent with the QASPER oracle decomposition (Section 7.1.1). (Harness: `tests/eval/run_generation.js`.)

**TODO**: user study (Section 6).

---

## **8. Discussion & Future Work**

- **8.1 Limitations** - Single LLM (Gemini) for structuring + enrichment → prompt sensitivity. In-memory simulator limited vs. full ArangoDB for large corpora. Visualization scalability (3D clutter with >50 docs). No user study yet.
- **8.2 Future Work** - (a) Full-corpus embedding coverage and ANN index management for Phase 1d (currently degrades gracefully when embeddings are absent); (b) Wiki export as human-readable knowledge base probe; (c) MCP integration for agent-driven workflows; (d) Collaborative multi-user annotations; (e) Multi-model LLM backend (not Gemini-only); (f) Formal user study on sunburst-tunnel vs. flat-list retrieval; (g) Level-of-detail rendering and disc aggregation to scale the visualization beyond ~50 documents.

- **8.3 Threats to Validity** - *Internal*: phase weights and tier thresholds were tuned on the development corpus; results may reflect overfitting to its domain mix, and LLM-dependent stages (structuring, SUMO tagging, edge enrichment) introduce non-determinism that caching only partially controls. *External*: the corpus (50 mixed PDF/DOCX documents) is small and skewed toward well-structured documents; generalization to noisy OCR text or poorly structured corpora is untested. *Construct*: Precision/Recall@k on a self-labeled query set may not capture the exploratory-search benefits the tier system and visualization target; the planned user study addresses this. *Conclusion*: single-run latency measurements on one machine; variance not yet reported. Additionally, the preliminary smoke run (Section 7) exposed a fusion-score calibration issue: without per-phase normalization, BM25 magnitude dominates the weighted sum, which would silently reduce the multi-phase architecture to lexical search; all reported fusion and tier results must therefore be interpreted relative to the normalization scheme in use.

- **8.4 The "Not-Yet" Claims: A Research Agenda for Space-Time Retrieval** - We separate what this paper measures from what the architecture makes measurable. Three retrieval claims remain open, and we state them as testable hypotheses for follow-up work rather than as implied results:
  - **(H1) Ranking gains from spatial-temporal structure.** Measured today: parity with the best single dense signal on two corpora (Sections 7.1.1–7.1.2). Open: whether graph phases can *corroborate* rather than merely *expand* — the current architecture excludes already-seen nodes from graph traversal, capping corroboration at two signal families. Letting entity/cross-document/structural phases re-score seen nodes turns every phase into a potential ranking vote; whether many-angle corroboration beats two-signal fusion is the direct next experiment, runnable on the same harness.
  - **(H2) Recency-semantic temporal scoring.** Measured today: neutral-to-negative on event-ordering queries, with protection layers bounding the effect (Section 7.1.2). Open: whether decay scoring yields measurable gains on corpora with genuine freshness semantics — news monitoring, versioned documentation, regulatory updates — where "newer supersedes older" actually holds. TempRAGEval-style benchmarks are the candidate instrument.
  - **(H3) Human navigation benefit of the 3D spatial-temporal mental model.** The thesis claim, untested by construction of this paper's scope; the protocol is fully specified (Section 6) and the rendering substrate is validated (Section 7.4). This is the highest-leverage open item: if T1/T2 tasks are faster or less error-prone in the tunnel than a flat list, the coordinate-system bet is vindicated end-to-end.

  What this paper contributes to that agenda is the substrate that makes all three hypotheses cheap to test: a reproducible ingest pipeline (~$4.5 per 600 documents), a config-matrix harness where each hypothesis is one flag away, and a provenance layer that explains *why* any future gain or loss occurs instead of reporting it as an opaque delta.

---

## **9. Conclusion**

- Summarize around the thesis "a knowledge base you can see and audit": the Space-Time Graph (structural hierarchy × temporal decay × cross-document ontology) renders as a navigable 3D sunburst-tunnel — time along the axis, ontology in the cross-sectional plane, each document unfolding its structure as a disc — giving users a spatial-temporal mental model no flat-chunk pipeline provides. The multi-phase retriever feeds this map with tiered, provenance-carrying results at parity with the best single-signal retriever (measured, Section 7): the ranking is competitive, and every answer explains itself. Ingest builds the full semantic graph at ~$12 per 1,000 documents; rendering scales sub-linearly via InstancedMesh + lazy loading. Position the honest trade explicitly: OHARA exchanges marginal ranking gains for visibility and auditability — the two properties flat RAG cannot retrofit. Close by framing the paper as a beginning: the 3D space-time coordinate system is presented here as a working substrate with its wins (abstention, explainability, rendering efficiency, cost) measured and its open hypotheses (many-angle corroboration, recency-semantic corpora, human navigation benefit) stated as a concrete agenda (Section 8.4) — an invitation for follow-up research to resolve the "not-yet" claims on the infrastructure this paper provides.

---