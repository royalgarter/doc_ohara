# OHARA Edge Expansion Plan

## Core Strategy

**Edges = relevance pathways.** Every edge type is a question the retrieval engine can answer:
- `MENTIONS` → "which paragraphs talk about this entity?"
- `SIMILAR_TO` → "which documents discuss overlapping topics?"
- `HAS_CHILD` → "what is structurally beneath this node?"

More edge types = more questions the graph can answer = more routes to relevant content.

The plan is to expand from **7 edge types → 14 edge types**, each encoding a distinct semantic relationship currently invisible to the retrieval engine. All edges land in the existing `edges` collection (single `relation` field). No schema migration.

---

## Current Edge Inventory

| Relation | Direction | Phase using it | Encodes |
|---|---|---|---|
| `HAS_CHILD` | section → section/para/table | Phase 4 structural | Structural containment |
| `NEXT_SIBLING` | section → section | Phase 4 structural | Sequential order |
| `BELONGS_TO` | para/table → document | Phase 4 structural | Ownership |
| `MENTIONS` | paragraph → entity | Phase 3 entity pivot | Named entity occurrence |
| `RELATED_TO` | entity ↔ entity | Phase 3 entity pivot | Entity co-occurrence |
| `SIMILAR_TO` | document → document | Phase 1c cross-doc | Jaccard entity overlap |
| `TOC_REF` | document → section | Phase 0b TOC guidance | TOC-resolved section pointer |

---

## New Edge Types (7 additions)

### Tier 1 — Ingest-time, Low Cost

#### E1. `ADJACENT_TO` — Spatial Adjacency
**Direction**: figure/table → paragraph (and reverse)  
**Source**: SuperRAG  
**Encodes**: "This figure/table appears next to this paragraph in the original layout."  
**When created**: At ingest step ⑦ (collection transform). If a Figure or Table node appears sequentially after/before a Paragraph in the same section, insert `ADJACENT_TO` in both directions.  
**Retrieval benefit**: When a query hits a figure caption, the adjacent paragraph is automatically surfaced as context. Fixes the "orphaned table" problem where tables score low on BM25 but are highly relevant.  
**New retrieval phase**: Extend Phase 4 structural traversal to include `ADJACENT_TO` edges.  
**Effort**: Low. 10–20 lines in `transformRawToCollections`.

#### E2. `CONTRADICTS` — Contradiction Signal
**Direction**: document/paragraph → document/paragraph  
**Source**: LLM Wiki two-step ingest  
**Encodes**: "This source explicitly contradicts or refutes the claim in the target."  
**When created**: At ingest step ⑪ (edge enrichment). For each new `SIMILAR_TO` edge, check if the existing `temporal_relation` is `supersedes`. If so, also insert `CONTRADICTS` edge from newer doc → older doc.  
**Retrieval benefit**: Integrity tier can flag contradicted nodes. When a Principal node has an incoming `CONTRADICTS` edge, mark it `integrity_flags: ['contradicted']` — user sees the conflict.  
**Effort**: Low. Derived from existing `temporal_relation` logic; no extra LLM call.

#### E3. `NEXT_PARA` — Sequential Paragraph Order
**Direction**: paragraph → paragraph (within same section)  
**Source**: SuperRAG sequential edges  
**Encodes**: "This paragraph immediately follows the target in the source document."  
**When created**: At ingest step ⑧ (persistence), after all paragraphs are inserted, create `NEXT_PARA` edges between consecutive paragraphs within each section.  
**Retrieval benefit**: Enables "sliding window" context retrieval — when Phase 1 BM25 hits paragraph N, Phase 4 traversal can follow `NEXT_PARA` to fetch N-1 and N+1 without changing chunk size. Replaces naive fixed-window chunking.  
**Effort**: Low. Same pattern as `NEXT_SIBLING` between sections.

---

### Tier 2 — Offline Enrichment Scripts

#### E4. `ANSWERS_SAME` — Logical Co-Relevance
**Direction**: paragraph ↔ paragraph (cross-section, cross-document)  
**Source**: HopRAG  
**Encodes**: "Both paragraphs answer the same pseudo-question generated at index time."  
**When created**: Offline script `scripts/build_pseudo_query_edges.js`. For each paragraph (≥100 tokens), Gemini generates 1–2 pseudo-questions (cached by content hash). Paragraphs sharing a pseudo-question get `ANSWERS_SAME` edges with the shared pseudo-question stored on the edge as `shared_query`.  
**Retrieval benefit**: New Phase 1e — when BM25 seeds a paragraph, follow `ANSWERS_SAME` to find logically related paragraphs that share NO entity overlap and NO SUMO overlap, but answer the same underlying question. Catches the "vocabulary gap" failure mode of BM25 + SUMO.  
**Edge data**: `{ relation: "ANSWERS_SAME", shared_query: "...", confidence: 0.0–1.0 }`  
**Effort**: Medium. New script + new retrieval sub-phase. Expensive per-paragraph LLM call, but fully cached.

