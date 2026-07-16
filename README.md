# OHARA: [O]ntology [H]istorical [A]tlas [R]etrieval [A]rchitecture

OHARA (Ontology Historical Atlas Retrieval Architecture) is a document transformation and retrieval engine that converts unstructured documents into a multi-dimensional **Space-Time Graph** stored in ArangoDB. It solves the "lost in the middle" problem of traditional flat-chunk RAG by navigating a structured graph instead of scanning a flat list.

> **TL;DR**: Acting as a multi-dimensional atlas for your data, OHARA parses documents into precise structural hierarchies and enriches them with SUMO ontology tags and named entities[cite: 1]. By mapping semantic connections across *space* (cross-document entity pivots) and *time* (temporal intent and exponential decay), OHARA retrieves deep, corroborated context through a multi-phase hybrid architecture.

---

## Architecture Overview

```mermaid
flowchart TD
    SRC["📄 PDF / EPUB / DOCX / MD"]

    subgraph INGEST["① Ingest Pipeline  -  src/ingest/ingest.js"]
        direction TB
        I1["Preflight\nvalidate API keys + lit CLI"]
        I2["Dedup\nSHA-256 hash → skip if seen"]
        I3["Parse\nLiteParse → Markdown chunks"]
        I4["LLM Structuring\nGemini → DoCO nodes\n(Chapter / Section / Paragraph / Table…)"]
        I5["SUMO Validation\n22,700-entry ontology index\nexact → insensitive → alias"]
        I6["Entity Extraction\nPERSON / ORG / TECH / CONCEPT…\ncanonical dedup"]
        I7["Collection Transform\nnormalise + artifact filter\n+ fragment reattach"]
        I8["Persist to ArangoDB\nHAS_CHILD · NEXT_SIBLING\nBELONGS_TO · MENTIONS · RELATED_TO"]
        I9["Document Rollup\nunion entity_slugs + sumo_tags\nonto document node"]
        I10["Cross-Doc Similarity\nJaccard on entity sets\n→ SIMILAR_TO edges"]
        I11["Edge Enrichment\nGemini → verb + tags + summary\non each SIMILAR_TO edge"]
        I1-->I2-->I3-->I4-->I5-->I6-->I7-->I8-->I9-->I10-->I11
    end

    subgraph DB["ArangoDB Space-Time Graph"]
        direction LR
        C1[documents]
        C2[sections]
        C3[paragraphs]
        C4[tables]
        C5[entities]
        C6[edges]
    end

    subgraph RETRIEVE["② Retrieval Engine  -  src/retrieval.js"]
        direction TB
        R0["Phase 0 · Input Parsing\ntokenise · classify\nkeyword / phrase / paragraph"]
        R0a["Phase 0a · Query Fingerprint\nGemini → sumo_tags + entity hints\n(fires for phrase + paragraph queries)"]
        R1["Phase 1 · BM25 Full-text\nArangoSearch over content + title"]
        R2["Phase 1b · SUMO Expansion\ntag overlap + entity-type affinity\nscore = tag_overlap + 0.2×type_overlap"]
        R3a["Phase 1c · Cross-Doc Edges\nfollow SIMILAR_TO from seed docs\nfilter by weight > 0.3 or tag overlap"]
        R3b["Phase 2 · Entity Pivot\nshared entity_slugs across all docs\ndamped by OHARA_ENTITY_PIVOT_WEIGHT"]
        R4["Phase 3 · Structural Traversal\nAQL graph outbound from top node\nHAS_CHILD · NEXT_SIBLING · BELONGS_TO"]
        R5["Phase 4 · Score Fusion\nweighted sum · dedup by _id\nsort descending"]

        R0-->R0a-->R1-->R2
        R2-->R3a & R3b
        R3a & R3b-->R4-->R5
    end

    OUT["🔍 Ranked results\n{ node, score, sources, edge_verb, edge_summary }"]
    WIKI["📚 Quartz / Obsidian wiki export\nsrc/exporter.js"]

    SRC --> INGEST --> DB
    DB --> RETRIEVE --> OUT
    DB --> WIKI
```

---

## The Space-Time Graph

### Collections

| Collection | Contents |
|---|---|
| `documents` | Metadata root: source file, parser, title, upload time, entity_slugs, sumo_tags, published_date, temporal_coverage, temporal_granularity, temporal_confidence, decay_class, effective_decay_class, similar_to_indegree, description (LLM-generated one-sentence summary), structure_needs_review |
| `sections` | Structural hierarchy: chapter, section, subsection with level, title, and optional LLM-generated summary |
| `paragraphs` | Content nodes: body text, figures, list items with sumo_tags, entity_slugs, entity_types |
| `tables` | 2-D matrix data with markdown representation |
| `entities` | Named entities: canonical name, type, aliases, description, document_ids |
| `edges` | All relations (single collection, typed by `relation` field) |

### Edge Types

| Relation | Direction | Meaning |
|---|---|---|
| `HAS_CHILD` | section → section / paragraph / table | Structural parent–child |
| `NEXT_SIBLING` | section → section | Sequential ordering |
| `BELONGS_TO` | paragraph / table → document | Ownership |
| `MENTIONS` | paragraph → entity | Named entity occurrence |
| `RELATED_TO` | entity ↔ entity | Co-occurrence in the same paragraph |
| `SIMILAR_TO` | document → document | Jaccard similarity of entity sets (threshold-gated); enriched with LLM-generated `verb`, `tags`, `summary` |
| `TOC_REF` | document → section | TOC entry resolved to a section node (matched by page number then title) |

---

## Ingest Pipeline

