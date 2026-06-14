# AI Document Extraction Pipeline 🚀

An interactive playground that processes academic or business documents via simulated **MinerU** and **Docling** pipelines, standardizing them into relational collections and storing them in an ArangoDB graph database with full **AQL (ArangoDB Query Language)** querying capability.

This project is built from the ground up to be fully **Node.js-native**, leveraging standard JavaScript ES modules (`type: "module"`) and requiring no heavyweight transpiles or compilation steps.

---

## 🌟 Key Features

- **Double-Engine Layout Extraction**:
  - **MinerU Sim**: Models layout parsing for complex PDF academic papers, breaking contents into standard title blocks, section structures, tabular data, and raw LaTeX mathematical equations.
  - **Docling Sim**: Models operational document layouts (docx/txt), producing clean nested text headers, structural bullet lists, and standard business table matrices.
- **Server-Side Gemini Integration**: Optionally powered by `gemini-3.5-flash` via the `@google/genai` Node.js SDK to digest uploaded text documents and organize them dynamically into layout collections.
- **ArangoDB Graph Database Simulator**: Includes a realistic, disk-buffered in-memory ArangoDB multi-model instance.
  - Generates relational edge linkages (`has_section`, `contains_paragraph`, `contains_table`, `belongs_to`) automatically.
  - Custom data mutation handlers (`insertDocument`, `insertSection`, `insertParagraph`, `insertTable`, `insertEdge`).
- **AQL Compiler & Interpreter**: Features a client-server executable engine with support for standard FOR loops, projections, filter conditions, sorting, limit structures, and Graph Traversals matching outbound/inbound multi-hop schemas.
- **Rich Interactive UI**: High-fidelity dashboard visualizing:
  - Real-time pipeline processing queue status and console streams.
  - Live graph visualization displaying document and section node connections.
  - Interactive collection browser with full searching, paging, and custom AQL input consoles.

---

## 🛠️ Installation & Setup

Install all necessary production and development dependencies using:

```bash
npm run install
```

### Environment Variables

To activate the real-time AI document partitioner, set up your server-side Gemini API key. Rename `.env.example` to `.env` or set it in your system's environment variables:

```env
GEMINI_API_KEY=your_gemini_api_key_here
```

*Note: If no API key is specified, the pipeline will automatically fall back to high-fidelity simulated layouts.*

---

## 🚀 Running the App

### Development Mode

Start the Node.js backend server with hot-reload monitoring:

```bash
npm run dev
```

### Production Start

Serve the application in the optimized production configuration:

```bash
npm start
```

Once running, the application will be active and listening on **http://localhost:3000**.

---

## 📁 Repository Structure

```text
├── doc_pipeline/           # Database state & pipeline workspace
│   ├── collections/        # Standardized database output storage JSONs
│   ├── input/              # Staged input files for parsing
│   └── raw_output/         # Raw visual layouts parsed from files
├── src/                    # Backend modular simulation components
│   ├── arangodb_sim.js     # ArangoDB Simulator & AQL Query Interpreter
│   ├── document_samples.js # Default seeded structures
│   └── pipeline_runner.js  # Main doc extract execution engine
├── index.html              # Alpine.js-powered interactive front-end
├── server.js               # Node.js/Express main entry point
├── package.json            # Node scripts & dependencies metadata
└── tsconfig.json           # Type configurations
```

---

## ⚡ AQL Query Cheatsheet

### 1. View All Document Nodes
```aql
FOR doc IN documents 
  RETURN doc
```

### 2. Find Academic Equations in Papers
```aql
FOR p IN paragraphs 
  FILTER p.is_latex == true 
  RETURN p
```

### 3. Outbound Graph Traversal (Find sections associated with document)
```aql
FOR v, e IN OUTBOUND "documents/quantum_paper_001" has_section, belongs_to 
  RETURN v
```
