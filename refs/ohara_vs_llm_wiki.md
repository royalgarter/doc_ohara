# OHARA vs LLM Wiki

## LLM Wiki Core Approach

**Repo**: https://github.com/nashsu/llm_wiki
**Philosophy**: A personal knowledge base that "builds itself." It incrementally builds and maintains a persistent wiki from sources, rather than doing traditional RAG (retrieve-and-answer from scratch).

### Key mechanics:
- **Two-Step Chain-of-Thought Ingest**: Analyzes first (identifies entities, concepts, connections, contradictions), then generates wiki pages with source traceability.
- **4-Signal Knowledge Graph**: Ranks relevance using Direct link, Source overlap, Adamic-Adar (common neighbors), and Type affinity.
- **Louvain Community Detection**: Automatically groups nodes into knowledge clusters based on link topology.
- **Graph Insights**: Proactively finds "Surprising Connections" (e.g., cross-community edges) and "Knowledge Gaps" (isolated pages, sparse communities).
- **Deep Research**: Automatically runs multi-query web searches and ingests the results directly into the wiki.

---

## What LLM Wiki Does NOT Have (OHARA's Edges)

| OHARA capability | LLM Wiki equivalent |
|---|---|
| SUMO ontology tagging | None - relies on emergent clusters |
| Temporal scoring / decay classes | None |
| Structural Document Graph (DoCO) | Markdown files with wiki links |
| Tier system (Principal / Integrity / Explorer) | None |
| Chain-of-Retrieval (CoR) / Speculative RAG | Single-pass or standard agentic retrieval |

LLM Wiki excels as a **persistent, evolving semantic network** that explicitly surfaces gaps and new connections. OHARA excels at **structured, rigorous document navigation** (TOCs, paragraphs, ontologies) and **multi-phase ranking**.

---

## What OHARA Can Learn

### 1. Louvain Community Detection (Emergent Clusters)
OHARA currently relies on top-down SUMO ontology tags and direct Entity links for broad categorization.
**Potential feature**: Run Louvain or similar community detection algorithms over the `SIMILAR_TO` and `entity_pivot` graph to discover emergent knowledge clusters automatically.

### 2. Graph Insights (Surprising Connections & Knowledge Gaps)
LLM Wiki automatically flags isolated pages or unexpected cross-topic links.
**Potential feature**: OHARA could introduce a background analysis job that highlights disconnected documents (requiring more context) or "surprising" cross-document hops, prompting the user or the Speculative RAG agent to explore them.

### 3. 4-Signal Edge Weighting
LLM Wiki weights graph edges using advanced heuristics like Adamic-Adar (pages sharing many common neighbors).
**Potential feature**: OHARA's `SIMILAR_TO` graph traversal could incorporate Adamic-Adar or structural proximity (Type affinity) to refine the scoring in Phase 3/4.

### 4. Two-Step Ingest (Analyze, then Generate)
LLM Wiki forces the LLM to explicitly reason about *contradictions* and *tensions* with existing knowledge before writing pages.
**Potential feature**: OHARA's ingest pipeline could add a pre-ingest analysis step that compares the new document against a summary of the existing graph, explicitly noting contradictions as new nodes.

### 5. Web-Augmented "Deep Research"
LLM Wiki can reach out to the web (via Tavily/SerpApi) to fill knowledge gaps.
**Potential feature**: OHARA's Agentic RAG could gain a "Web Search" tool to pull external context when local documents are insufficient, feeding the results into a temporary or persistent graph space.

---

## Priority Order

| # | Feature | Effort | Payoff |
|---|---|---|---|
| 1 | Graph Insights (Gaps & Surprises) | Medium | High - Drives proactive system behavior and user exploration |
| 2 | Louvain Community Detection | Medium | High - Enhances visualization and broad semantic navigation |
| 3 | Advanced Edge Weighting (Adamic-Adar) | Low | Medium - Better ranking accuracy for Phase 1c (Cross-doc) |
| 4 | Two-Step Ingest | High | Medium - Improves data quality, but increases ingest latency and cost |
| 5 | Web-Augmented Deep Research | Medium | Medium - Broadens scope, but deviates from "local ground truth" philosophy |