```mermaid
flowchart TD
    FILE["📄 Input File\nPDF · EPUB · DOCX · MD"]

    FILE --> PRE

    PRE["① Preflight\nCheck GEMINI_API_KEY · ARANGO_URL · lit CLI"]
    PRE --> DEDUP

    DEDUP{"② Dedup\nSHA-256 hash\nalready ingested?"}
    DEDUP -- "yes, fully ingested\n(no --force)" --> SKIP["⏭ Skip"]
DEDUP -- "yes, partial\n(no --force)" --> PENDING["♻ Auto-retry\nllm_pending chunks"]
    DEDUP -- "no / --force" --> PARSE

    PARSE["③ Parse\nLiteParse → Markdown\n.md files pass through directly"]
    PARSE --> CHUNK

    CHUNK["Chunk\nMarkdown chunker\nsplit by heading / size"]
    CHUNK --> LLM

    LLM["④ LLM Structuring\nGemini gemini-2.5-flash-lite · Flex Inference\nparallel batches (OHARA_INGEST_CONCURRENCY=4)\noutput: DoCO nodes\nChapter · Section · Paragraph · Table · Figure…\n- cached by content hash -"]
    LLM --> SUMO

    SUMO["⑤ SUMO Tag Validation  src/sumo.js\n22,700-entry ontology index\n1. exact match\n2. case + separator-insensitive\n3. alias table (~100 entries)\ninvalid tags dropped + logged"]
    SUMO --> ENT

    ENT["⑥ Entity Extraction  src/entities.js\nvalidate candidate_entities from LLM\nPERSON · ORG · LOCATION · DATE\nTECH · AMOUNT · EVENT · CONCEPT\ncanonical dedup within node\nbuild entity_slugs + entity_types arrays"]
    ENT --> XFORM

    XFORM["⑦ Collection Transform\nnormalise → documents · sections · paragraphs · tables\nartifact filter: remove separator lines + TOC noise + short nodes\nfragment reattach: merge orphaned short paragraphs"]
    XFORM --> PERSIST

    PERSIST["⑧ Persist to ArangoDB  src/db/client.js\ninsert nodes into collections\nstructural edges:\nHAS_CHILD · NEXT_SIBLING · BELONGS_TO\nsemantic edges:\nMENTIONS · RELATED_TO"]
    PERSIST --> ROLLUP

    ROLLUP["⑨ Document Rollup\nunion all paragraph entity_slugs + sumo_tags\nonto the document root node\nenables O(docs) pre-filtering at query time"]
    ROLLUP --> SIM

    SIM["⑩ Cross-Doc Similarity\nJaccard similarity of entity sets\nvs. all existing documents\ncreate SIMILAR_TO edge if ≥ OHARA_SIMILARITY_THRESHOLD (0.1)"]
    SIM --> ENRICH

    ENRICH["⑪ Edge Enrichment\nfor each new SIMILAR_TO edge:\nGemini → verb · tags · summary (≤60 words)\ncached · stored on edge\nprompt: prompts/enrich_cross_doc_edge.md"]

    ENRICH --> DONE["✅ Document ingested\nready for retrieval"]
```

### Stages (`src/ingest/ingest.js`)

1. **Preflight** - validates `GEMINI_API_KEY`, `ARANGO_URL`, and the `lit` CLI (LiteParse).
2. **Dedup** - SHA-256 hashes the file; skips if already fully ingested (override with `--force`). If the document was previously **partially ingested** (some chunks failed), re-running without `--force` automatically retries the `llm_pending` chunks — no flag needed.
3. **Parsing** - LiteParse converts PDF/EPUB/DOCX to Markdown; plain `.md` files pass through directly.
4. **LLM structuring** - Gemini (`gemini-2.5-flash-lite`) maps Markdown chunks to DoCO nodes (`Chapter`, `Section`, `Paragraph`, `Table`, `Figure`, `Authors`, `Bibliography`, …). Responses are cached by content hash. Parallel batches (default 5, `OHARA_INGEST_CONCURRENCY`). First attempt uses **Flex Inference** tier; on failure retries once on **Standard** tier for higher availability. Failed chunks whose content cannot be structured are stored as raw `llm_pending` Paragraphs preserving original text — no content is lost.
5. **SUMO tag validation** - resolves `sumo_candidate_tags` against the SUMO ontology index (22,700 entries). Three-stage resolution: exact match → case/separator-insensitive → alias table. Duplicates collapsed. Invalid tags logged and dropped.
6. **Entity extraction** - validates `candidate_entities` from the LLM. Supported types: `PERSON`, `ORG`, `LOCATION`, `DATE`, `TECH`, `AMOUNT`, `EVENT`, `CONCEPT`. Canonical deduplication within each node.
7. **Collection transform** - normalizes nodes into `documents`, `sections`, `paragraphs`, `tables`. Artifact filter removes separator lines, TOC noise, and very short nodes. Fragment reattachment merges orphaned short paragraphs.
8. **Persistence** - inserts into ArangoDB with `HAS_CHILD`, `NEXT_SIBLING`, `BELONGS_TO` structural edges; upserts entity nodes and inserts `MENTIONS` / `RELATED_TO` edges.
9. **Document rollup** - after all paragraphs are inserted, unions `entity_slugs` and `sumo_tags` onto the `documents` record for O(docs) pre-filtering. Also generates a one-sentence `description` via Gemini from top paragraph snippets (cached). Runs structural verification: checks `HAS_CHILD` edge consistency; flags `structure_needs_review: true` if level jumps > 1 are detected.
10. **Cross-document similarity** - computes Jaccard similarity between the new document's entity set and all existing documents. Creates `SIMILAR_TO` edges where similarity ≥ `OHARA_SIMILARITY_THRESHOLD` (default 0.1).
11. **Cross-document edge enrichment** - for each new `SIMILAR_TO` edge, calls Gemini (Flex Inference, cached) with representative snippets from both documents to generate a `verb` (e.g. `"extends the argument of"`), `tags` (1–4 SUMO-style concept tags), and `summary` (≤ 60 words). Result is stored on the edge for use at retrieval time. Prompt: `prompts/enrich_cross_doc_edge.md`. A `temporal_relation` field (`extends` | `supersedes` | `discusses`) is also set on the edge from the verb - no extra LLM call. After all `SIMILAR_TO` edges are created, `similar_to_indegree` is computed for the new document; if it exceeds `OHARA_SIMILAR_TO_EVERGREEN_THRESHOLD`, `effective_decay_class` is promoted to `EVERGREEN`.

### Prompt Schema (`prompts/ingest_document.md`)

The Gemini prompt instructs the model to output `{ nodes: [...] }` where each node carries:

```
type              # DoCO type (Chapter, Section, Paragraph, Table, Figure, …)
part              # front_matter | body_matter | back_matter
metadata          # { page, level }
sumo_candidate_tags   # short SUMO local names e.g. ["Agent", "Transaction"]
candidate_entities    # [{ name, canonical, type, aliases? }]
content / title / table / figure / agents_group / references   # type-specific fields

# document-level temporal fields (extracted once per doc, not per chunk):
published_date        # "YYYY-MM-DD" | "YYYY" | null
temporal_coverage     # { start: "YYYY"|null, end: "YYYY"|null }
temporal_granularity  # 'day'|'month'|'year'|'decade'|'century'
temporal_confidence   # 0.0–1.0
decay_class           # 'EVERGREEN'|'SCHOLARLY'|'CURRENT'|'EPHEMERAL'
```

### Web Crawl Ingest (`ingestCrawledDomain`)