#### E5. `ADAMIC_ADAR` — Structural Co-Citation
**Direction**: entity ↔ entity  
**Source**: LLM Wiki 4-signal graph  
**Encodes**: "These two entities frequently co-occur with the same third entities (high common-neighbor weight)."  
**When created**: Offline script `scripts/build_adamic_adar_edges.js`. For all entity pairs with ≥2 common `RELATED_TO` neighbors: `AA(u,v) = Σ 1/log(|N(w)|)` for each shared neighbor w. Insert `ADAMIC_ADAR` edge if score > threshold.  
**Retrieval benefit**: Refines Phase 3 entity pivot scoring. When pivoting on entities, rank candidates by their Adamic-Adar weight to the query entities — surfaces structurally central entities over peripheral ones.  
**Edge data**: `{ relation: "ADAMIC_ADAR", weight: float }`  
**Effort**: Medium. Pure AQL + math, no LLM calls.

#### E6. `KNOWLEDGE_GAP` — Isolation Signal
**Direction**: entity/document → (virtual gap node or self-loop flag)  
**Source**: LLM Wiki graph insights  
**Encodes**: "This entity or document has no outgoing edges to the rest of the corpus — it is isolated."  
**When created**: Offline script `scripts/find_knowledge_gaps.js`. Flag entities with degree < 2 and documents with `similar_to_indegree == 0` as isolated. Store as `{ isolated: true, reason: "..." }` on the node (not an edge — the absence of edges IS the signal).  
**Retrieval benefit**: Two uses: (1) Explorer tier surfaces isolated entities as "Knowledge Gap" cards — prompting user to find/ingest connecting documents. (2) Speculative RAG uses isolated entities as seed queries for background pre-warming. Drives proactive system behavior.  
**Effort**: Low script. UI change to show gap cards.

---

### Tier 3 — Cluster-Level Edges (Post-Batch)

#### E7. `CLUSTER_MEMBER` — Semantic Cluster Membership (embedding-based)
**Direction**: paragraph → cluster node (new `clusters` collection)  
**Source**: RAPTOR  
**Encodes**: "This paragraph belongs to semantic cluster X (by embedding similarity)."  
**When created**: Batch script `scripts/build_clusters.js`. GMM soft-cluster paragraph embeddings → Gemini summary per cluster → `CLUSTER_MEMBER` edges.  
**Retrieval benefit**: Phase 1f for `synthesis`/`exploratory` queries — return cluster summaries instead of individual paragraphs.  
**Edge data**: `{ relation: "CLUSTER_MEMBER", weight: float }`  
**New collection**: `clusters` — `{ _key, summary, member_count, sumo_tags[], centroid_entity_slugs[] }`  
**Effort**: High. Requires `OHARA_EMBED_PARAGRAPHS=true`.

#### E8. `COMMUNITY_MEMBER` — Topological Community (Louvain on entity graph)
**Direction**: entity → community node (new `communities` collection)  
**Source**: LLM Wiki (Louvain), GraphRAG (community summaries)  
**Encodes**: "This entity belongs to topic community X, discovered by graph topology — not embedding similarity."  
**Input graph**: `entities` collection + `RELATED_TO` edges (weighted by co-occurrence frequency). Louvain finds communities by maximising modularity of this adjacency structure.  
**Why entities not SUMO tags**: SUMO is a pre-defined taxonomy; Louvain on RELATED_TO discovers emergent topic clusters from what is actually in your corpus (e.g. "Bitcoin ecosystem", "monetary policy actors", "cryptographic protocols").  
**When created**: Batch script `scripts/build_communities.js`. Pure AQL + Pregel (ArangoDB native) — no LLM. Then Gemini generates a 2-sentence summary per community from member entity names + their most-mentioned paragraph snippets.  
**Retrieval benefit**:
  1. Phase 3 entity pivot: when pivoting on entity E, also return E's community summary as context.
  2. Surprising connections: `RELATED_TO` edges that cross community boundaries are flagged `is_surprising: true` — Explorer tier surfaces these as "unexpected link" cards.  
**Edge data**: `{ relation: "COMMUNITY_MEMBER", community_id: string }`  
**New collection**: `communities` — `{ _key, summary, member_entity_slugs[], label }`  
**Effort**: Medium. Pregel PPR already available in ArangoDB; community detection is similar API.

