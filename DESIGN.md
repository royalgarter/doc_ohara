# Doc Ohara: System Design & Engineering Blueprint

This document serves as the master technical specification for **Doc Ohara**. It defines the Space-Time Graph schema, the multi-stage ingestion pipelines, LLM orchestration strategies, and the hybrid retrieval architecture.

---

## 1. System Architecture Overview

Doc Ohara transforms unstructured documents into a multi-dimensional knowledge web. The system is designed to be engine-agnostic, supporting both local extraction (MinerU/Docling) and cloud-native workflows (Gemini 1.5 Pro).

### 🛰️ The Space-Time Pipeline
1.  **Ingestion**: Routing raw files (PDF, DOCX, MD) to the appropriate parser.
2.  **Structural Decomposition**: AST-based or LLM-driven partitioning into OKF/DoCO nodes.
3.  **Semantic Enrichment**: Generating embeddings, tags, and contextual headers.
4.  **Relational Synthesis**: Building the graph (Hierarchy, Sequence, Citations).
5.  **Validation & Healing**: AI-powered audit to ensure graph integrity.
6.  **Persistence**: Transactional storage in ArangoDB.

---

## 2. Multi-Model Database Schema (OKF + DoCO)

We utilize ArangoDB to model the **Open Knowledge Format (OKF)** and **DoCO (Document Components Ontology)**. This provides engine-level validation for structural, temporal, and spatial metadata.

### 2.1 Schema Definition (`setup_okf_schema.js`)

```javascript
/**
 * Doc_Ohara: ArangoDB Multi-Model Schema Definition (OKF + DoCO)
 * Implements persistent indexing for tags, geo-spatial metadata, and bitemporal ranges.
 */
import { Database } from 'arangojs';

const db = new Database({
  url: "http://localhost:8529",
  databaseName: "doc_ohara_knowledge_base",
  auth: { username: "root", password: "password" }
});

// JSON Validation Schema for 'okf_nodes'
const nodeSchema = {
  rule: {
    type: "object",
    required: ["type", "doc_id", "temporal"],
    properties: {
      type: {
        type: "string",
        enum: ["Chapter", "Section", "Subsection", "Paragraph", "Table", "ListItem", "Figure", "Concept", "Tag", "AlphabetIndexItem"]
      },
      doc_id: { type: "string" },
      content: { type: "string" },
      spatial: {
        type: "object",
        properties: {
          layout_box: { type: "object" },
          geo_json: { type: "object" }
        }
      },
      temporal: {
        type: "object",
        required: ["extracted_at", "valid_from"],
        properties: {
          extracted_at: { type: "string", format: "date-time" },
          valid_from: { type: "string", format: "date-time" }
        }
      },
      tags: { type: "array", items: { type: "string" } },
      vector_embedding: { type: "array", items: { type: "number" } }
    }
  }
};

// JSON Validation Schema for 'okf_edges'
const edgeSchema = {
  rule: {
    type: "object",
    required: ["_from", "_to", "relation"],
    properties: {
      relation: {
        type: "string",
        enum: ["HAS_CHILD", "NEXT_SIBLING", "HAS_TAG", "INDEXED_UNDER", "REFERENCES", "SUCCEEDS"]
      },
      confidence: { type: "number", minimum: 0, maximum: 1 }
    }
  }
};

// (Index configuration and collection creation logic omitted for brevity)
```

---

## 3. Ingestion & Transformation Lifecycle

The ingestion process bridges the gap between raw binary formats and our graph schema.

### 3.1 The 5-Stage Transformation Flow

| Stage | Activity | Output |
| :--- | :--- | :--- |
| **1. Normalization** | Frontmatter parsing, line-break sanitization | Sanitized Body + Metadata |
| **2. Decomposition** | AST (remark-parse) or LLM Layout extraction | Hierarchy of Nodes |
| **3. Enrichment** | 1536-dim Vectorization + Semantic Tagging | Vector-ready Nodes |
| **4. Synthesis** | Generating `HAS_CHILD` and `NEXT_SIBLING` edges | Space-Time Graph |
| **5. Persistence** | Transactional ArangoDB Batch Insert | Persistent Graph Records |