When ingesting HTML pages from the `crawl` ArangoDB collection, **all pages from the same hostname are bundled into a single document**. Each page becomes an `## H2` section under a root `# hostname` heading. This keeps one `documents` node per domain rather than one per URL.

Bundle logic (`src/ingest/ingest.js` → `ingestCrawledDomain`):
1. Group `crawl` records by `new URL(page.url).hostname`.
2. For each hostname, build `<hostname>.md`: H1 = hostname, H2 per page (with `<!-- url: ... -->` comment), body = page markdown.
3. Write combined file to `doc_pipeline/input/` and call `ingestSingleFile` once.
4. Returns `{ ingested, failed, skipped, total }` counted per domain, not per page.

To re-ingest rwatimes.io after this fix: delete old per-page documents from ArangoDB, then run `ingestCrawledDomain('rwatimes.io', ...)` with `force: true`.

---

## Retrieval Engine (`src/retrieval.js`)

```mermaid
flowchart TD
    Q["🔍 Raw Query String"]

    Q --> P0

    P0["Phase 0 · Input Parsing\ntokenise: lowercase · [a-z0-9]+ · strip stopwords\nclassify: keyword ≤3 · phrase 4-30 · paragraph >30 tokens"]
    P0 --> P0A

    P0A{"phrase or\nparagraph?"}
    P0A -- "keyword only" --> P1
    P0A -- "phrase / paragraph" --> GEM

    GEM["Phase 0a · Query Fingerprint  prompts/extract_query_fingerprint.md\nGemini → { sumo_tags, entities:[{slug,type}] }\nsumo_tags resolved via validateTags() · cached"]
    GEM --> P1

    P1["Phase 1 · BM25 Full-text\nArangoSearch over content + title + markdown_representation\nfallback: term-overlap scan when view unavailable\ntop N results (OHARA_RESULT_LIMIT=20)"]
    P1 --> P1B

    P1B["Phase 1b · SUMO Tag Expansion\nsumoSet = query sumo_hints ∪ top-5 BM25 result tags\nAQL: INTERSECTION(p.sumo_tags, sumoSet)\nscore = tag_overlap/tag_count\n      + 0.2 × entity_type_overlap/type_count"]

    P1 --> P1C & P2
    P1B --> P1C & P2

    P1C["Phase 1c · Cross-Doc Edge Expansion\nmulti-hop SIMILAR_TO (1..expandDepth)\nfilter: edge.weight > 0.3 OR tag overlap\nresult carries edge_verb + edge_summary + hops"]

    P2["Phase 2 · Entity Pivot\nslugSet = query entity_hints ∪ top-5 BM25 entity_slugs\nfind paragraphs sharing those entities across all docs\nweight: OHARA_ENTITY_PIVOT_WEIGHT (0.6)"]

    P1C --> P3
    P2  --> P3

    P3["Phase 3 · Structural Traversal\nAQL outbound from top-scored node\nedge types: HAS_CHILD · NEXT_SIBLING · BELONGS_TO\ndepth: 2 (configurable)"]
    P3 --> FUSE

    FUSE["Phase 4 · Score Fusion\nmerge all phase results by node _id\nweighted sum:\nBM25×1.0 · SUMO×0.4 · entity×0.6\ncross-doc×0.4 · structural×0.3\nsort descending · top-K slice"]

    FUSE --> CORR["Corrective RAG\ndrop Phase 3 structural nodes\nwith zero SUMO tag overlap\n(OHARA_CORRECTIVE_STRUCT=true)"]
    CORR --> TIERS["Tier Classification\nPrincipal · Integrity · Explorer"]
    TIERS --> SELF["Self-RAG (opt-in)\nGemini responsiveness check\non Principal tier nodes\n(OHARA_SELF_RAG_VERIFY)"]
    SELF --> OUT["📦 Results\n{ processedQuery, results, tiers,\nshallowResults, entityPivotResults,\ncrossDocResults, deepResults }"]
```

`RetrievalEngine.query(rawInput, options)` - standard single-pass retrieval.
`RetrievalEngine.queryCoR(rawInput, options)` - Chain-of-Retrieval iterative mode.
`RetrievalEngine.queryAgent(rawInput, options)` - Agentic RAG: Gemini-driven dynamic tool dispatch.

### Phase 0 - Input Parsing
Tokenizes raw input: lowercase, `[a-z0-9]+` regex, strips stopwords, drops tokens ≤ 2 chars. Returns `{ keywords, raw }`.

### Phase 0b - TOC-Guided Section Selection (PageIndex-inspired)
For phrase and paragraph queries, fetches the section tree (titles + LLM-generated summaries) for the top 3 BM25 seed documents and asks Gemini (`prompts/toc_section_selector.md`, temperature 0, cached) which sections are most likely to contain the answer. The selected section IDs are used as additional entry points for Phase 3 structural traversal - in addition to the top BM25 node - so retrieval descends from semantically pre-validated positions in the document hierarchy rather than the single highest-BM25 leaf. TOC-guided structural nodes are exempt from Corrective RAG's SUMO-overlap filter (Gemini already validated them via section summary). Controlled by `OHARA_TOC_GUIDANCE` (default `true`).

### Phase 1 - Shallow Context
ArangoSearch BM25 full-text search over `content`, `title`, and `markdown_representation`. Returns top N results (default 20). Falls back to term-overlap scoring when the ArangoSearch view is unavailable.

### Phase 1b - SUMO Tag Expansion
Finds paragraphs whose `sumo_tags` overlap with the query's SUMO hints or the top BM25 results' tags. For phrase and paragraph queries (≥ 4 tokens), SUMO hints and entity types are extracted from the raw query via Gemini (`prompts/extract_query_fingerprint.md`) before this phase runs. The fingerprint also returns `temporal_intent` (`current_state` | `historical_fact` | `influence_chain` | `none`) which gates temporal scoring. Score = `tag_overlap / query_tag_count + 0.2 × entity_type_overlap / query_entity_type_count`.

### Phase 1c - Cross-Document Edge Expansion
Follows `SIMILAR_TO` edges from the seed documents (top 5 BM25 hits) to retrieve related paragraphs from other documents, up to `expandDepth` hops (graph traversal, `1..expandDepth ANY` over `SIMILAR_TO` edges). Edges are filtered by `weight > 0.3` or overlapping `edge.tags`. Each result carries `edge_verb`/`edge_summary` from the closest hop's ingest-time LLM enrichment, plus `hops` indicating how many SIMILAR_TO edges were traversed to reach it. Runs in parallel with Phase 3. Controlled by `OHARA_CROSS_DOC_WEIGHT` (default 0.4), `OHARA_CROSS_DOC_LIMIT` (default 5), and `OHARA_CROSS_DOC_EXPAND_DEPTH` (default 1). All three can be overridden per call via `query(text, { crossDocWeight, crossDocLimit, expandDepth })`.

