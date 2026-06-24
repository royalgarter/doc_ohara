---

# Doc Ohara: Architecture Review & Engineering Recommendations

Based on a comprehensive review by our panel of experts in Graph Databases, Information Retrieval, and Distributed Systems, the **Doc Ohara** blueprint presents a highly ambitious and forward-thinking approach to document knowledge extraction. The integration of the OKF/DoCO ontology with ArangoDB's multi-model capabilities is a strong foundation.

However, several critical bottlenecks in latency, query performance, and pipeline resilience must be addressed before moving to production.

---

### 1. Retrieval Engine & Latency Bottlenecks

**Vulnerability:** Phase 0 of the retrieval engine relies on a synchronous call to an LLM (`gpt-4o-mini`) to extract entities, tags, and keywords from the user's query. This introduces an unacceptable latency floor (500ms - 2000ms) before the database is even queried. Furthermore, hardcoded composite scoring in Phase 1 will struggle to adapt to different query types.

**Recommendations:**
*   **Decouple Query Parsing:** Replace the synchronous LLM call with a lightweight, local NLP model (e.g., a quantized ONNX model or spaCy pipeline) for sub-50ms Named Entity Recognition (NER) and keyword extraction. 
*   **Dynamic Scoring:** Do not hardcode the composite score weights (`0.5, 0.3, 0.2`). Implement a dynamic weighting system based on query heuristics (e.g., if the query lacks recognized entities, boost the vector weight; if it contains specific technical jargon, boost the BM25 weight).
*   **BM25 Tuning:** Ensure the `BM25()` function in ArangoSearch is tuned (adjusting `k` and `b` parameters) specifically for short-form paragraph nodes to prevent bias toward longer text blocks.

### 2. Graph Database & AQL Optimization

**Vulnerability:** The provided AQL examples demonstrate performance risks. Using string functions like `CONTAINS(start.title, "Quantum")` on standard collections forces a full collection scan. Additionally, calculating Cosine Similarity on the fly for a large pool of BM25-matched documents will cause CPU spikes.

**Recommendations:**
*   **Mandate ArangoSearch for Text:** Never use `CONTAINS` for text search. Always route text filtering through ArangoSearch Views using `TOKENS()` or `NGRAM_MATCH()` to leverage inverted indexes.
*   **Optimize Vector Search:** Utilize ArangoDB's native vector search capabilities (introduced in recent versions) to perform Approximate Nearest Neighbor (ANN) searches *before* or *alongside* text filtering, rather than computing cosine similarity manually in the `LET` clause for every document.
*   **Strict Edge Directionality:** Update the JSON validation schema for `okf_edges` to enforce strict directionality (e.g., `NEXT_SIBLING` must always be outbound).

### 3. Ingestion Pipeline & Self-Healing

**Vulnerability:** Orchestrating local extraction engines (MinerU/Docling) via shell scripts (`run_pipeline.sh`) is brittle. It lacks state management, retries, and dead-letter queues. Furthermore, relying on an "AI Auditor" (Section 6) to fix broken structural chains (`NEXT_SIBLING`) post-ingestion is computationally expensive and prone to hallucination.

**Recommendations:**
*   **Implement a Robust Task Queue:** Replace shell orchestration with a distributed task queue (e.g., Temporal, Celery, or BullMQ). This provides built-in retries, timeout handling for OOM errors during heavy PDF parsing, and proper state tracking.
*   **Deterministic Structural Integrity:** Deprecate the use of LLMs for "Structural Healing." The AST-to-Graph mapping must be deterministic. If a document parses incorrectly, it should fail the pipeline and be flagged for manual review or alternative parsing, rather than attempting to have an LLM guess the narrative continuity.
*   **Transactional Guarantees:** Ensure Stage 5 (Persistence) utilizes ArangoDB's ACID transactions. If a document's graph insertion fails midway, the entire transaction must roll back to prevent the creation of orphaned nodes, eliminating the need for post-hoc structural audits.

### 4. Semantic Enrichment ("Lost in the Middle")

**Vulnerability:** The "Contextual Header" technique (prepending structural metadata to paragraph content before vectorization) dilutes the vector density of the actual paragraph content and inflates token usage.

**Recommendations:**
*   **Multi-Vector Indexing:** Instead of string concatenation, index the pure paragraph content as the primary vector. Store the parent section's vector (or a summarized context vector) as secondary metadata on the node. During retrieval, use a multi-vector search strategy or rely on the graph structure (fetching the parent node's context *after* the paragraph is matched) to provide context without diluting the primary embedding.
</ANSWER>

---

<CONDUCTOR_NOTE>
The user is asking a crucial architectural question: Should structured metadata like `tags` and `enum` properties be queried using semantic matching (vector similarity) or simple text/exact matching? I will reconvene our panel to debate the trade-offs between search recall (semantic) and database precision/performance (exact).
</CONDUCTOR_NOTE>

<ANSWER>
The short answer is: **No for Enums, and a "Hybrid Yes" for Tags.** 

Treating structured metadata the same way you treat unstructured paragraph text is a common pitfall in vector search architectures. You should split your strategy based on the property type to balance search relevance with database performance.

Here is the recommended approach:

### 1. For `enum` and Structural Labels: Strict Exact Matching
Properties that define the ontology of your graph (e.g., `node.type`, `edge.relation`, status flags) must use **exact matching**. 

*   **Why?** Enums are structural constraints. If a query filters for `node.type == "Section"`, using semantic matching might return a `"Chapter"` or `"Paragraph"` because the words are semantically related in vector space. This breaks the structural integrity of your graph traversals.
*   **Performance:** Exact matching allows ArangoDB to utilize Hash Indexes, resulting in `O(1)` lookup times. Vector similarity is vastly more computationally expensive and unnecessary for fixed vocabularies.

### 2. For `tags`: Semantic Query Expansion + Exact Database Match
For user-defined or LLM-generated tags, simple exact matching suffers from the "vocabulary mismatch" problem (e.g., the user searches "AI", but the tag is "Machine Learning"). However, performing vector similarity on single-word tags inside the database yields poor results and wastes compute.

**The Solution: Phase 0 Query Expansion**
Instead of doing semantic matching *inside* ArangoDB, do it at the gateway before the query is constructed.

1.  **Maintain a Tag Taxonomy:** Keep a cached list of all unique, valid tags currently in your database.
2.  **Semantic Mapping (Phase 0):** When a user submits a query, use your lightweight NLP model or LLM to map their query to the *closest existing tags* in your taxonomy. 
    *   *User Input:* "Healthcare regulations"
    *   *Phase 0 Expansion:* Maps to exact system tags `["Medical", "Compliance", "Policy"]`.
3.  **Exact Database Query (Phase 1):** Pass those exact strings into your ArangoDB query using the `IN` operator.

**Example AQL Implementation:**
```aql
// DO THIS: Fast, exact match using semantically expanded tags from Phase 0
FOR doc IN okf_search_view
  SEARCH doc.tags ANY IN ["Medical", "Compliance", "Policy"] // Expanded from "Healthcare"
  // ... proceed with BM25 and Vector search on the main content
```

### Summary
By keeping semantic fuzziness in the query preprocessing stage (Phase 0) and strict exactness in the database execution stage (Phase 1), you achieve the best of both worlds: the high recall of semantic search and the microsecond latency of traditional database indexing.
</ANSWER>