---

## Edge Map: Before & After

```
BEFORE (7 edges):
  document ──[SIMILAR_TO]──▶ document
  document ──[TOC_REF]────▶ section
  section  ──[HAS_CHILD]──▶ section/para/table
  section  ──[NEXT_SIBLING]▶ section
  para     ──[BELONGS_TO]──▶ document
  para     ──[MENTIONS]───▶ entity
  entity   ──[RELATED_TO]──▶ entity

AFTER (15 edges + 2 node flags):
  document ──[SIMILAR_TO]──────▶ document         (existing; gets is_surprising flag when crosses entity communities)
  document ──[CONTRADICTS]─────▶ document          ← NEW (E2) — derived from supersedes temporal_relation
  document ──[TOC_REF]─────────▶ section
  section  ──[HAS_CHILD]───────▶ section/para/table
  section  ──[NEXT_SIBLING]────▶ section
  para     ──[BELONGS_TO]──────▶ document
  para     ──[NEXT_PARA]───────▶ paragraph         ← NEW (E3) — consecutive in same section
  para     ──[ADJACENT_TO]─────▶ figure/table      ← NEW (E1) — spatial adjacency (bidirectional)
  para     ──[ANSWERS_SAME]────▶ paragraph         ← NEW (E4) — shared pseudo-question (HopRAG)
  para     ──[CLUSTER_MEMBER]──▶ cluster           ← NEW (E7) — embedding-based (RAPTOR)
  para     ──[MENTIONS]────────▶ entity
  entity   ──[RELATED_TO]──────▶ entity            (existing; gets is_surprising flag when crosses communities)
  entity   ──[ADAMIC_ADAR]─────▶ entity            ← NEW (E5) — structural co-citation weight
  entity   ──[COMMUNITY_MEMBER]▶ community         ← NEW (E8) — Louvain on entity+RELATED_TO graph
  (node flag) isolated=true     ← NEW (E6) — on entity/document nodes with no outgoing edges
  (node flag) is_surprising=true← NEW — on RELATED_TO/SIMILAR_TO edges crossing community boundaries
```

---

## How Each Edge Activates in Retrieval

| Edge / Flag | Phase activated | How |
|---|---|---|
| `ADJACENT_TO` | Phase 4 structural | Add to traversal filter: `["HAS_CHILD", "NEXT_SIBLING", "BELONGS_TO", "ADJACENT_TO", "NEXT_PARA"]` |
| `NEXT_PARA` | Phase 4 structural | Same traversal filter as above |
| `CONTRADICTS` | Integrity tier | Flag Principal nodes with incoming `CONTRADICTS` edge as `integrity_flags: ['contradicted']` |
| `ANSWERS_SAME` | New Phase 1e | After BM25: follow `ANSWERS_SAME` from top-5 seed paragraphs (opt-in) |
| `ADAMIC_ADAR` | Phase 3 entity pivot | Re-weight pivot results by AA score to query entities |
| `isolated=true` (E6) | Explorer tier + Speculative RAG | Surface as "Knowledge Gap" cards; seed speculative pre-warm |
| `CLUSTER_MEMBER` | New Phase 1f | Return cluster summaries for `synthesis`/`exploratory` queries |
| `COMMUNITY_MEMBER` (E8) | Phase 3 entity pivot | Return community summary alongside entity pivot results |
| `is_surprising=true` | Explorer tier | Surface cross-community edges as "Unexpected Connection" cards |

---

## Implementation Sequence

### Sprint 1 — Ingest-time edges (no new scripts, no extra LLM calls) ✅ IMPLEMENTED

**E1 `ADJACENT_TO`** — `transformRawToCollections`: track consecutive para↔figure and para↔table nodes per section in `dbCollections.adjacency`. In `ingestSingleFile`: after paragraph+table insertion, create bidirectional `ADJACENT_TO` edges using handle maps. Controlled by `OHARA_ADJACENT_TO=true`.  
**E2 `CONTRADICTS`** — `ingestSingleFile` SIMILAR_TO enrichment block: if `temporalRelation === 'supersedes'`, insert `CONTRADICTS` edge (newer→older) with `contradiction_note` from edge summary. Activate in `_classifyTiers` Integrity check: flag `integrity_flags: ['contradicted']` on nodes with incoming `CONTRADICTS` edge.  
**E3 `NEXT_PARA`** — `ingestSingleFile`: collect paragraph handles during insertion into `paraHandleMap`. After all paragraphs inserted, iterate `docsParagraphs` in order grouped by section to insert `NEXT_PARA` edges. Controlled by `OHARA_NEXT_PARA=true`.  
Phase 4 structural traversal filter extended to `["HAS_CHILD", "NEXT_SIBLING", "BELONGS_TO", "ADJACENT_TO", "NEXT_PARA"]`.

