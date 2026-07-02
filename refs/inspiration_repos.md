# RAG Inspiration Repos for OHARA

## Priority Matrix

| # | Repo / Technique | Effort | ROI | Key Steal |
|---|---|---|---|---|
| 1 | Anthropic Contextual Retrieval | Low | High | Context-prepend at ingest → better BM25 + embeddings |
| 2 | HippoRAG - PPR | Medium | High | Personalized PageRank over entity graph as new retrieval phase |
| 3 | PathRAG | Low | Medium | Path serialization: entity chain → natural language before LLM |
| 4 | StructRAG router | Medium | Medium | Query-type router skips irrelevant retrieval phases |
| 5 | TagRAG | Medium | Medium | Pre-summarize per SUMO concept node for global queries |
| 6 | HopRAG | High | Medium | Pseudo-query edges between passages at ingest time |
| 7 | RAPTOR | High | Medium | Bottom-up cluster summaries above DoCO section hierarchy |
| 8 | GraphRAG | High | Low–Med | Leiden community detection over SIMILAR_TO edges |

---

## 1. Anthropic Contextual Retrieval

**URL**: https://www.anthropic.com/news/contextual-retrieval  
**Core idea**: Before embedding each chunk, prepend a 50–100 token LLM-generated context sentence: "This paragraph discusses X in the context of section Y of document Z." Apply same context to BM25 tokens. Reduces retrieval failures 49%, 67% with reranking.

**What OHARA steals**:
- At ingest step ④ (LLM structuring), add `contextual_prefix` per paragraph: document title + section title + 1-sentence role descriptor. Store on `paragraphs.contextual_prefix`. Concatenate with content for BM25 indexing and embedding generation.
- Contextual BM25: ArangoSearch view indexes `contextual_prefix + content` instead of raw `content` alone - disambiguates same-vocabulary paragraphs across documents.
- Feed `contextual_prefix` into temporal decay scoring as an extra signal (e.g., "as of 2019" in prefix → explicit date for decay calc).

---

## 2. HippoRAG - Personalized PageRank

**URL**: https://github.com/OSU-NLP-Group/HippoRAG  
**Paper**: neurobiologically-inspired KG + PPR  
**Core idea**: OpenIE extracts (S, P, O) triples → KG of entity + passage nodes → Personalized PageRank seeded from query entities → activation spreads through graph to surface multi-hop neighbors.

**What OHARA steals**:
- PPR as a new retrieval phase (Phase 3b) over ArangoDB entity graph. Seed PPR from `processedQuery.entityHints` → walk MENTIONS + RELATED_TO + SIMILAR_TO edges → surface high-activation paragraph nodes. ArangoDB's Pregel supports PPR natively.
- Passage nodes as first-class PPR graph citizens. OHARA paragraphs already in graph - wire them into PPR adjacency alongside entity nodes.
- Schema-free OpenIE triples as supplementary edges alongside typed SUMO/DoCO edges. Higher coverage of loose relationships.

---

## 3. PathRAG

**URL**: https://github.com/BUPT-GAMMA/PathRAG  
**Paper**: arXiv:2502.14902  
**Core idea**: Retrieve *relational paths* (chains of entity→relation→entity) not individual nodes. Flow-based pruning keeps high-information paths. Serialize paths into readable text for LLM reasoning.

**What OHARA steals**:
- After cross-doc edge traversal, serialize retrieved entity chains as: `"Bitcoin [RELATED_TO] Satoshi Nakamoto [MENTIONS in] paragraph X [SIMILAR_TO via 'extends argument of'] paragraph Y"`. Feed this chain string to LLM instead of raw node dump.
- Flow-based pruning of OHARA's subgraph before LLM synthesis - keep paths with highest aggregate edge weights, discard weak chains.
- Return `path_chain` string as a new field on cross-doc results, visible in UI and API response.

---

## 4. StructRAG - Query-Type Router

**URL**: https://github.com/icip-cas/StructRAG  
**Paper**: arXiv:2410.08815 (ICLR 2025)  
**Core idea**: DPO-trained router selects one of 5 structure types (Table/Graph/Algorithm/Catalogue/Chunk) per query. Restructures retrieved text into that format before LLM reasoning.

**What OHARA steals**:
- Lightweight Gemini classifier in Phase 0 that labels the query as one of: `factual | comparative | exploratory | temporal | synthesis`. Route:
  - `factual` → BM25 only + entity pivot, skip cross-doc expansion
  - `comparative` → prioritize cross-doc edges, entity pivot
  - `exploratory` → full pipeline + Explorer tier
  - `temporal` → boost temporal scoring, force date filter
  - `synthesis` → CoR mode, community summaries
- Skip irrelevant phases to reduce latency for simple queries.

---

## 5. TagRAG - SUMO Tag Summaries

**URL**: arXiv:2601.05254  
**Core idea**: Build a DAG of hierarchical domain tags from documents. Pre-compute a summary per tag node aggregating all passages under it. Retrieval: query → top-k tag nodes → return their summaries + linked passages. 14.6x faster than GraphRAG.

**What OHARA steals**:
- OHARA already has SUMO ontology as a hierarchy. Add a `sumo_summaries` collection: one document per SUMO concept key, body = LLM-aggregated summary of all paragraphs tagged with that concept. Built once post-ingest, updated incrementally.
- New retrieval Phase 1e: for phrase/paragraph queries, match `sumoHints` against `sumo_summaries` → return the summary doc as a high-weight result. Especially effective for "global" queries about broad topics.
- Incremental update: when a new document is ingested, only re-summarize SUMO nodes whose tag sets changed.