---

## 4. Extraction Engines: Local vs. Cloud

### 4.1 Local Engine Orchestration (MinerU & Docling)
For high-volume on-premise processing, we utilize specialized layout engines routed via shell orchestration.

**`run_pipeline.sh`**:
```bash
# Routes PDF to MinerU (LaTeX/Academic focus)
# Routes DOCX/TXT to Docling (Business/Structural focus)
docker run --rm -v "$(pwd)/input:/in" opendatalab/mineru:latest magic-pdf -i "/in/$file"
```

**`transform.js`**:
Standardizes the disparate outputs of MinerU and Docling into the unified OKF/DoCO format using UUID-based relational mapping.

### 4.2 Cloud-Native Extraction (Gemini 1.5 Pro)
Leveraging Gemini's 2M context window for instant "Zero-GPU" extraction using Structured Outputs.

```javascript
// Gemini Response Schema mapping directly to DoCO
const docoResponseSchema = {
    type: Type.OBJECT,
    properties: {
        title: { type: Type.STRING },
        sections: { type: Type.ARRAY, items: { ... } },
        paragraphs: { type: Type.ARRAY, items: { ... } }
    }
};
```

---

## 5. LLM Orchestration & Prompt Engineering

The LLM acts as the **Semantic Orchestrator**, responsible for structural architecting and relationship inference.

### 5.1 The "Structural Decomposer" Prompt
> **System Prompt**: You are a Document Engineering Agent specializing in the DoCO standard. Decompose the input text into a JSON array of structural nodes (Chapter, Section, Paragraph, Table). Extract geographic references for `spatial.geo_json`.

### 5.2 The "Contextual Header" Technique
To solve the "lost in the middle" problem, we prepend structural metadata to paragraph content before vectorization:
*   **Original**: "We observed a 15% increase in throughput."
*   **Vector Content**: "In the context of Results for Method B Testing in the Throughput Optimization 2024 report: We observed a 15% increase in throughput."

---

## 6. Validation & Self-Healing (The AI Auditor)

Post-ingestion, the graph undergoes a "Refinery" process to ensure integrity.

1.  **Schema Audit**: Strict validation against `DESIGN.md` rules.
2.  **Structural Healing**: Identifying and repairing "Orphan Nodes" or broken `NEXT_SIBLING` chains.
3.  **Semantic De-duplication**: Merging redundant concepts extracted across different document sections.

**The "Narrative Continuity" Healer**:
> **System Prompt**: Analyze these three paragraphs. Determine their logical sequence and generate the `NEXT_SIBLING` edges to restore narrative flow.

---

## 7. Hybrid Retrieval Engine

Doc Ohara utilizes a **Two-Step Retrieval Engine** utilizing ArangoDB's hybrid query capabilities (ArangoSearch, Vector similarity, and Graph traversal).

### 7.1 Retrieval Architecture Overview

```
   [ User Input String ]
             │
             ▼
┌───────────────────────────────────────────┐
│     Phase 0: Input Parsing & Embedding    │
│  - Extract: Entities, Tags, Keywords     │
│  - Compute: Query Vector Embedding       │
└───────────────────────────────────────────┘
             │
             ▼
┌───────────────────────────────────────────┐
│        Phase 1: Shallow Context           │
│  - Hybrid Search (Vector + Text + Tag)    │
│  - Score calculation & Deduplication      │
│  - Expose expandable graph directions     │
└───────────────────────────────────────────┘
             │
             ▼  (User/Agent choice of direction)
┌───────────────────────────────────────────┐
│         Phase 2: Deep Context             │
│  - Target node-specific graph expansion   │
│  - High-depth traversals (Up/Down/Sibs)    │
│  - Geo-spatial bounding box filtering     │
└───────────────────────────────────────────┘
```

### 7.2 Phase 1: Shallow Context (Breadth Search)
Combines **ArangoSearch (BM25)**, **Vector Similarity (Cosine)**, and **Tag Overlap** to find seed nodes. It identifies "expandable directions" (parents, siblings, references).