### Phase 2 (formerly 1b) - Entity Pivot
From the top seed paragraphs' `entity_slugs`, finds other paragraphs across all documents that share those entities. Scores with a damped weight (`OHARA_ENTITY_PIVOT_WEIGHT`, default 0.6). Runs in parallel with Phase 1c. Entity hints carry `{ slug, type }` objects; paragraph nodes store a parallel `entity_types` array (built alongside `entity_slugs` at ingest time) to enable type-affinity scoring in Phase 1b without extra AQL joins. Old paragraphs without `entity_types` score 0 on type-affinity - backward-compatible.

### Phase 3 - Structural Traversal
AQL graph traversal outbound from the top-scored node via `HAS_CHILD`, `NEXT_SIBLING`, `BELONGS_TO` edge types. Depth defaults to 2.

### Corrective RAG - Structural Noise Filter
After Phase 3, structural results are filtered by SUMO tag overlap against the query's `sumoHints` before fusion. Nodes with zero overlap are dropped - structurally-proximate ≠ semantically relevant. Controlled by `OHARA_CORRECTIVE_STRUCT` (default `true`); bypassed when query has no SUMO hints (keyword queries).

### Phase 4 - Score Fusion
All phase results are merged by node `_id`. Scores are weighted and summed; results sorted descending. Cross-doc results propagate `edge_verb`/`edge_summary` to the fused entry. A temporal score is added per node when `temporal_intent ≠ 'none'`, using an exponential decay formula: `OHARA_TEMPORAL_WEIGHT × exp(−λ × Δt)`. λ is drawn from the document's `effective_decay_class` env var. The temporal contribution is skipped for `principal`-tier nodes and nodes whose BM25 score exceeds `OHARA_TEMPORAL_GATE_FLOOR` (protects high-relevance docs from recency bias).

Returns `{ processedQuery, results, tiers, shallowResults, entityPivotResults, crossDocResults, deepResults }`.

### Tier Classification - Principal / Integrity / Explorer

