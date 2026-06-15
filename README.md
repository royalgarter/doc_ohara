# Doc Ohara: Space-Time Graph for Advanced Context Retrieval 🌌

**Doc Ohara** is a high-efficiency document transformation and retrieval engine. It converts unstructured documents into a multi-dimensional **Space-Time Graph** to solve the "lost in the middle" and context-window limitations of traditional RAG (Retrieval-Augmented Generation).

---

## 🎯 Mission
Standard RAG relies on flat vector similarity which loses structural intent and chronological context. Doc Ohara implements the **Open Knowledge Format (OKF)** and **DoCO (Document Components Ontology)** to treat documents as living graphs where every paragraph, section, and entity is a vertex connected by semantic, structural, and temporal edges.

---

## 🏗️ Core Architecture: The Space-Time Graph

Powered by **ArangoDB Multi-Model**, the system tracks:
- **Structural Flow**: Parent-child (Chapters → Sections → Paragraphs) and sequential siblings.
- **Semantic Web**: Entities, concepts, and cross-document citations.
- **Bi-Temporal Versioning**: Tracking when information was valid vs. when it was extracted.
- **Geo-Spatial Metadata**: Mapping document content to physical coordinates or layout boxes.

### Schema (OKF + DoCO)
- `okf_documents`: Metadata root for document ownership and licensing.
- `okf_nodes`: Vertices containing content, layout coordinates, and vector embeddings.
- `okf_edges`: Strongly typed relations (`HAS_CHILD`, `NEXT_SIBLING`, `REFERENCES`, `SUCCEEDS`).

---

## ⚡ Two-Step Retrieval Engine

Doc Ohara bypasses flat search bottlenecks with a bifurcated retrieval strategy:

### Phase 1: Shallow Context (The "Breadth" Search)
Hybrid scoring combining:
1. **Vector Proximity**: Cosine similarity on `text-embedding-3-small`.
2. **Text Density**: BM25 full-text search via ArangoSearch.
3. **Tag Overlap**: Taxonomic intersection scoring.
*Output: Highly relevant seed nodes with "expandable directions".*

### Phase 2: Deep Context (The "Depth" Traversal)
Graph-based expansion from seed nodes:
- **Structural**: Fetching parent headers for context or child paragraphs for detail.
- **Sequential**: Walking the `NEXT_SIBLING` chain for narrative continuity.
- **Semantic**: Following citations and shared concept nodes across documents.

---

## 🛠️ Interactive Playground & Simulation

This repository includes a Node.js-native playground to test these concepts:
- **Double-Engine Extraction**: Simulated **MinerU** (academic/LaTeX) and **Docling** (business/docx) pipelines.
- **ArangoDB Simulator**: Disk-buffered in-memory graph instance with **AQL (ArangoDB Query Language)** support.
- **Gemini Integration**: Live partitioning of docs via `@google/genai`.
- **Visualization**: Live graph dashboard for real-time traversal monitoring.

---

## 🚀 Getting Started

### Installation
```bash
npm install
```

### Setup Environment
Create `.env` with your API key:
```env
GEMINI_API_KEY=your_key_here
```

### Run
```bash
npm run dev
```
Access at **http://localhost:3000**.

---

## 📁 Repository Structure

```text
├── src/
│   ├── arangodb_sim.js     # Multi-model Graph + AQL Interpreter
│   └── pipeline_runner.js  # Extraction engine logic
├── doc_pipeline/           # Pipeline workspace & state
├── DESIGN.md               # Detailed Schema & Retrieval Architecture
└── index.html              # Dashboard UI
```

---

## ⚡ AQL Example: Multi-Hop Retrieval
```aql
// Find sibling paragraphs of a section containing "Quantum"
FOR start IN okf_nodes
  FILTER start.type == "Section" AND CONTAINS(start.title, "Quantum")
  FOR v, e IN 1..2 OUTBOUND start okf_edges
    FILTER e.relation == "NEXT_SIBLING"
    RETURN v.content
```