**Docsray Optimization**: Use the P-TOC map to perform a coarse-grained search, drastically reducing query latency by narrowing the search space to relevant document "clusters" before fine-grained retrieval.

### 7.3 Phase 2: Deep Context (Depth Traversal)
Executes targeted AQL multi-hop traversals based on the user's intent:
*   **Structural Hierarchy**: Fetching headers and sibling details.
*   **Sequential Narrative**: Following the sibling chain to fetch preceding or succeeding paragraphs.
*   **Semantic Web**: Following citations and concept links across documents.
*   **Spatial Proximity**: Geo-spatial bounding box filtering.

### 7.4 Node.js Implementation: `RetrievalEngine.js`

```javascript
/**
 * Doc_Ohara: Hybrid Graph-Vector Retrieval Engine
 * File: retrieval_engine.js
 */

import { Database, aql } from 'arangojs';

// Initialize the connection to the established OKF collection database
const db = new Database({
  url: "http://localhost:8529",
  databaseName: "doc_ohara_knowledge_base",
  auth: { username: "root", password: "password" }
});

export class RetrievalEngine {
  constructor(llmClient) {
    this.llm = llmClient; // Placeholder for an LLM client (e.g., OpenAI, Anthropic, or local model)
  }

  /**
   * Phase 0: Preprocessing and Semantic Expansion
   */
  async preprocessInput(rawInput) {
    // 1. Generate text embedding vector
    const vectorEmbedding = await this.llm.embeddings.create({
      model: "text-embedding-3-small", 
      input: rawInput,
    });

    // 2. Perform entity, tag, and keyword extraction
    const extraction = await this.llm.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `Deconstruct the input query into structured components...`
        },
        { role: "user", content: rawInput }
      ]
    });

    const parsedExtraction = JSON.parse(extraction.choices[0].message.content);

    return {
      vector: vectorEmbedding.data[0].embedding,
      tags: parsedExtraction.tags || [],
      keywords: parsedExtraction.keywords || [],
      entities: parsedExtraction.entities || []
    };
  }

  /**
   * Phase 1: Shallow Context Retrieval
   */
  async getShallowContext(processedQuery, options = {}) {
    const limit = options.limit || 5;
    const threshold = options.threshold || 0.35;
    
    const query = aql`
      FOR doc IN okf_search_view
        SEARCH 
          ANALYZER(doc.content IN TOKENS(${processedQuery.keywords.join(" ")}, "text_en"), "text_en")
          OR doc.tags ANY IN ${processedQuery.tags}
          OR doc.title IN TOKENS(${processedQuery.entities.join(" ")}, "text_en")

        LET vectorScore = COSINE_SIMILARITY(doc.vector_embedding, ${processedQuery.vector})
        LET textScore = BM25(doc)
        LET tagScore = LENGTH(INTERSECTION(doc.tags, ${processedQuery.tags}))
        LET compositeScore = (vectorScore * 0.5) + (textScore * 0.3) + (tagScore * 0.2)
        
        FILTER compositeScore >= ${threshold}
        SORT compositeScore DESC
        LIMIT ${limit * 2}

        LET directions = (
          FOR v, e IN 1..1 ANY doc._id okf_edges
            RETURN { relation: e.relation, target_id: v._id, target_type: v.type, target_title: v.title }
        )

        LET expandable_directions = {
          has_parent: FIRST(FOR d IN directions FILTER d.relation == "HAS_CHILD" RETURN d.target_id),
          next_sibling: FIRST(FOR d IN directions FILTER d.relation == "NEXT_SIBLING" RETURN d.target_id),
          tags: (FOR d IN directions FILTER d.relation == "HAS_TAG" RETURN d.target_title),
          semantic_references: (FOR d IN directions FILTER d.relation == "REFERENCES" RETURN { id: d.target_id, title: d.target_title }),
          temporal_updates: (FOR d IN directions FILTER d.relation == "SUCCEEDS" RETURN d.target_id)
        }

        RETURN {
          node: { id: doc._id, type: doc.type, title: doc.title, content: doc.content, doc_id: doc.doc_id, tags: doc.tags, spatial: doc.spatial, temporal: doc.temporal },
          relevance_score: compositeScore,
          expandable_directions: expandable_directions
        }
    `;

    const cursor = await db.query(query);
    const results = await cursor.all();
    return results; // Deduplication logic omitted here for brevity
  }

  /**
   * Phase 2: Deep Context Retrieval
   */
  async getDeepContext(startNodeId, direction, options = {}) {
    const depth = options.depth || 2;
    let query;

    switch (direction) {
      case 'structural_hierarchy':
        query = aql`
          FOR v, e, p IN 1..${depth} ANY ${startNodeId} okf_edges
            FILTER e.relation == "HAS_CHILD"
            RETURN { node: { id: v._id, type: v.type, title: v.title, content: v.content }, edge: e.relation, depth: LENGTH(p.edges) }
        `;
        break;
      // Sequential, Semantic, and Spatial traversal cases (see retrieval_engine.js for full implementation)
    }

    const cursor = await db.query(query);
    return await cursor.all();
  }
}
```

