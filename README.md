# Doc Ohara: Space-Time Graph for Advanced Context Retrieval 🌌

Doc Ohara is a high-efficiency document transformation and retrieval engine. It converts unstructured documents into a multi-dimensional **Space-Time Graph** to solve the "lost in the middle" and context-window limitations of traditional RAG.

> **TL;DR**: Doc Ohara doesn't just "chunk" text; it mimics how humans read (scanning & referencing). It builds a hierarchical **Pseudo-TOC** to enable sub-second retrieval from millions of tokens by navigating a structured graph instead of scanning flat lists.

---

## 🎯 Mission
Standard RAG relies on flat vector similarity which loses structural intent. Doc Ohara implements the **Open Knowledge Format (OKF)** to treat documents as living graphs. 

**Our Philosophy: Human-Centric Retrieval**
Humans read using the "Layer Cake" and "F-Pattern"—scanning headings and jumping to references rather than reading cover-to-cover. Doc Ohara's architecture is built to mirror this:
- **Scanning**: Our **Pseudo-TOC** provides the "headings" for AI to scan.
- **Referencing**: Graph edges allow targeted "Ctrl+F" style jumps between concepts.
- **Priming**: Sequential traversals provide the context needed to "prime" the LLM for accurate answers.

**The Intelligent Archivist**
Doc Ohara evolves beyond traditional RAG and static wikis by acting as an **Intelligent Archivist**. It doesn't just store information; it dynamically refines it:
- **Thematic Clustering**: Uses ArangoDB's graph algorithms to discover cross-document themes.
- **Incremental Growth**: Never re-processes what it already knows.
- **Trust via Audit**: Flags its own low-confidence extractions for human review, ensuring the knowledge base remains a "Source of Truth."


---

## 🏗️ Core Architecture: The Space-Time Graph

Doc Ohara transforms unstructured documents into a multi-dimensional knowledge web. The system is designed to be engine-agnostic, supporting both local extraction (MinerU/Docling) and cloud-native workflows (Gemini 1.5 Pro).

Powered by **ArangoDB Multi-Model**, the system tracks:
- **Structural Flow**: Parent-child (Chapters → Sections → Paragraphs) and sequential siblings.
- **Semantic Web**: Entities, concepts, and cross-document citations.
- **Bi-Temporal Versioning**: Tracking when information was valid vs. when it was extracted.
- **Geo-Spatial Metadata**: Mapping document content to physical coordinates or layout boxes.

### 🛰️ The Space-Time Pipeline
Doc Ohara's pipeline is designed for **incremental growth** and **deterministic accuracy**, bridging the gap between automated libraries and high-fidelity cartography.

1.  **Smart Ingestion**: Uses SHA256 hashing to detect changes. Only modified pages are re-processed, drastically reducing token costs.
2.  **Structural Decomposition (DocsRay)**: LLM-driven **Pseudo-TOC Generation** for semantic partitioning.
3.  **Semantic Enrichment**: Generating multi-vector embeddings, semantic tags, and entity discovery.
4.  **Relational Synthesis**: Building the graph with strict outbound directionality and temporal metadata.
5.  **The Refinery (Refinement)**: Automatic thematic clustering (Louvain) and cross-document "surprising connection" discovery.
6.  **Persistence**: ACID transactions in ArangoDB with integrated **Confidence Scoring**.
7.  **Human-in-the-Loop Audit**: AI-flagged low-confidence nodes/edges are queued for expert verification.

#### 📍 Pseudo-TOC (DocsRay Implementation)
Doc Ohara integrates the **DocsRay** algorithm to transform unstructured text into semantically coherent hierarchies:
- **Phase 1: Boundary Detection**: LLM analyzes text junctions to identify topic shifts.
- **Phase 2: Adaptive Merging**: Small segments are merged based on embedding similarity to maintain a minimum section size.
- **Phase 3: Automatic Titling**: LLM generates concise, descriptive titles for the resulting sections.

