# Ingestion Pipeline: Markdown to Space-Time Graph

This document details the transformation lifecycle for converting unstructured Markdown into structured, multi-model records compliant with the **Open Knowledge Format (OKF)** and **DoCO** standards used in Doc Ohara.

---

## 🛰️ Pipeline Architecture Overview

The pipeline operates in 5 discrete stages:

1.  **Ingestion & Normalization**: Cleaning raw MD and extracting document-level metadata.
2.  **Structural Decomposition**: AST-based parsing into a hierarchical node tree.
3.  **Semantic Enrichment**: Vectorization, tagging, and entity extraction.
4.  **Relational Synthesis**: Generating graph edges (`HAS_CHILD`, `NEXT_SIBLING`).
5.  **Multi-Model Persistence**: Transactional commit to ArangoDB.

---

## 🛠️ Stage-by-Stage Breakdown

### 1. Ingestion & Normalization
- **Input**: Raw `.md` string or file.
- **Process**: 
  - Parse YAML frontmatter for document metadata (Title, Author, License).
  - Normalize line breaks and sanitize hidden control characters.
- **Output**: `doc_metadata` + `sanitized_md_body`.

### 2. Structural Decomposition (AST Transformation)
Uses a Markdown AST parser (e.g., `remark-parse`) to identify the document's backbone.
- **Logic**:
  - `Heading (depth 1)` → `okf_node (type: Chapter)`
  - `Heading (depth 2)` → `okf_node (type: Section)`
  - `Paragraph` → `okf_node (type: Paragraph)`
  - `Table` → `okf_node (type: Table)`
- **Spatial Tracking**: Calculate `layout_box` if page markers exist, or assign logical sequence indices.

### 3. Semantic Enrichment
Every node extracted in Stage 2 is enhanced:
- **Vectorization**: Generate 1536-dim embeddings for the `content` field.
- **Tagging**: LLM-based extraction of "Concepts" and "Tags".
- **Temporal Check**: Assign `extracted_at` and `valid_from` timestamps.

### 4. Relational Synthesis (Edge Generation)
The critical step that builds the "Space-Time Graph".
- **HAS_CHILD**: Connects `Chapter` → `Section` → `Paragraph`.
- **NEXT_SIBLING**: Connects `Paragraph[N]` → `Paragraph[N+1]` to preserve narrative flow.
- **REFERENCES**: Pattern match `[Link Text](id)` or `[[WikiLinks]]` to create semantic edges across the graph.

### 5. Multi-Model Persistence
Batch inserts nodes and edges to ensure referential integrity.
- **Store**: `okf_documents` (1 record), `okf_nodes` (N records), `okf_edges` (M records).
- **Index Refresh**: ArangoDB automatically updates the `tags[*]` and `geo_json` indexes for immediate retrieval.

---

## 🧬 Data Schema Example (Internal Representation)

### Node Entry (Paragraph)
```json
{
  "_key": "para_001",
  "type": "Paragraph",
  "content": "Quantum superposition allows particles to exist in multiple states...",
  "tags": ["quantum", "physics"],
  "vector_embedding": [0.12, -0.05, ...],
  "temporal": { "extracted_at": "2026-06-15T..." }
}
```

### Edge Entry (Sequential Flow)
```json
{
  "_from": "okf_nodes/para_001",
  "_to": "okf_nodes/para_002",
  "relation": "NEXT_SIBLING",
  "confidence": 1.0
}
```

---

## 🚀 Implementation Strategy

| Component | Tech Stack |
| :--- | :--- |
| **AST Parser** | `unified` / `remark-parse` |
| **Metadata** | `gray-matter` |
| **Embeddings** | OpenAI `text-embedding-3-small` / Local HuggingFace |
| **DB Client** | `arangojs` |
| **Orchestrator** | Node.js (Stream-based for large docs) |

---

## 🛡️ Quality Gates
1.  **Schema Validation**: Every node must pass the JSON Schema defined in `DESIGN.md`.
2.  **Graph Connectivity**: Post-insertion check ensuring every paragraph has at least one structural parent or sibling.
3.  **Vector Density**: Validation that embeddings are non-null and correctly dimensioned.