### Sprint 1b — LLM Wiki gaps (missing from original plan)

**Two-Step Contradiction enrichment** — extend E2: in cross-doc edge enrichment prompt (`prompts/enrich_cross_doc_edge.md`), add explicit contradiction detection field `contradiction_note` (a 1-sentence description of the conceptual tension, if any, not just temporal). Store on SIMILAR_TO edge AND use when creating CONTRADICTS edge.  
**Web Search tool for Agentic RAG** — add `web_search` as 5th tool in `prompts/agent_strategy.md`. When Gemini picks `web_search`, call Tavily/SerpApi (env: `OHARA_WEB_SEARCH_KEY`), results stored as ephemeral paragraphs merged into agent accumulator. Controlled by `OHARA_WEB_SEARCH=false`.

### Sprint 2 — Offline enrichment scripts ✅ IMPLEMENTED

**E4 `ANSWERS_SAME`** — `scripts/build_pseudo_query_edges.js`: Gemini generates 1-2 pseudo-questions per paragraph (≥100 chars, cached), shared-question pairs get bidirectional ANSWERS_SAME edges.  
**E5 `ADAMIC_ADAR`** — `scripts/build_adamic_adar_edges.js`: Pure JS/graph: entity pairs sharing ≥2 RELATED_TO neighbors get AA-weighted edges (threshold=0.3 default).  
**E6 `KNOWLEDGE_GAP`** — `scripts/find_knowledge_gaps.js`: Flags entities (RELATED_TO degree < 2) and documents (similar_to_indegree=0) with `isolated=true`.  
Phase 1e `_phase1eAnswersSame` added to retrieval (controlled by `OHARA_ANSWERS_SAME=true`, opt-in).  
Phase 3 Adamic-Adar boost activated in `_phase3EntityPivot` (controlled by `OHARA_ADAMIC_ADAR=true`, opt-in).  
Explorer tier `knowledge_gaps` array added: surfaces isolated entities as Knowledge Gap cards with ingest hints.

### Sprint 3 — Cluster layer

**E7 `CLUSTER_MEMBER`** — `scripts/build_clusters.js` + new `clusters` ArangoDB collection  
New Phase 1f in retrieval (controlled by `OHARA_CLUSTER_RETRIEVAL=false`, opt-in).  
StructRAG query router in Phase 0 to gate Phase 1f on `synthesis`/`exploratory` queries.

---

## Contextual Retrieval (Anthropic) — Parallel Track

Not a new edge type, but enriches existing edges indirectly. At ingest step ④, generate `contextual_prefix` per paragraph:

```
"[Document: {title}] [Section: {section_title}] This paragraph discusses {1-sentence role}."
```

Store as `paragraphs.contextual_prefix`. Concat with `content` for:
- ArangoSearch BM25 index (improves Phase 1 vocabulary coverage)
- Embedding generation (improves Phase 1d vector ANN)
- `ANSWERS_SAME` pseudo-question generation input (improves E4 quality)

Controlled by `OHARA_CONTEXTUAL_PREFIX=false` (opt-in, adds LLM call per paragraph).

---

## New Env Vars

| Variable | Default | Purpose |
|---|---|---|
| `OHARA_ADJACENT_TO` | `true` | Create `ADJACENT_TO` edges between figure/table and adjacent paragraphs at ingest |
| `OHARA_NEXT_PARA` | `true` | Create `NEXT_PARA` edges between consecutive paragraphs within a section |
| `OHARA_CONTEXTUAL_PREFIX` | `false` | Generate contextual prefix per paragraph at ingest (adds LLM call) |
| `OHARA_ANSWERS_SAME` | `false` | Use `ANSWERS_SAME` edges in Phase 1e (requires offline script first) |
| `OHARA_ADAMIC_ADAR` | `false` | Use Adamic-Adar weights in Phase 3 entity pivot scoring |
| `OHARA_CLUSTER_RETRIEVAL` | `false` | Use `CLUSTER_MEMBER` edges in Phase 1f for synthesis queries |

---

## Sources

- SuperRAG (E1, E3): arXiv:2503.04790
- LLM Wiki (E2, E5, E6): https://github.com/nashsu/llm_wiki
- HopRAG (E4): arXiv:2502.12442
- RAPTOR + GraphRAG (E7): arXiv:2401.18059, arXiv:2404.16130
- Anthropic Contextual Retrieval: https://www.anthropic.com/news/contextual-retrieval
