# Dense Embeddings - Implementation Plan

## Goal
Add a vector similarity phase (Phase 1d) alongside BM25 to improve recall for
paraphrase queries ("explain PoW" finds "proof-of-work" content even without BM25 term overlap).

## Architecture

### Embedding model
Gemini `text-embedding-004` (768 dimensions, free tier available).
Same API key as ingest - no new credentials.

### Storage
- `paragraphs.embedding` - float array [768] stored on each paragraph node
- ArangoDB 3.12 Enterprise vector index on `paragraphs.embedding`
  - type: `vector`, metric: `cosine`, dimensions: 768

### Ingest changes (src/ingest/pipeline.js)
After collection transform (step 7), before persist (step 8):
- Batch embed all paragraph content with Gemini embedding API
- Store `embedding` on each paragraph record
- New env var: `OHARA_EMBED_BATCH_SIZE` (default 20, rate-limit safety)
- Skip empty/short paragraphs (< 20 chars)

### DB init changes (scripts/db-init.js)
Add vector index:
```js
await db.collection('paragraphs').ensureIndex({
  type: 'vector',
  fields: ['embedding'],
  inBackground: true,
  params: { metric: 'cosine', dimension: 768, nLists: 4 }
});
```

### Retrieval changes (src/retrieval.js)
New Phase 1d `_phase1dVector(processedQuery, limit)`:
```js
// 1. Generate query embedding (cached by query text hash)
// 2. AQL: APPROX_NEAR('paragraphs', queryEmbedding, { limit, metric: 'cosine' })
// 3. Return { node, score: 1 - cosine_distance, source: 'vector' }
```
Weight in fusion: `OHARA_VECTOR_WEIGHT` (default 0.5).

### Env vars
| Var | Default | Purpose |
|-----|---------|---------|
| `OHARA_EMBED_BATCH_SIZE` | `20` | Paragraph batch size for embedding calls |
| `OHARA_VECTOR_WEIGHT` | `0.5` | Score weight for vector phase in fusion |
| `OHARA_VECTOR_LIMIT` | `10` | Max results from vector phase |

## Backfill
- `scripts/backfill-embeddings.js`: iterates paragraphs without `embedding`, batches Gemini calls, updates records.

## Success criteria
- `node bin/ohara.js query "explain proof of work concept"` returns paragraphs about PoW even if they don't contain "explain"
- Vector phase results show `[vector]` source tag in `--raw --verbose` output

## Out of scope
- Multi-modal embeddings (images)
- External vector stores (Pinecone, Weaviate)
- Fine-tuned embedding models
