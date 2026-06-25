# Doc Ohara: Space-Time Graph for Advanced Context Retrieval

Doc Ohara is a document transformation and retrieval engine that converts unstructured documents into a multi-dimensional **Space-Time Graph** stored in ArangoDB. It solves the "lost in the middle" problem of traditional flat-chunk RAG by navigating a structured graph instead of scanning a flat list.

> **TL;DR**: Doc Ohara parses documents into a hierarchy of sections and paragraphs, enriches each node with SUMO ontology tags and named entities, links shared concepts across documents, and retrieves context through a three-phase hybrid engine.

---

## Architecture Overview

```
PDF / EPUB / MD
      │
      ▼  LiteParse / Gemini
  Markdown chunks
      │
      ▼  Gemini (gemini-2.5-flash-lite)
  Structured nodes (DoCO schema)
      │
      ├─ SUMO tag validation    src/sumo.js
      ├─ Entity extraction      src/entities.js
      └─ Graph persistence      src/db/client.js
             │
             ▼
        ArangoDB
        ┌──────────────────────────────────────────────────┐
        │  documents  sections  paragraphs  tables  entities│
        │              edges (HAS_CHILD, MENTIONS, ...)     │
        └──────────────────────────────────────────────────┘
             │
             ▼  src/retrieval.js
  Five-phase retrieval (BM25 → SUMO → cross-doc edge → entity-pivot → structural)
             │
             ▼  src/exporter.js
  Quartz / Wiki.js export
```

---

## The Space-Time Graph

### Collections

| Collection | Contents |
|---|---|
| `documents` | Metadata root: source file, parser, title, upload time, entity_slugs, sumo_tags |
| `sections` | Structural hierarchy: chapter, section, subsection with level and title |
| `paragraphs` | Content nodes: body text, figures, list items with sumo_tags, entity_slugs |
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

### Stages (`src/ingest/pipeline.js`)

1. **Preflight** — validates `GEMINI_API_KEY`, `ARANGO_URL`, and the `lit` CLI (LiteParse).
2. **Dedup** — SHA-256 hashes the file; skips if already ingested (override with `--force`).
3. **Parsing** — LiteParse converts PDF/EPUB/DOCX to Markdown; plain `.md` files pass through directly.
4. **LLM structuring** — Gemini (`gemini-2.5-flash-lite`, Flex Inference) maps Markdown chunks to DoCO nodes (`Chapter`, `Section`, `Paragraph`, `Table`, `Figure`, `Authors`, `Bibliography`, …). Responses are cached by content hash. Parallel batches (default 4, `OHARA_INGEST_CONCURRENCY`).
5. **SUMO tag validation** — resolves `sumo_candidate_tags` against the SUMO ontology index (22,700 entries). Three-stage resolution: exact match → case/separator-insensitive → alias table. Duplicates collapsed. Invalid tags logged and dropped.
6. **Entity extraction** — validates `candidate_entities` from the LLM. Supported types: `PERSON`, `ORG`, `LOCATION`, `DATE`, `TECH`, `AMOUNT`, `EVENT`, `CONCEPT`. Canonical deduplication within each node.
7. **Collection transform** — normalizes nodes into `documents`, `sections`, `paragraphs`, `tables`. Artifact filter removes separator lines, TOC noise, and very short nodes. Fragment reattachment merges orphaned short paragraphs.
8. **Persistence** — inserts into ArangoDB with `HAS_CHILD`, `NEXT_SIBLING`, `BELONGS_TO` structural edges; upserts entity nodes and inserts `MENTIONS` / `RELATED_TO` edges.
9. **Document rollup** — after all paragraphs are inserted, unions `entity_slugs` and `sumo_tags` onto the `documents` record for O(docs) pre-filtering.
10. **Cross-document similarity** — computes Jaccard similarity between the new document's entity set and all existing documents. Creates `SIMILAR_TO` edges where similarity ≥ `OHARA_SIMILARITY_THRESHOLD` (default 0.1).
11. **Cross-document edge enrichment** — for each new `SIMILAR_TO` edge, calls Gemini (Flex Inference, cached) with representative snippets from both documents to generate a `verb` (e.g. `"extends the argument of"`), `tags` (1–4 SUMO-style concept tags), and `summary` (≤ 60 words). Result is stored on the edge for use at retrieval time. Prompt: `prompts/enrich_cross_doc_edge.md`.

### Prompt Schema (`prompts/ingest_document.md`)

The Gemini prompt instructs the model to output `{ nodes: [...] }` where each node carries:

```
type              # DoCO type (Chapter, Section, Paragraph, Table, Figure, …)
part              # front_matter | body_matter | back_matter
metadata          # { page, level }
sumo_candidate_tags   # short SUMO local names e.g. ["Agent", "Transaction"]
candidate_entities    # [{ name, canonical, type, aliases? }]
content / title / table / figure / agents_group / references   # type-specific fields
```

---

## Retrieval Engine (`src/retrieval.js`)