This approach reduces retrieval complexity from $O(N)$ to $O(S + k_1 \cdot N_s)$, improving speed by up to 45%.

### Schema (OKF + DoCO)
We utilize ArangoDB to model the **Open Knowledge Format (OKF)** and **DoCO (Document Components Ontology)**.

- `okf_documents`: Metadata root for document ownership and licensing.
- `okf_nodes`: Vertices containing content, layout coordinates, vector embeddings, and `content_hash`.
- `okf_edges`: Strongly typed relations (`HAS_CHILD`, `NEXT_SIBLING`, `HAS_TAG`, `INDEXED_UNDER`, `REFERENCES`, `SUCCEEDS`).
  - `confidence`: Reliability score (0-1).
  - `requires_review`: Flag for human-in-the-loop audit.
  - **Strict Outbound Directionality**: Ensures deterministic graph traversals.

#### Schema Definition (`setup_okf_schema.js`)
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

### 3.1 The 7-Stage Transformation Flow

| Stage | Activity | Output |
| :--- | :--- | :--- |
| **1. Smart Ingestion** | SHA256 hashing & Change Detection | Modified Content Only |
| **2. Normalization** | Frontmatter parsing, line-break sanitization | Sanitized Body + Metadata |
| **3. Decomposition** | DocsRay Pseudo-TOC partitioning | Hierarchy of Nodes |
| **4. Enrichment** | Multi-Vector Indexing + Semantic Tagging | Vector-ready Nodes |
| **5. The Refinery** | Louvain Clustering & Link Discovery | Thematic Hubs |
| **6. Synthesis** | Relational edge generation (ACID) | Space-Time Graph |
| **7. Persistence** | Atomic Insert with Confidence Scoring | Persistent Audit Records |

---

## 4. Extraction Engines: Local vs. Cloud

### 4.1 Robust Orchestration
For high-volume processing, we replace brittle shell scripts with a distributed task queue (e.g., **BullMQ** or **Temporal**). This provides retries, timeout handling for OOM errors, and proper state tracking.

**Worker Definition**:
```javascript
// Example worker orchestration
const worker = new Worker('ingestion_queue', async job => {
  const { filePath, docId } = job.data;
  // 1. Route to MinerU/Docling parser
  // 2. Deterministic OKF/DoCO mapping
  // 3. Multi-Vector Enrichment
  // 4. Atomic Graph Persistence
});
```

**`transform.js`**:
Standardizes the disparate outputs of MinerU and Docling into the unified OKF/DoCO format using deterministic relational mapping.

### 4.2 Cloud-Native Extraction (Gemini Flash Lite)
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

The LLM acts as the **Semantic Orchestrator**, responsible for structural architecting and relationship inference. All system instructions are managed in the `prompts/` directory for deterministic versioning.

### 5.1 Prompt Library
| Prompt | Purpose |
| :--- | :--- |
| `ingest_document.md` | Structural decomposition into Chapter, Section, Paragraph nodes. |
| `extract_toc.md` | Mapping the document's hierarchical skeleton (P-TOC). |
| `extract_tags.md` | Generating semantic tags for Phase 0 expansion. |
| `extract_entities.md` | Named Entity Recognition (NER) for the Semantic Web layer. |
| `boundary_detection.md` | Identifying topic shifts in the DocsRay pipeline. |
| `generate_section_title.md` | Extracting concise titles for pseudo-TOC sections. |

### 5.2 The "Multi-Vector" Context Strategy
Standard "Contextual Headers" (prepending metadata to text) can dilute vector density. We recommend **Multi-Vector Indexing**:
*   **Primary Vector**: The pure paragraph content.
*   **Secondary Vector**: The parent section's summary or structural context.
*   **Graph Context**: Fetching parent/sibling metadata *after* retrieval via AQL to provide context without inflating token usage during vectorization.

*Legacy Contextual Header Example*: "In the context of Results for Method B Testing... [Paragraph Content]" (Caution: Use sparingly to avoid noise).

---