Inspired by how people actually research: [Bates' Berrypicking model](https://en.wikipedia.org/wiki/Berrypicking) (info-seeking is incremental, bit-by-bit), [Pirolli's Information Foraging Theory](https://en.wikipedia.org/wiki/Information_foraging) (follow "scent" signals, stop when scent weakens), and journalistic cross-referencing (a claim counts as verified only once corroborated by ≥2 independent sources). `query()`'s `tiers` field classifies the fused result set into three groups, computed by `_classifyTiers` (post-processing, no extra DB pipeline):

- **`tiers.principal`** - compact, corroborated-by-many-angles core answer. A node qualifies if it's hit by ≥2 phases (`contributions.length >= 2`) AND either spans ≥2 distinct documents or was reached via a cross-doc edge, AND its score clears a percentile floor (`OHARA_PRINCIPAL_SCORE_PCTL`, default top quartile). Capped at `OHARA_PRINCIPAL_LIMIT` (default 5).
- **`tiers.integrity`** - Principal plus "verified" entries: structural-traversal neighbors of Principal nodes, and cross-doc edges with `weight >= OHARA_INTEGRITY_WEIGHT_MIN` (default 0.6). Each entry carries a `provenance` array (phase, document, edge verb/hops) showing what corroborated it. An optional one-shot Gemini cross-check (`OHARA_INTEGRITY_LLM_VERIFY`, off by default) can further validate multi-document candidates - always called with `temperature: 0` and a single-turn prompt (no chat history), matching the existing `prompts/enrich_cross_doc_edge.md` call pattern.
- **`tiers.explorer`** - a `frontier` of further candidates one hop beyond Integrity (reuses `_phase1cCrossDocEdge` with `expandDepth + 1`), restricted to the band between `OHARA_EXPLORER_STOP_WEIGHT` (default 0.15) and `OHARA_INTEGRITY_WEIGHT_MIN` - the "weakening scent" zone. Returns metadata only (`document_id`, `edge_verb`, `edge_summary`, `score`), not full content - meant as candidate directions for a caller/UI to offer, not a final answer. `stopped_reason` explains why expansion stopped.

### Self-RAG - Principal Tier Responsiveness Filter
After tier classification, an optional Gemini one-shot pass (`prompts/self_rag_verify.md`, temperature 0, flex, cached) checks whether each `tiers.principal` node actually answers the query. Non-responsive nodes are removed. Controlled by `OHARA_SELF_RAG_VERIFY` (default off) or per-call `{ selfRagVerify: true }`.

### Chain-of-Retrieval (CoR)
`queryCoR(rawInput, options)` wraps `query()` in an iterative loop. Each iteration augments the query with top Explorer `edge_verb`/`edge_summary` signals and re-runs retrieval. Results are merged across iterations (dedup by `_id`, max score wins). Stops at `OHARA_COR_MAX_ITER` iterations (default 2) or when the top score improves by less than `OHARA_COR_SCORE_DELTA` (default 0.05). Use for deep multi-hop queries where influence chains span 3+ documents.

CLI: `node bin/ohara.js query "<text>" --tiers [--verbose] [--cor]`.
API: `POST /api/retrieval/query` with `{ cor: true }` routes to `queryCoR()`.

### Conversational RAG
`query()` accepts a `sessionHistory: [{role, content}]` option. The last N turns (`OHARA_SESSION_HISTORY_LIMIT`, default 3) are prepended to the query fingerprint prompt so Gemini resolves anaphora ("what about its governance?") before Phase 1 runs. The UI accumulates history automatically across queries and sends it with each request; a turn counter and clear button appear in the query panel when history is active.

### Speculative RAG
After each `query()` response, background async pre-warm calls fire on the top Explorer frontier nodes (using their `edge_verb`/`edge_summary` as query seeds). Results are cached under `SPECULATIVE:<query_hash>:<node_id>`. Reduces cold-start latency for predictable follow-up queries. Controlled by `OHARA_SPECULATIVE_RAG` (default off) and `OHARA_SPECULATIVE_LIMIT` (default 3 frontier nodes).

### REFEED RAG - Feedback Loop
User thumbs up/down on each result card in the UI posts `{ query_hash, node_id, result_rank, signal }` to `POST /api/retrieval/feedback`, stored in the `feedback` ArangoDB collection. Run `node scripts/tune_weights.js` to read accumulated feedback and get per-rank accuracy stats with suggested `OHARA_*_WEIGHT` adjustments. Pass `--apply` to write suggestions to `.env` in-place.

### Reasoning RAG - Sub-Query Gap Fill
After Phase 1 BM25, Gemini inspects the top results and generates 1–2 targeted sub-queries for gaps the initial results don't cover (`prompts/reasoning_subquery.md` → `{subqueries: [...]}`). Each sub-query runs through `_phase1BM25()` independently; new results are merged (dedup by `_id`) before Phase 1b. Controlled by `OHARA_REASONING_RAG` (default off) and `OHARA_REASONING_SUBQUERY_LIMIT` (default 2).

### Agentic RAG - Dynamic Tool Dispatch
`queryAgent(rawInput, options)` replaces the fixed pipeline with a Gemini-guided loop. Each iteration:
1. Gemini reads the query, found-so-far snippets, and tool history → picks one of `bm25 | entity_pivot | cross_doc | structural | done` (`prompts/agent_strategy.md`, temperature 0, cached).
2. The chosen retrieval tool runs; new nodes merge into the accumulator (dedup by `_id`, max score wins).
3. Loop continues until Gemini returns `done`, a tool would repeat, or `OHARA_AGENT_MAX_ITER` (default 4) iterations are reached.

Each result carries `agent_tool` tag showing which tool surfaced it. The response includes `agent_trace: [{tool, added}]` (nodes added per iteration) and `agent_tool_history: [...]` (ordered tool list). The UI purple badge shows the full trace inline: `bm25 +8 → entity_pivot +3 → cross_doc +1`; hovering shows the same as a tooltip.

CLI: `node bin/ohara.js query "<text>" --agent`.
API: `POST /api/retrieval/query` with `{ agent: true }` (takes precedence over `cor`).

### Answer Synthesis
`POST /api/retrieval/answer` runs retrieval (supporting `cor`, `agent`, `sessionHistory`, `selfRagVerify`, `reasoningRag` params) then passes the top 6 Principal-tier nodes as context to Gemini (`gemini-2.5-flash-lite`, temperature 0.2) with an instruction to cite sources with `[n]` inline. Returns `{ answer, citations: [{ref, document_id, node_id, title, score}], retrieval }`. The `retrieval` field contains the full retrieval response for inspection. UI: "answer" checkbox routes the query to this endpoint and shows a green answer panel with citation list above the result tabs.

---

## Entity System (`src/entities.js`)

Named entities are first-class graph nodes, not just tags on paragraphs.

**Entity types**: `PERSON`, `ORG`, `LOCATION`, `DATE`, `TECH`, `AMOUNT`, `EVENT`, `CONCEPT`

**Entity record**:
```json
{
  "_key": "bitcoin",
  "name": "Bitcoin",
  "slug": "bitcoin",
  "norm_key": "bitcoin",
  "type": "TECH",
  "aliases": ["BTC", "₿"],
  "description": "Decentralized digital currency…",
  "document_ids": ["doc/abc123", "doc/def456"],
  "mention_count": 47,
  "first_seen": "2026-06-23T…"
}
```

**Cross-document dedup**: run `node src/ingest/entity_dedup.js` after batch ingest to merge entity nodes with matching `norm_key`, repointing all `MENTIONS` edges to the surviving canonical node.

**Noise filtering**: `validateEntity` rejects opaque, machine-generated identifier tokens (hashes, UUIDs, addresses, base58/base64-ish strings) via `isOpaqueToken()` - a domain-agnostic heuristic (length, whitespace, vowel ratio), not specific to any one document type. This runs at ingest time on new documents. For already-ingested data, run `node scripts/clean_noise_entities.js --dry-run` to preview, then without `--dry-run` to remove noise entities, their edges, and strip matching slugs from `paragraphs`/`documents` `entity_slugs` rollups (requires a real ArangoDB connection, same as `entity_dedup.js`).

---

## SUMO Ontology Tags (`src/sumo.js`)

Every node is tagged with concepts from the [SUMO ontology](https://www.ontologyportal.org/) (22,700 entries in `ontology/sumo_index.json`).

Resolution order per tag:
1. Exact match against `sumo_index.json`
2. Case + separator-insensitive match
3. Alias table (~50 common LLM-emitted terms → canonical SUMO names)

Tags that fail all three stages are dropped and logged. Duplicate canonical tags within a node are collapsed.

---

## Wiki Export (`src/exporter.js`)

`QuartzExporter` converts the ArangoDB graph into a Quartz-compatible Markdown wiki.

```bash
npm run ohara:export          # Quartz Markdown → wiki/
npm run ohara:export:json     # Raw JSON → doc_pipeline/collections/export.json
```

Output structure:
```
wiki/
  index.md                    # Home page with document list and entity index link
  documents/
    <doc-slug>/
      index.md                # Document landing page with TOC
      <section-slug>.md       # One page per section with content + related links
  entities/
    index.md                  # Entity index grouped by type
    <entity-slug>.md          # Per-entity page: description + backlinks + related entities
```

Entity pages include:
- YAML frontmatter with `title`, `tags`, `aliases`
- LLM-generated stub description (filled during ingest)
- **Mentioned in** - every paragraph that mentions the entity with document/section context
- **Related Entities** - entities co-occurring in the same paragraphs

---

## Configuration

All tunables are set via environment variables. Copy `.env.example` to `.env`:

| Variable | Default | Purpose |
|---|---|---|
| `GEMINI_API_KEY` | - | Required. Google Gemini API key |
| `ARANGO_URL` | - | ArangoDB connection URL (may include credentials and DB name) |
| `ARANGO_USER` | - | DB username (can also embed in URL) |
| `ARANGO_PASSWORD` | - | DB password |
| `LITEPARSE_CLI_PATH` | - | Path to the `lit` LiteParse CLI binary |
| `PORT` | `3000` | HTTP server port |
| `OHARA_INGEST_CONCURRENCY` | `4` | Parallel LLM chunk requests during ingest |
| `OHARA_LLM_CACHE_DIR` | - | Directory for LLM response cache |
| `OHARA_SIMILARITY_THRESHOLD` | `0.1` | Min Jaccard score to create a `SIMILAR_TO` doc–doc edge |
| `OHARA_ENTITY_PIVOT_LIMIT` | `5` | Max cross-document paragraphs from entity-pivot phase |
| `OHARA_ENTITY_PIVOT_WEIGHT` | `0.6` | Score multiplier for entity-pivot results |
| `OHARA_CROSS_DOC_WEIGHT` | `0.4` | Score multiplier for cross-document edge expansion results |
| `OHARA_CROSS_DOC_LIMIT` | `5` | Max paragraphs returned per cross-document edge expansion |
| `OHARA_CROSS_DOC_EXPAND_DEPTH` | `1` | Max SIMILAR_TO hops to traverse from seed documents during Phase 1c |
| `OHARA_PRINCIPAL_SCORE_PCTL` | `0.75` | Score percentile floor (within fused results) for the Principal tier |
| `OHARA_PRINCIPAL_LIMIT` | `5` | Max entries in the Principal tier |
| `OHARA_PRINCIPAL_REQUIRE_MULTI_DOC` | `false` | Require cross-document diversity for Principal tier (strict mode; disable for small corpora) |
| `OHARA_INTEGRITY_WEIGHT_MIN` | `0.6` | Min cross-doc edge weight to count as "verified" in the Integrity tier |
| `OHARA_INTEGRITY_LLM_VERIFY` | off | Enable optional one-shot Gemini cross-check for Integrity-tier candidates (temperature 0) |
| `OHARA_EXPLORER_STOP_WEIGHT` | `0.15` | Min edge weight for a candidate to appear in the Explorer frontier (below this, scent too weak) |
| `OHARA_SUMO_HIERARCHY_DEPTH` | `3` | Max ancestor hops to expand query SUMO tags in Phase 1b; 0 disables hierarchy expansion |
| `OHARA_EMBED_PARAGRAPHS` | `false` | Generate Gemini `text-embedding-004` vectors during ingest (requires vector index) |
| `OHARA_EMBED_BATCH_SIZE` | `20` | Paragraph batch size for embedding API calls |
| `OHARA_VECTOR_WEIGHT` | `0.5` | Score weight for Phase 1d vector similarity results in fusion |
| `OHARA_VECTOR_LIMIT` | `10` | Max results returned from Phase 1d vector ANN search |
| `OHARA_TEMPORAL_WEIGHT` | `0.2` | Additive score contribution from temporal decay (0 = disabled) |
| `OHARA_TEMPORAL_GATE_FLOOR` | `5.0` | BM25 score above which temporal decay is skipped (protects high-relevance documents from recency bias) |
| `OHARA_DECAY_RATE_EVERGREEN` | `0.000001` | λ decay rate for EVERGREEN documents (laws, classics, math - near-zero decay) |
| `OHARA_DECAY_RATE_SCHOLARLY` | `0.0001` | λ decay rate for SCHOLARLY documents (papers, textbooks - ~20 yr half-life) |
| `OHARA_DECAY_RATE_CURRENT` | `0.01` | λ decay rate for CURRENT documents (news, blogs - ~70 day half-life) |
| `OHARA_DECAY_RATE_EPHEMERAL` | `0.1` | λ decay rate for EPHEMERAL documents (social posts, changelogs - ~7 day half-life) |
| `OHARA_SIMILAR_TO_EVERGREEN_THRESHOLD` | `5` | Min incoming SIMILAR_TO edges to auto-promote a document to EVERGREEN decay class |
| `OHARA_CORRECTIVE_STRUCT` | `true` | Corrective RAG: filter Phase 3 structural nodes with zero SUMO tag overlap before fusion (TOC-guided nodes are exempt) |
| `OHARA_TOC_GUIDANCE` | `true` | TOC-guided Phase 0b: for phrase/paragraph queries, ask Gemini which sections are relevant before structural traversal (PageIndex-inspired) |
| `OHARA_SELF_RAG_VERIFY` | `false` | Self-RAG: Gemini responsiveness check on Principal tier after classification (opt-in) |
| `OHARA_SESSION_HISTORY_LIMIT` | `3` | Conversational RAG: number of prior Q&A turns prepended to query fingerprint prompt |
| `OHARA_COR_MAX_ITER` | `2` | Chain-of-Retrieval: max retrieval iterations chasing Explorer frontier |
| `OHARA_COR_SCORE_DELTA` | `0.05` | Chain-of-Retrieval: min score improvement between iterations to continue |
| `OHARA_SPECULATIVE_RAG` | `false` | Speculative RAG: pre-warm Explorer frontier in background after each query (opt-in) |
| `OHARA_SPECULATIVE_LIMIT` | `3` | Speculative RAG: number of frontier nodes to pre-warm per query |
| `OHARA_REASONING_RAG` | `false` | Reasoning RAG: generate sub-queries from BM25 gaps before Phase 1b (opt-in) |
| `OHARA_REASONING_SUBQUERY_LIMIT` | `2` | Reasoning RAG: max sub-queries generated per request |
| `OHARA_AUTO_ENTITY_DEDUP` | `false` | Auto-run cross-doc entity dedup after each ingest (opt-in) |
| `OHARA_AGENT_MAX_ITER` | `4` | Agentic RAG: max Gemini tool-dispatch iterations per query |

---

## Getting Started

### 1. Install
```bash
npm install
```

### 2. Configure
```bash
cp .env.example .env
# Fill in GEMINI_API_KEY, ARANGO_URL (or leave blank to use in-memory simulator)
```

### 3. Run the dashboard
```bash
npm run dev        # starts Express server with nodemon
# open http://localhost:3000
```

### 4. Ingest a document
```bash
# Via dashboard UI - drag and drop in the Ingest tab
# Via CLI:
npm run ohara:ingest                          # ingest sample PDF
node bin/ohara.js ingest path/to/file.pdf    # ingest any file
node bin/ohara.js ingest path/to/file.pdf --force  # re-ingest even if already processed
```

### 5. Query
```bash
npm run ohara:query                                         # sample query
node bin/ohara.js query "proof of work consensus"          # custom query
node bin/ohara.js query "topic" --tiers --verbose          # show Principal/Integrity/Explorer tiers
node bin/ohara.js query "topic" --cor                      # Chain-of-Retrieval iterative mode
node bin/ohara.js query "topic" --agent                    # Agentic RAG (Gemini-driven tool dispatch)
```

### 6. Export to wiki
```bash
npm run ohara:export        # Quartz Markdown → wiki/
npm run ohara:export:json   # Raw JSON dump
```

### 7. Cross-document entity dedup (run after batch ingest)
```bash
node src/ingest/entity_dedup.js
```

---

## How To Use

This section walks through the main workflows end-to-end.

### First-Time Setup

```bash
# 1. Copy config
cp .env.example .env

# 2. Required: add Gemini API key and ArangoDB connection
#    GEMINI_API_KEY=your_key
#    ARANGO_URL=http://root:password@localhost:8529/ohara
#    LITEPARSE_CLI_PATH=/path/to/lit     # for PDF/EPUB/DOCX parsing
#
#    Leave ARANGO_URL blank to run with the in-memory simulator (no ArangoDB needed).

# 3. Initialise ArangoDB collections and ArangoSearch view
node scripts/db-init.js

# 4. Start the server
npm run dev
# → Dashboard at http://localhost:3000
```

---

### Ingesting Documents

**Dashboard (recommended for one-off files)**

1. Open the **Ingest** tab.
2. Upload a file (PDF, EPUB, DOCX, or plain `.md`).
3. Click **Run Pipeline**. Progress logs stream in real time.
4. Once complete, the document appears in the **Documents** tab.

**CLI (batch / scripted)**

```bash
# Single file
node bin/ohara.js ingest path/to/document.pdf

# Force re-ingest (skips SHA-256 dedup check)
node bin/ohara.js ingest path/to/document.pdf --force

# Background queue (BullMQ worker must be running)
node src/ingest/worker.js &           # start background worker
node bin/ohara.js ingest file.pdf     # enqueues the job
```

**Post-ingest maintenance (run once after a batch)**

```bash
# Merge duplicate entity nodes across documents
node src/ingest/entity_dedup.js

# Remove opaque-identifier noise entities (dry-run first)
node scripts/clean_noise_entities.js --dry-run
node scripts/clean_noise_entities.js
```

**Auto-dedup on every ingest** - set `OHARA_AUTO_ENTITY_DEDUP=true` in `.env`.

---

### Querying Documents

#### Dashboard

1. Open the **Query** tab and type your question.
2. Press Enter or click **Search**.
3. Results appear in three tabs:
   - **All** - full ranked list, each card shows score, SUMO tags, entity slugs, and phase badges.
   - **★ Principal** - compact core-answer set: nodes corroborated by ≥2 retrieval phases.
   - **✓ Integrity** - Principal plus structurally/cross-doc verified neighbours with provenance trail.
   - **◎ Explorer** - frontier candidates one hop beyond Integrity; use these as jumping-off points, not final answers.
4. Thumbs up/down on any card posts feedback (used by REFEED RAG weight tuning).

**Query mode toggles (checkboxes below the search bar)**

| Toggle | Effect |
|---|---|
| `cor` | Chain-of-Retrieval: runs retrieval iteratively, chasing Explorer frontier signals. Good for deep multi-hop questions spanning 3+ documents. |
| `agent` | Agentic RAG: Gemini picks which retrieval tool to use each iteration (`bm25 → entity_pivot → cross_doc → structural`). Shown as a purple trace badge: `bm25 +8 → entity_pivot +3`. Takes precedence over `cor`. |
| `answer` | Answer Synthesis: routes to `/api/retrieval/answer`, which retrieves then generates a Gemini-grounded answer with inline `[n]` citations. Green answer panel appears above results. |

**Conversational context** - after each query, the turn is accumulated automatically. A turn counter + clear button appear when history is active. The last 3 Q&A pairs are sent with every subsequent query so Gemini resolves anaphora ("what about its governance?") correctly. Clear history to start fresh.

#### CLI

```bash
# Basic query
node bin/ohara.js query "proof of work consensus"

# Show tier breakdown (Principal / Integrity / Explorer)
node bin/ohara.js query "topic" --tiers

# Verbose: include entity hints, SUMO tags, phase scores
node bin/ohara.js query "topic" --tiers --verbose

# Chain-of-Retrieval (multi-hop)
node bin/ohara.js query "influence of Keynes on post-war policy" --cor

# Agentic RAG (Gemini-guided tool dispatch)
node bin/ohara.js query "cross-document comparison of monetary theory" --agent
```

---

### Advanced RAG Features

All features below are off by default (opt-in via `.env` or per-request).

**Self-RAG** - Gemini checks each Principal node for actual query responsiveness after tier classification. Non-responsive nodes are removed.
```
OHARA_SELF_RAG_VERIFY=true
```

**Reasoning RAG** - After BM25, Gemini generates 1–2 sub-queries targeting gaps in the initial results. Each sub-query runs BM25 independently; new nodes are merged before SUMO expansion.
```
OHARA_REASONING_RAG=true
OHARA_REASONING_SUBQUERY_LIMIT=2
```

**Speculative RAG** - After each query, background pre-warm calls fire on the top Explorer frontier nodes so likely follow-up queries hit cache instead of running the full pipeline.
```
OHARA_SPECULATIVE_RAG=true
OHARA_SPECULATIVE_LIMIT=3
```

**Corrective RAG** - On by default. Structural traversal nodes with zero SUMO tag overlap are dropped before fusion (structural proximity ≠ semantic relevance). Disable with `OHARA_CORRECTIVE_STRUCT=false`.

**Temporal scoring** - Adds an exponential decay contribution to each fused node based on `published_date` and `decay_class`. Protected by four guards: no temporal intent in query → skipped; Principal tier → immune; high BM25 score → immune; EVERGREEN class → near-zero decay.
```
OHARA_TEMPORAL_WEIGHT=0.2    # 0 = disabled
```

---

### Tuning Retrieval Weights (REFEED RAG)

After accumulating thumbs-up/down feedback from the dashboard:

```bash
# Preview suggested weight adjustments
node scripts/tune_weights.js

# Apply suggestions to .env in-place
node scripts/tune_weights.js --apply
```

The script reads the `feedback` ArangoDB collection, computes per-rank accuracy (positive / total), and suggests `OHARA_*_WEIGHT` values. Restart the server after applying.

---

### Analytics Dashboard

Click the **◎ Analytics** tab to see:
- **Corpus summary** - total documents, paragraphs, entities, and feedback signals.
- **Accuracy by rank** - green bar chart showing positive-feedback rate at each result rank (rank 1 = top result). High accuracy at rank 1 means retrieval is well-calibrated.
- **Top-rated nodes** - the 10 nodes most frequently thumbed-up across all queries; useful for identifying canonical reference passages.

Refresh the tab at any time with the **Refresh** button.

---

### Exporting to a Wiki

```bash
npm run ohara:export        # Quartz-compatible Markdown → wiki/
npm run ohara:export:json   # Raw JSON dump → doc_pipeline/collections/export.json
```

The `wiki/` directory is ready to drop into a [Quartz](https://quartz.jzhao.xyz/) or Obsidian vault. Each entity gets its own page with backlinks to every paragraph that mentions it; each document gets a landing page with a TOC.

---

### Backfilling Vector Embeddings

If you enable `OHARA_EMBED_PARAGRAPHS=true` for future ingests but have existing paragraphs without vectors:

```bash
# Preview what would be backfilled
node scripts/backfill_embeddings.js --dry-run

# Run backfill (requires GEMINI_API_KEY + ArangoDB connection)
node scripts/backfill_embeddings.js
```

Then create the ArangoDB vector index (ArangoDB 3.12 Enterprise required) and restart the server. Results from Phase 1d (vector ANN) will appear in retrieval.

---

## User Study (paper §6)

`study.html` (served statically at `/study.html`) is the **flat-list comparison interface** for the within-subjects user study: a plain document list with text search, date-range and tag filters, and a click-through section/paragraph reader — no 3D, no graph. It reads only existing endpoints (`GET /api/documents` paged, `GET /api/graph?docKeys=`) and adds a built-in task timer whose log (task label, interface, elapsed ms, answer) is exportable as JSON for analysis. Task sheets, counterbalancing plan, gold answers, and the SUS questionnaire live in `tests/eval/user_study/TASK_SHEETS.md`. No schema, route, or palette changes.

## Repository Structure

```
├── bin/
│   ├── ohara.js              # CLI entry point
│   └── ohara-mcp.js          # MCP server
├── src/
│   ├── entities.js           # NER validation, slug/dedup helpers
│   ├── exporter.js           # QuartzExporter (Markdown wiki)
│   ├── retrieval.js          # Three-phase retrieval engine
│   ├── sumo.js               # SUMO ontology tag validation
│   ├── toc.js                # Pseudo-TOC generator
│   ├── cache.js              # LLM response cache
│   ├── db/
│   │   ├── client.js         # ArangoDB client (real DB)
│   │   ├── simulator.js      # In-memory ArangoDB simulator with AQL support
│   │   └── seed.js           # Sample graph seed data
│   └── ingest/
│       ├── ingest.js         # Core ingestion pipeline
│       ├── worker.js         # BullMQ worker
│       ├── queue.js          # Job queue management
│       ├── chunker.js        # Markdown chunker
│       └── entity_dedup.js   # Cross-document entity merge worker
├── prompts/
│   ├── ingest_document.md            # Main LLM prompt (DoCO structuring + entities + SUMO + temporal metadata)
│   ├── enrich_cross_doc_edge.md      # LLM prompt for SIMILAR_TO edge verb/tags/summary
│   ├── extract_query_fingerprint.md  # Lightweight prompt for short queries: sumo_tags + entities + temporal_intent
│   ├── self_rag_verify.md            # Self-RAG: responsiveness check prompt → {responsive, reason}
│   ├── reasoning_subquery.md         # Reasoning RAG: gap sub-query generation → {subqueries: [...]}
│   ├── agent_strategy.md             # Agentic RAG: tool picker prompt → {tool, reason, hint}
│   ├── verify_integrity_claim.md     # Integrity tier cross-check prompt
│   ├── extract_toc.md
│   ├── extract_tags.md
│   ├── extract_entities.md
│   ├── boundary_detection.md
│   └── generate_section_title.md
├── ontology/
│   ├── SUMO.owl              # SUMO ontology source
│   └── sumo_index.json       # Flat index built by scripts/build-sumo-index.js
├── scripts/
│   ├── build-sumo-index.js   # Builds sumo_index.json from SUMO.owl
│   ├── db-init.js            # ArangoDB collection/index setup
│   ├── admin-queries.js      # Diagnostic AQL queries
│   ├── sync-cache.js         # LLM cache sync utility
│   ├── tune_weights.js       # REFEED RAG: reads feedback collection, suggests OHARA_*_WEIGHT adjustments (--apply writes to .env)
│   ├── backfill_embeddings.js  # Backfill text-embedding-004 vectors for paragraphs missing embedding field (--dry-run)
│   └── clean_noise_entities.js  # Removes opaque-identifier noise entities from existing data
├── tests/
│   └── ingest.test.js        # Node.js built-in test runner
├── doc_pipeline/             # Pipeline workspace (raw output, diagnostics)
├── wiki/                     # Quartz export output
├── index.html                # Dashboard UI (Alpine.js + SVG graph)
├── server.js                 # Express API server
└── .env.example              # Environment variable reference
```

---

## API Reference

All endpoints are served by `server.js`.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/graph` | Structural graph for selected docs (filtered by `?docKeys=k1,k2`) |
| `GET` | `/api/graph/node/:collection/:key/neighbors` | Lazy-load a node's neighbors |
| `GET` | `/api/documents` | Paginated document list (`?limit=50&offset=0`, max 200/page); returns `{documents, total, offset, limit, health}` where `health` aggregates total paragraphs, entities, partial-ingest count, needs-review count |
| `PATCH` | `/api/documents/:key` | Update temporal metadata (`decay_class`, `effective_decay_class`, `published_date`, `temporal_needs_review`) |
| `POST` | `/api/retrieval/query` | Run retrieval; `agent:true` → `queryAgent()`, `cor:true` → `queryCoR()`, else `query()`; accepts `sessionHistory`, `selfRagVerify`, `reasoningRag` |
| `POST` | `/api/retrieval/answer` | Retrieval + Gemini answer synthesis; returns `{answer, citations[], retrieval}`; supports same params as `/query` |
| `POST` | `/api/retrieval/feedback` | Store REFEED RAG feedback signal (`query_hash`, `node_id`, `result_rank`, `signal`) |
| `GET` | `/api/analytics` | Feedback accuracy by rank, top 10 positively-rated nodes, corpus totals (docs/paragraphs/entities/feedback); powers the Analytics sidebar tab |
| `GET` | `/api/retrieval/context/:nodeId` | Get context for a specific node |
| `POST` | `/api/pipeline/upload` | Upload a file for ingestion |
| `POST` | `/api/pipeline/run` | Trigger pipeline on uploaded files |
| `GET` | `/api/pipeline/status` | Poll pipeline logs and status |
| `GET` | `/api/pipeline/input-files` | List files in the ingest queue |
| `POST` | `/api/queue/ingest` | Enqueue a file via BullMQ |
| `GET` | `/api/queue/jobs` | List queued jobs and their status |
| `POST` | `/api/queue/jobs/:id/retry` | Retry a failed job |
| `DELETE` | `/api/queue/jobs/:id` | Remove a job |
| `GET` | `/api/database/state` | Raw DB state dump |
| `POST` | `/api/database/seed` | Reset to seed data |
| `POST` | `/api/database/clear` | Clear all data |
| `POST` | `/api/database/query` | Execute an AQL query |
| `POST` | `/api/quartz/export` | Trigger Quartz wiki export |
| `GET` | `/api/agent/system-prompt` | Retrieve agent system prompt |