Four sequential phases via `RetrievalEngine.query(rawInput, options)`:

### Phase 0 — Input Parsing
Tokenizes raw input: lowercase, `[a-z0-9]+` regex, strips stopwords, drops tokens ≤ 2 chars. Returns `{ keywords, raw }`.

### Phase 1 — Shallow Context
ArangoSearch BM25 full-text search over `content`, `title`, and `markdown_representation`. Returns top N results (default 20). Falls back to term-overlap scoring when the ArangoSearch view is unavailable.

### Phase 1b — SUMO Tag Expansion
Finds paragraphs whose `sumo_tags` overlap with the query's SUMO hints or the top BM25 results' tags. Scored by overlap ratio.

### Phase 1c — Cross-Document Edge Expansion
Follows `SIMILAR_TO` edges from the seed documents (top 5 BM25 hits) to retrieve related paragraphs from other documents. Edges are filtered by `weight > 0.3` or overlapping `edge.tags`. Each result carries `edge_verb` and `edge_summary` from the ingest-time LLM enrichment, indicating *why* the document was pulled in (e.g. `"extends the argument of"`). Runs in parallel with Phase 3. Controlled by `OHARA_CROSS_DOC_WEIGHT` (default 0.4) and `OHARA_CROSS_DOC_LIMIT` (default 5).

### Phase 2 (formerly 1b) — Entity Pivot
From the top seed paragraphs' `entity_slugs`, finds other paragraphs across all documents that share those entities. Scores with a damped weight (`OHARA_ENTITY_PIVOT_WEIGHT`, default 0.6). Runs in parallel with Phase 1c.

### Phase 3 — Structural Traversal
AQL graph traversal outbound from the top-scored node via `HAS_CHILD`, `NEXT_SIBLING`, `BELONGS_TO` edge types. Depth defaults to 2.

### Phase 4 — Score Fusion
All phase results are merged by node `_id`. Scores are weighted and summed; results sorted descending. Cross-doc results propagate `edge_verb`/`edge_summary` to the fused entry.

Returns `{ processedQuery, results, shallowResults, entityPivotResults, crossDocResults, deepResults }`.

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
- **Mentioned in** — every paragraph that mentions the entity with document/section context
- **Related Entities** — entities co-occurring in the same paragraphs

---

## Configuration

All tunables are set via environment variables. Copy `.env.example` to `.env`:

| Variable | Default | Purpose |
|---|---|---|
| `GEMINI_API_KEY` | — | Required. Google Gemini API key |
| `ARANGO_URL` | — | ArangoDB connection URL (may include credentials and DB name) |
| `ARANGO_USER` | — | DB username (can also embed in URL) |
| `ARANGO_PASSWORD` | — | DB password |
| `LITEPARSE_CLI_PATH` | — | Path to the `lit` LiteParse CLI binary |
| `PORT` | `3000` | HTTP server port |
| `OHARA_INGEST_CONCURRENCY` | `4` | Parallel LLM chunk requests during ingest |
| `OHARA_LLM_CACHE_DIR` | — | Directory for LLM response cache |
| `OHARA_SIMILARITY_THRESHOLD` | `0.1` | Min Jaccard score to create a `SIMILAR_TO` doc–doc edge |
| `OHARA_ENTITY_PIVOT_LIMIT` | `5` | Max cross-document paragraphs from entity-pivot phase |
| `OHARA_ENTITY_PIVOT_WEIGHT` | `0.6` | Score multiplier for entity-pivot results |
| `OHARA_CROSS_DOC_WEIGHT` | `0.4` | Score multiplier for cross-document edge expansion results |
| `OHARA_CROSS_DOC_LIMIT` | `5` | Max paragraphs returned per cross-document edge expansion |

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
# Via dashboard UI — drag and drop in the Ingest tab
# Via CLI:
npm run ohara:ingest                          # ingest sample PDF
node bin/ohara.js ingest path/to/file.pdf    # ingest any file
node bin/ohara.js ingest path/to/file.pdf --force  # re-ingest even if already processed
```

### 5. Query
```bash
npm run ohara:query                                         # sample query
node bin/ohara.js query "proof of work consensus"          # custom query
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
│       ├── pipeline.js       # Core ingestion pipeline
│       ├── worker.js         # BullMQ worker
│       ├── queue.js          # Job queue management
│       ├── chunker.js        # Markdown chunker
│       └── entity_dedup.js   # Cross-document entity merge worker
├── prompts/
│   ├── ingest_document.md        # Main LLM prompt (DoCO structuring + entities + SUMO)
│   ├── enrich_cross_doc_edge.md  # LLM prompt for SIMILAR_TO edge verb/tags/summary
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
│   └── sync-cache.js         # LLM cache sync utility
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
| `GET` | `/api/graph` | Full graph state (documents, sections, paragraphs, tables, edges) |
| `GET` | `/api/graph/node/:collection/:key/neighbors` | Lazy-load a node's neighbors |
| `POST` | `/api/retrieval/query` | Run the retrieval engine |
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