## 6. Deterministic Integrity & Transactional Guarantees

Instead of relying on LLMs to "heal" broken graphs, Doc Ohara enforces structural integrity at the point of ingestion.

1.  **Schema Enforcement**: Strict validation against `DESIGN.md` rules using ArangoDB JSON Schema.
2.  **ACID Transactions**: Every document is inserted as a single transaction. If one edge fails, the entire document rolls back, preventing orphaned nodes.
3.  **Semantic De-duplication**: Use deterministic hashing and entity matching to merge redundant concepts across sections.

**Automated Integrity Check**:
```javascript
// Ensure strict sequence continuity
const result = await db.query(aql`
  FOR n IN okf_nodes
    FILTER n.type == "Paragraph"
    LET sib = FIRST(FOR v, e IN 1..1 OUTBOUND n okf_edges FILTER e.relation == "NEXT_SIBLING" RETURN v)
    FILTER sib == null AND n.has_next == true // Flagged for manual review
    RETURN n._id
`);
```

---

## ⚡ Two-Step Retrieval Engine

Doc Ohara bypasses flat search bottlenecks with a bifurcated retrieval strategy.

### 7.1 Retrieval Architecture Overview

```
   [ User Input String ]
             │
             ▼
┌───────────────────────────────────────────┐
│     Phase 0: Input Parsing & Expansion    │
│  - Local NLP: sub-50ms NER & Keywords    │
│  - Tag Expansion: Map query to system tags│
│  - Compute: Query Vector Embedding       │
└───────────────────────────────────────────┘
             │
             ▼
┌───────────────────────────────────────────┐
│        Phase 1: Shallow Context           │
│  - ArangoSearch: BM25 + Exact Tag Match  │
│  - Native ANN: Fast Vector Search        │
│  - Hybrid: Dynamic Scoring (Vector+Text) │
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
Combines **ArangoSearch (BM25)** and **Native Vector Search**. We avoid `CONTAINS` and `FILTER` for text, instead routing all text queries through ArangoSearch Views for performance.

**Tag Expansion Strategy**:
Instead of fuzzy vector search on tags, we use Phase 0 to map the user query to exact system tags (e.g., "Healthcare" -> `["Medical", "Compliance"]`) and then perform high-speed exact matching in AQL.

### 7.3 Phase 2: Deep Context (Depth Traversal)
Executes targeted AQL multi-hop traversals. Strict outbound directionality ensures sequential walking (e.g., `NEXT_SIBLING` chain) is deterministic and fast.

### 7.4 Node.js Implementation: `RetrievalEngine.js`

```javascript
/**
 * Doc_Ohara: Optimized Hybrid Retrieval Engine
 */

export class RetrievalEngine {
  /**
   * Phase 0: Preprocessing with Local NLP
   */
  async preprocessInput(rawInput) {
    // 1. Local NER & Keyword extraction (e.g., via spaCy/ONNX)
    const extraction = await localNlp.parse(rawInput); // < 50ms

    // 2. Semantic Tag Expansion (Healthcare -> Medical)
    const expandedTags = await tagTaxonomy.expand(extraction.tags);

    return {
      vector: await computeEmbedding(rawInput),
      tags: expandedTags,
      keywords: extraction.keywords
    };
  }

