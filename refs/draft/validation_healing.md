# Graph Validation & Self-Healing: The AI Auditor

After the initial ingestion, the **Space-Time Graph** may contain hallucinations, broken structural chains, or schema violations. This stage acts as a "Refinery" that ensures high-fidelity data integrity before the graph is committed to ArangoDB.

---

## 🛡️ The Validation Loop

1.  **Schema Audit**: Rule-based check against `DESIGN.md` (JSON Schema).
2.  **Structural Integrity Check**: Identifying "Orphan Nodes" (paragraphs with no parent) or "Broken Chains" (missing `NEXT_SIBLING` edges).
3.  **Semantic De-duplication**: Merging similar concepts extracted from different pages.
4.  **AI-Powered Healing**: Using an LLM to "hallucinate-fix" or logically reconnect missing links.

---

## 📝 Self-Correction Prompts

### 1. The "Graph Auditor" Prompt
**Goal**: Identify structural and logical flaws in a batch of parsed nodes.

```markdown
**System Prompt**:
You are a Lead Graph QA Engineer. Review the following batch of document nodes and their relationships. 
Identify any "Structural Gaps" (nodes that should be connected but aren't) or "Taxonomic Errors" (incorrectly typed nodes).

**Input Data**:
- Node A (type: Section, title: "Initial Results")
- Node B (type: Paragraph, content: "In summary, the results were positive.")
- Current Relation: None.

**Auditor Evaluation**:
{
  "issues": [
    {
      "type": "Broken_Hierarchy",
      "severity": "High",
      "description": "Paragraph Node B lacks a HAS_CHILD relationship from Section Node A."
    }
  ],
  "recommendation": "Link Node A -> Node B via HAS_CHILD."
}
```

### 2. The "Self-Healing & Merging" Prompt
**Goal**: Consolidate redundant entities and fix broken narrative flows.

```markdown
**System Prompt**:
You are a Knowledge Architect. You have two versions of the same concept extracted from different parts of a document. 
Merge them into a single high-fidelity node and update the relationship map.

**Node 1**: { "title": "Quantum Sup.", "content": "Physics principle..." }
- **Node 2**: { "title": "Superposition", "content": "The ability of a system to be in multiple states." }

**Healing Action**:
{
  "action": "MERGE",
  "target": "Superposition",
  "merged_content": "Superposition: The quantum physics principle describing the ability of a system to be in multiple states simultaneously.",
  "old_ids": ["node_1", "node_2"]
}
```

### 3. The "Narrative Continuity" Healer
**Goal**: Reconstruct the `NEXT_SIBLING` chain if nodes were processed out of order.

```markdown
**System Prompt**:
Analyze these three paragraphs. They are currently unordered. 
1. Determine their logical sequence.
2. Generate the `NEXT_SIBLING` edges to restore the narrative flow.

**Input Nodes**:
[
  { "id": "p1", "text": "Finally, we conclude that..." },
  { "id": "p2", "text": "The experiment began with..." },
  { "id": "p3", "text": "After the initial phase, we observed..." }
]

**Logical Chain**:
p2 (Start) -> NEXT_SIBLING -> p3 (Middle) -> NEXT_SIBLING -> p1 (End)
```

---

## ⚙️ Automated Workflow (The "Refinery" Script)

```javascript
/**
 * Pseudo-code for the Validation/Correction Step
 */
async function refineGraph(parsedData) {
  // 1. Rule-based validation (Fast)
  const orphans = parsedData.nodes.filter(n => !hasParent(n));
  
  if (orphans.length > 0) {
    // 2. AI-powered "Healing" (Reasoning required)
    const repairs = await llm.correctHierarchy(orphans, parsedData.structure);
    applyRepairs(parsedData, repairs);
  }

  // 3. Entity Normalization
  const uniqueConcepts = await llm.deduplicateConcepts(parsedData.nodes.filter(n => n.type === 'Concept'));
  updateReferences(parsedData, uniqueConcepts);

  return parsedData;
}
```

---

## 💎 Success Metrics for Validation
- **Connectivity Score**: % of nodes with at least 1 structural edge.
- **Taxonomic Accuracy**: Human-in-the-loop verification of node types.
- **Context Preservation**: Ensuring `Context Headers` (from Ingestion) match the actual hierarchy.