---

## 6. HopRAG - Pseudo-Query Edges

**URL**: arXiv:2502.12442 (ACL Findings 2025)  
**Core idea**: At index time, LLM generates pseudo-questions for each passage. Passages sharing pseudo-questions get logical edges between them (not just embedding-similarity edges). Retrieval: find lexically similar passage → hop logical neighbors → prune with LLM reasoning.

**What OHARA steals**:
- Offline enrichment pass (new script `scripts/build_pseudo_query_edges.js`): for each paragraph, generate 1–2 pseudo-questions via Gemini (cached). Store on `paragraphs.pseudo_questions[]`. Build edges between paragraphs sharing pseudo-questions (new relation `ANSWERS_SAME` on the edges collection).
- `ANSWERS_SAME` edges become a new traversal path in Phase 4 structural traversal.
- Post-traversal LLM prune step (extend Corrective RAG): after collecting ANSWERS_SAME neighbors, ask Gemini whether each is logically relevant to the original query.

---

## 7. RAPTOR - Bottom-Up Cluster Summaries

**URL**: https://github.com/parthsarthi03/raptor  
**Paper**: arXiv:2401.18059 (ICLR 2024)  
**Core idea**: Cluster leaf chunks → summarize each cluster → cluster summaries → summarize again. Builds a summary tree above the existing document hierarchy. Retrieval at any level.

**What OHARA steals**:
- New `clusters` collection above `sections`: after ingest, GMM-cluster paragraph embeddings cross-section → generate cluster summary via Gemini → store in `clusters` with `HAS_MEMBER` edges to constituent paragraphs.
- Multi-granularity retrieval: return both matched paragraph and its parent cluster summary in results. Cluster summaries catch questions that span multiple DoCO sections.
- Run `scripts/build_raptor_clusters.js` after batch ingest (not per-document - requires cross-doc clustering). Controlled by `OHARA_RAPTOR_CLUSTERS=true`.

---

## 8. Microsoft GraphRAG - Community Detection

**URL**: https://github.com/microsoft/graphrag  
**Paper**: arXiv:2404.16130  
**Core idea**: Leiden algorithm over entity graph → hierarchical community clusters → pre-generate community summaries. Global queries fan out to community summaries for sensemaking questions.

**What OHARA steals**:
- Run Leiden over SIMILAR_TO + RELATED_TO edge graph after batch ingest → store community IDs on entity nodes. New `communities` collection with pre-generated LLM summaries.
- New retrieval mode for "sensemaking" queries (detected via query fingerprint `synthesis` type): return top-K community summaries as results instead of individual paragraphs.
- Map-Reduce answer synthesis: each relevant community summary generates a partial answer → LLM fuses partials. Complements existing Reasoning RAG.
- Script: `scripts/build_graph_communities.js`. Heavy - run once per corpus snapshot.

---

## 9. LightRAG - Retrieval Mode Dispatch + Incremental Deletion

**URL**: https://github.com/HKUDS/LightRAG  
**Core idea**: Five retrieval modes (local/global/hybrid/naive/mix), incremental updates via set operations, role-specific LLM dispatch.

**What OHARA steals**:
- Explicit query-time scope selector: `?mode=local|global|hybrid` on `/api/retrieval/query`. `local` = BM25+entity, `global` = community+cross-doc, `hybrid` = full pipeline.
- Role-specific model slots in env: `OHARA_EXTRACT_MODEL` (cheap, for structuring), `OHARA_QUERY_MODEL` (capable, for fingerprinting + synthesis). Currently single `GEMINI_MODEL` for all roles.
- Incremental document deletion: when deleting a doc, use cached LLM outputs to reconstruct only affected entity/edge sets for removal - avoid full re-index of remaining docs.

---

## 10. SuperRAG - Spatial Adjacency Edges

**URL**: arXiv:2503.04790 (NAACL 2025)  
**Core idea**: Property graph with spatial adjacency edges (table ↔ caption, figure ↔ referencing paragraph), sequential-order edges between siblings.

**What OHARA steals**:
- `ADJACENT_TO` edge relation between table/figure nodes and the paragraph referencing or immediately preceding them. At ingest: if a Figure or Table node appears sequentially after a Paragraph in the same section, add `ADJACENT_TO` edge.
- Sequential sibling edges already exist (`NEXT_SIBLING` between sections). Extend to paragraphs within a section.
- Cross-modal retrieval: when a query hits a figure caption, return the adjacent paragraph as context automatically.

---

## Sources

- https://github.com/HKUDS/LightRAG
- https://github.com/OSU-NLP-Group/HippoRAG
- https://github.com/microsoft/graphrag - arXiv:2404.16130
- https://github.com/BUPT-GAMMA/PathRAG - arXiv:2502.14902
- https://github.com/parthsarthi03/raptor - arXiv:2401.18059
- https://github.com/icip-cas/StructRAG - arXiv:2410.08815
- https://arxiv.org/abs/2601.05254 (TagRAG)
- https://arxiv.org/abs/2502.12442 (HopRAG)
- https://arxiv.org/abs/2503.04790 (SuperRAG)
- https://www.anthropic.com/news/contextual-retrieval