### 7.5 Execution Example: Multi-Hop Retrieval

```javascript
// Example Usage Execution Block
async function runDemo() {
  const userInput = "Show me quantum superposition and how it connects to qubits in Dr. Jenkins' lab.";
  const processedQuery = await engine.preprocessInput(userInput);
  const shallowResults = await engine.getShallowContext(processedQuery, { limit: 3 });
  
  if (shallowResults.length > 0) {
    const targetNodeId = shallowResults[0].node.id;
    const deepResults = await engine.getDeepContext(targetNodeId, 'semantic_web', { depth: 2 });
    console.dir(deepResults, { depth: null });
  }
}
```

---

## 8. AQL Example: Multi-Hop Traversal
```aql
// Find sibling paragraphs of a section containing "Quantum"
FOR start IN okf_nodes
  FILTER start.type == "Section" AND CONTAINS(start.title, "Quantum")
  FOR v, e IN 1..2 OUTBOUND start okf_edges
    FILTER e.relation == "NEXT_SIBLING"
    RETURN v.content
```
Spatial Proximity**: Geo-spatial bounding box filtering.

**Example AQL Traversal**:
```aql
FOR start IN okf_nodes
  FILTER start.type == "Section" AND CONTAINS(start.title, "Quantum")
  FOR v, e IN 1..2 OUTBOUND start okf_edges
    FILTER e.relation == "NEXT_SIBLING"
    RETURN v.content
```
BOUND start okf_edges
    FILTER e.relation == "NEXT_SIBLING"
    RETURN v.content
```
to perform a coarse-grained search, drastically reducing query latency by narrowing the search space to relevant document "clusters" before fine-grained retrieval.

### Phase 2: Deep Context (Depth Traversal)
Executes targeted AQL multi-hop traversals based on the user's intent:
*   **Structural Hierarchy**: Fetching headers and sibling details.
*   **Semantic Web**: Following citations and concept links across documents.
*   **Spatial Proximity**: Geo-spatial bounding box filtering.

**Example AQL Traversal**:
```aql
FOR start IN okf_nodes
  FILTER start.type == "Section" AND CONTAINS(start.title, "Quantum")
  FOR v, e IN 1..2 OUTBOUND start okf_edges
    FILTER e.relation == "NEXT_SIBLING"
    RETURN v.content
```
Spatial Proximity**: Geo-spatial bounding box filtering.

**Example AQL Traversal**:
```aql
FOR start IN okf_nodes
  FILTER start.type == "Section" AND CONTAINS(start.title, "Quantum")
  FOR v, e IN 1..2 OUTBOUND start okf_edges
    FILTER e.relation == "NEXT_SIBLING"
    RETURN v.content
```
BOUND start okf_edges
    FILTER e.relation == "NEXT_SIBLING"
    RETURN v.content
```
