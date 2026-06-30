# OHARA vs PageIndex

## PageIndex Core Approach

**Repo**: https://github.com/VectifyAI/PageIndex  
**Philosophy**: "similarity ≠ relevance" — dumps vector DBs entirely.

### Two phases:
1. **Build**: LLM reads PDF → extracts/infers TOC → hierarchical tree (`node_id`, `page_range`, `summary`)
2. **Retrieve**: LLM agent *reasons* over tree to navigate sections, like human expert skimming a book

### Key mechanics:
- Detects native PDF TOC → extracts it; if absent → LLM infers structure from content flow
- Tree nodes = natural section boundaries, not fixed-size chunks
- Retrieval = `get_document_structure()` (tree, no text) → agent picks branches → `get_page_content(page_range)`
- `verify_toc()` + `fix_incorrect_toc()` — LLM validates and corrects misaligned page references
- Tree "thinning" for Markdown: merges nodes below token threshold
- Optional `summary` per node and `description` per document at index-build time

**Result**: 98.7% on FinanceBench. No vectors, no embeddings.

---

## What PageIndex Does NOT Have (OHARA's Edges)

| OHARA capability | PageIndex equivalent |
|---|---|
| Cross-doc `SIMILAR_TO` graph + Jaccard | None — single-document focus |
| Entity graph + pivot | None |
| SUMO ontology tagging | None |
| Temporal scoring / decay classes | None |
| Multi-phase score fusion | Single-path tree descent |
| Tier system (Principal / Integrity / Explorer) | None |
| Feedback loop (REFEED RAG) | None |

PageIndex wins on **within-document precision** for structured docs (financials, legal).  
OHARA wins on **cross-document reasoning** and **semantic diversity**. Complementary, not competing.

---

## What OHARA Can Learn

### 1. Section-level summaries at ingest

PageIndex generates LLM summaries **per tree node** (not just per cross-doc edge). OHARA enriches `SIMILAR_TO` edges with summaries but sections and paragraphs have no summary field.

**Status**: Implemented — `summary` field added to `sections` nodes in `prompts/ingest_document.md`. Used as scent signal in Phase 3 structural traversal (Corrective RAG compares section summary against query hints, not just SUMO tag overlap).

### 2. TOC-guided Phase 0b

PageIndex tree search: LLM gets `document_structure` (titles + summaries, no content) → reasons which branches to descend → fetches content only for chosen branches.

OHARA has `TOC_REF` edges and `HAS_CHILD` hierarchy but never uses the tree top-down at query time. All phases start at leaf level (paragraphs) or document level.

**Status**: Implemented — Phase 0b added in `src/retrieval.js`. For phrase/paragraph queries, fetches top-level section tree (titles + summaries) for seed documents → asks Gemini which sections are relevant → uses those section nodes as entry point for Phase 3 structural traversal.

### 3. Document-level description field

PageIndex generates a natural-language `description` of the entire document. OHARA's `documents` node has `entity_slugs`, `sumo_tags`, `title` — but no prose description.

**Status**: Implemented — at ingest step ⑨ (rollup), Gemini generates one-sentence `description` from top-scored paragraphs. Stored on `documents.description`. Used in query fingerprint prompt to improve SUMO/entity hint extraction for cross-document expansion.

### 4. Structural verification flag

PageIndex `verify_toc()` checks that extracted structure maps to real content. OHARA has no equivalent — if LLM structuring produces wrong `level` or misassigns a paragraph, it silently persists.

**Status**: Implemented — post-ingest validation checks `HAS_CHILD` edge consistency (no orphaned sections, no depth jumps > 1). Docs with anomalies flagged `structure_needs_review: true` on the `documents` node.

---

## Priority Order

| # | Feature | Effort | Payoff |
|---|---|---|---|
| 1 | Section summaries at ingest | Low | High — improves Phase 3 + Corrective RAG scent signal |
| 2 | TOC-guided Phase 0b | Medium | High — fixes "lost in the middle" within large documents |
| 3 | Document description field | Low | Medium — improves cross-doc fingerprinting |
| 4 | Structural verification flag | Low | Medium — data hygiene, catches bad ingests |
