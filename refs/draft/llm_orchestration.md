# LLM Role: The Semantic Orchestrator

In the Doc Ohara pipeline, the LLM is not just a summarizer-it is a **Structural Architect**. It bridges the gap between raw text strings and the complex **OKF/DoCO** graph schema.

---

## 🤖 LLM Responsibilities

1.  **Logical Partitioning**: Identifying where one semantic section ends and another begins when Markdown headers are missing or ambiguous.
2.  **Taxonomic Classification**: Assigning standardized types (`Chapter`, `Concept`, `Table`) to raw text blocks.
3.  **Entity & Concept Extraction**: Distilling internal concepts and linking them to a global graph of knowledge.
4.  **Relationship Inference**: Detecting implicit links between distant paragraphs (e.g., "This paragraph refutes the claim in Chapter 2").

---

## 📝 Example Ingestion Prompts

### 1. The "Structural Decomposer" Prompt
**Goal**: Convert a raw text chunk into structured JSON nodes ready for database insertion.

```markdown
**System Prompt**:
You are a Document Engineering Agent specializing in the DoCO (Document Components Ontology) standard. 
Analyze the provided text and decompose it into a JSON array of structural nodes.

**Constraints**:
- Every node must have a `type` (Chapter, Section, Paragraph, Table, or Concept).
- Identify implicit `tags` for each node.
- Extract any geographic references for the `spatial.geo_json` field.
- Output ONLY valid JSON.

**Input Text**:
"Dr. Aris's research in the Athens Lab (37.98°N, 23.72°E) suggests that quantum tunneling is the key to faster CPUs. This builds on the work of Moore."

**Expected Output**:
[
  {
    "type": "Paragraph",
    "title": "Quantum Tunneling in CPU Design",
    "content": "Dr. Aris's research... key to faster CPUs.",
    "tags": ["quantum_tunneling", "semiconductors", "cpu_architecture"],
    "spatial": {
      "geo_json": { "type": "Point", "coordinates": [23.72, 37.98] }
    }
  },
  {
    "type": "Concept",
    "title": "Moore's Law",
    "content": "Referenced as the foundational context for Dr. Aris's work.",
    "tags": ["scaling", "industry_standards"]
  }
]
```

### 2. The "Relational Synthesis" Prompt
**Goal**: Identify edges between existing nodes.

```markdown
**System Prompt**:
You are a Graph Data Scientist. Given a list of document nodes, identify the semantic relationships between them.

**Available Relations**:
- `HAS_CHILD`: Structural hierarchy.
- `REFERENCES`: Citation or semantic link.
- `SUCCEEDS`: Temporal or logical update.

**Input Nodes**:
1. [ID: node_1] "Overview of Quantum Computing"
2. [ID: node_2] "Definition of a Qubit"

**Expected Output**:
[
  { "from": "node_1", "to": "node_2", "relation": "HAS_CHILD", "confidence": 0.98 },
  { "from": "node_2", "to": "node_1", "relation": "REFERENCES", "confidence": 0.85 }
]
```

### 3. The "Semantic Tagging & Vector Context" Prompt
**Goal**: Prepare content for high-fidelity vector search by adding "contextual headers".

```markdown
**System Prompt**:
For the following paragraph, generate a "Context Header" that summarizes its place in the document hierarchy. This will be prepended to the text before vectorization to solve the 'lost in the middle' problem.

**Input**:
"We observed a 15% increase in throughput using this method."

**Context**: 
Document: "Throughput Optimization 2024", Section: "Results", Subsection: "Method B Testing"

**Expected Output**:
"In the context of Results for Method B Testing in the Throughput Optimization 2024 report: We observed a 15% increase in throughput using this method."
```

---

## ⚙️ Orchestration Strategy

- **Small Context Window**: Use `gpt-4o-mini` for Stage 2 (Structural Decomposition) on individual pages/chunks.
- **High Reasoning**: Use `gpt-4o` or `claude-3.5-sonnet` for Stage 4 (Relational Synthesis) to maintain consistency across the entire document graph.
- **Streaming**: For massive documents, use a sliding window approach where the LLM "remembers" the last 3 nodes to maintain `NEXT_SIBLING` continuity.