  /**
   * Phase 1: Shallow Context using ArangoSearch
   */
  async getShallowContext(processedQuery, options = {}) {
    const query = aql`
      FOR doc IN okf_search_view
        SEARCH 
          ANALYZER(doc.content IN TOKENS(${processedQuery.keywords.join(" ")}, "text_en"), "text_en")
          OR doc.tags ANY IN ${processedQuery.tags}

        // Native Vector Search (ANN)
        LET vectorScore = COSINE_SIMILARITY(doc.vector_embedding, ${processedQuery.vector})
        LET textScore = BM25(doc)
        
        // Dynamic weight adjustment
        LET compositeScore = (vectorScore * 0.6) + (textScore * 0.4)
        
        SORT compositeScore DESC
        LIMIT 10
        RETURN doc
    `;
    // ... execution logic
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

## 🛠️ Interactive Playground & Simulation

This repository includes a Node.js-native playground to test these concepts:
- **Double-Engine Extraction**: Simulated **MinerU** (academic/LaTeX) and **Docling** (business/docx) pipelines.
- **ArangoDB Simulator**: Disk-buffered in-memory graph instance with **AQL (ArangoDB Query Language)** support.
- **Gemini Integration**: Live partitioning of docs via `@google/genai`.
- **Visualization**: Live graph dashboard for real-time traversal monitoring.

---

## 🏛️ Wiki & Encyclopedia Interface

Doc Ohara supports exporting its entire Space-Time Graph into a **Quartz-compatible Digital Garden**. This allows you to browse your document knowledge base as an interconnected Wiki.

### 📤 Exporting to Quartz
You can generate the Markdown wiki by running:
```bash
npm run export-wiki
```
This will create a `./wiki` folder with:
- `index.md`: Home page with all document links.
- `documents/`: Organized folders per document containing sections as individual pages.
- **Wikilinks**: Automated `[[link]]` connections between related sections and documents.

To view the wiki, you can point a [Quartz](https://quartz.jzhao.xyz/) installation to the `./wiki` directory or use any Markdown bower like **Obsidian**.

---

## 🚀 Getting Started

### 1. Installation
```bash
npm install
```

### 2. Configure Environment
Create a `.env` file:
```env
GEMINI_API_KEY=your_key_here
```

### 3. Quick Start: Ingest & Retrieve
Professional readers often start with code. Here is how you use Doc Ohara in **3 lines**:

```javascript
import { DocOhara } from './src/pipeline_runner.js';

const ohara = new DocOhara();
await ohara.ingest('path/to/my_dense_doc.pdf'); // Ingests into Space-Time Graph
const results = await ohara.query('Find quantum gravity metrics'); // Hierarchical search
```

### 4. Run the Dashboard
Access the visualization tool at **http://localhost:3000**.
```bash
npm run dev
```

---

## 📁 Repository Structure

```text
├── src/
│   ├── arangodb_sim.js         # Multi-model Graph + AQL Interpreter
│   ├── pipeline_runner.js      # Extraction engine logic
│   └── pseudo_toc_generator.js # DocsRay Pseudo-TOC implementation
├── prompts/                    # LLM System Instructions
│   ├── ingest_document.md      # Structural decomposition
│   ├── extract_toc.md          # TOC skeleton extraction
│   ├── extract_tags.md         # Semantic tagging
│   ├── extract_entities.md     # Relationship discovery
│   ├── boundary_detection.md   # Topic boundary analysis
│   └── generate_section_title.md # TOC-ready title generation
├── doc_pipeline/               # Pipeline workspace & state
└── index.html                  # Dashboard UI
```

---

## 📚 Reference & API

For targeted technical details, refer to the following core components:

- **Graph Schema**: See `setup_okf_schema.js` in the Codebase for ArangoDB collection and index definitions.
- **Pseudo-TOC Logic**: See `src/pseudo_toc_generator.js` for the implementation of the DocsRay boundary detection and merging algorithm.
- **Retrieval Engine**: See `RetrievalEngine.js` (logic described in Section 7) for hybrid search and multi-hop traversal implementation.
- **Prompt Library**: Explore the `prompts/` directory for all LLM system instructions.

---

## ⚡ AQL Example: Optimized Multi-Hop Retrieval
```aql
// Find sibling paragraphs of a section containing "Quantum"
// Optimized using ArangoSearch and graph traversal
FOR start IN okf_search_view
  SEARCH ANALYZER(start.title IN TOKENS("Quantum", "text_en"), "text_en")
  FILTER start.type == "Section"
  FOR v, e IN 1..2 OUTBOUND start okf_edges
    FILTER e.relation == "NEXT_SIBLING"
    RETURN v.content
```
