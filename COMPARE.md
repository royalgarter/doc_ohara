# Comparative Analysis: Doc Ohara vs WeKnora vs Hyper-Extract

> Last updated: 2026-06-25

---

## TL;DR

| | **Doc Ohara** | **WeKnora** | **Hyper-Extract** |
|---|---|---|---|
| **Primary goal** | Space-Time Graph for deep structural RAG | Enterprise knowledge management platform | Structured knowledge extraction CLI |
| **Graph DB** | ArangoDB (native) | Neo4j (optional profile) + pgvector | LightRAG / GraphRAG / Hyper-RAG backends |
| **Maturity** | Research / early-stage | Production (v0.6.2, ~17k ⭐) | Stable CLI (v1.x, ~2.2k ⭐) |
| **Language** | Node.js | Go + Vue + TypeScript | Python |
| **License** | — | MIT | Apache 2.0 |

---

## 1. Ingestion Pipeline

| Capability | Doc Ohara | WeKnora | Hyper-Extract |
|---|---|---|---|
| **Supported formats** | PDF, EPUB, DOCX, Markdown | PDF, Word, TXT, MD, HTML, Images, CSV, Excel, PPT, JSON | Any text (PDF, MD, etc.) via `he parse` |
| **Parser** | LiteParse CLI → Markdown → Gemini LLM structuring | Pluggable parsers (PaddleOCR-VL, OpenDataLoader, …) | Direct LLM extraction |
| **Chunking strategy** | DoCO schema hierarchy (Chapter → Section → Paragraph → Table) | Adaptive 3-tier chunking with live preview; parent-child chunking | Whole-doc or chunk-based per template |
| **Dedup** | SHA-256 file hash; `--force` override | Per-document reparse with `process_config` | `he clean` removes index or full KA |
| **Concurrency** | Parallel LLM batches (`OHARA_INGEST_CONCURRENCY`, default 4) | MQ async tasks with DLQ; scales to 40 k-doc KBs | Single-process CLI; no explicit batch config |
| **LLM response caching** | Yes — content-hash file cache | Not mentioned | Not mentioned |
| **Incremental updates** | Re-ingest with `--force` | Auto-sync (Feishu / Notion / Yuque); incremental + full | `he parse` appends to existing Knowledge Abstract |
| **OCR / multimodal** | Not built-in | VLM auto-describe images, ASR for audio | Not mentioned |
| **Queue / worker** | BullMQ worker + job management API | Internal MQ | CLI only |

---

## 2. Graph / Knowledge Representation

| Capability | Doc Ohara | WeKnora | Hyper-Extract |
|---|---|---|---|
| **Graph DB** | ArangoDB (documents, sections, paragraphs, tables, entities, edges) | Neo4j (optional), pgvector (primary vector store) | Pluggable — LightRAG, GraphRAG, Hyper-RAG, KG-Gen, Cog-RAG |
| **Graph model** | Property graph — typed nodes + typed edges in one `edges` collection | Vector store + optional knowledge graph (Neo4j) | 8 structure types: Model, List, Set, Graph, Hypergraph, Temporal, Spatial, Spatio-Temporal |
| **Structural edges** | `HAS_CHILD`, `NEXT_SIBLING`, `BELONGS_TO` | Not exposed — internal chunking hierarchy | Defined per template (entity → relation → entity) |
| **Semantic edges** | `SIMILAR_TO` (Jaccard entity overlap + LLM enrichment: verb, tags, summary) | Vector similarity (cosine / HNSW) | Relation edges from LLM extraction; Hyperedges for n-ary relations |
| **Named entity graph** | First-class `entities` collection with `MENTIONS` + `RELATED_TO` edges; cross-doc dedup | Entity extraction mentioned; not graph-first | Entity nodes defined in template YAML; typed fields |
| **Ontology tagging** | SUMO ontology (22,700 entries) — 3-stage resolution, on every node | Tag management per document | Template tags (domain labels, not a formal ontology) |
| **Temporal / spatial** | Implicit via `DATE` entity type | Not mentioned | Explicit Temporal Graph and Spatio-Temporal Graph types |
| **Hypergraph** | No | No | Yes — native Hypergraph and Hyper-RAG support |
| **Cross-doc edges** | Yes — `SIMILAR_TO` with LLM-enriched verb + summary | Not explicit at graph level | Shared entities link docs implicitly |

---

## 3. Retrieval Engine

| Capability | Doc Ohara | WeKnora | Hyper-Extract |
|---|---|---|---|
| **Retrieval paradigm** | 5-phase hybrid: BM25 → SUMO expansion → cross-doc edge → entity pivot → structural traversal + score fusion | RAG Quick Q&A + ReAct Agent; fan-out across vector stores | `he search` — RAG over extracted Knowledge Abstract |
| **Full-text / BM25** | ArangoSearch BM25 (fallback: term-overlap) | BM25 sparse retrieval | Not specified |
| **Vector / dense** | Not built-in | Dense vector retrieval (pgvector, Milvus, Qdrant, …) | Embedding-based RAG (OpenAI, BGE, vLLM) |
| **Graph traversal** | AQL traversal from top-scored node (depth configurable) | Optional GraphRAG via Neo4j | Graph traversal via underlying RAG engine |
| **Ontology expansion** | SUMO tag overlap expansion | Not mentioned | Not mentioned |
| **Cross-doc retrieval** | Cross-doc edge expansion (weight > 0.3 or tag overlap) with `edge_verb`/`edge_summary` | KB fan-out across multiple knowledge bases | Shared entities implicitly link across docs |
| **Entity pivot** | Yes — pivot from seed entities to other paragraphs | Not mentioned | Implicit via graph edges |
| **Reranking** | Score fusion (weighted sum across phases) | Tencent LKEAP rerank + passage cleaning | Not specified |
| **Query planning / agent** | No autonomous agent; single `query()` call | ReAct multi-step agent orchestrating retrieval + MCP + web search | `he search` is single-shot; no agent loop |
| **Web search** | No | DuckDuckGo, Bing, Google, Tavily, Baidu, SearXNG | No |
| **MCP server** | `bin/ohara-mcp.js` | `weknora mcp serve` (stdio / SSE / HTTP) | `he-mcp` (stdio); exposes search + export |

---

## 4. LLM Integration

| Capability | Doc Ohara | WeKnora | Hyper-Extract |
|---|---|---|---|
| **LLM providers** | Google Gemini only (gemini-2.5-flash-lite, Flex Inference) | 15+ providers: OpenAI, Azure, Anthropic, DeepSeek, Qwen, Zhipu, Hunyuan, Gemini, MiniMax, NVIDIA, Ollama, … | OpenAI, Anthropic, Alibaba Cloud Bailian, local vLLM |
| **Embedding** | None (no vector search; graph traversal instead) | BGE, GTE, Zhipu, OpenAI-compatible | Any OpenAI-compatible endpoint |
| **Prompt customization** | Yes — editable Markdown prompts in `prompts/` | Per-knowledge-base model selection; online prompt editing | Template YAML defines extraction schema; prompts internal |
| **LLM caching** | Content-hash file cache | Not mentioned | Not mentioned |
| **Model thinking mode** | No | Per-model thinking-mode config | No |
| **Inference optimization** | Gemini Flex Inference (cost-optimized) | WeKnora Cloud hosted parsing | No |

---

## 5. Export & Output

| Capability | Doc Ohara | WeKnora | Hyper-Extract |
|---|---|---|---|
| **Wiki export** | Quartz Markdown wiki — per-document and per-entity pages with backlinks | Wiki Mode — agents auto-generate interlinked Markdown wiki; interactive knowledge graph UI | Obsidian vault export (`he export obsidian`) with `[[wikilinks]]` |
| **Raw export** | JSON dump (`npm run ohara:export:json`) | API access to all KB data | JSON Knowledge Abstract files |
| **Visualization** | SVG graph in dashboard UI | Interactive knowledge graph UI in web app | `he show` — interactive visualizer |
| **Format** | Markdown (Quartz-compatible) | Markdown (interlinked); IM channels output | Markdown (Obsidian), JSON |
| **Self-hosted wiki** | Output to `wiki/` dir (Quartz) | Built-in wiki browser | Output to local vault |

---

## 6. Platform & Deployment

| Capability | Doc Ohara | WeKnora | Hyper-Extract |
|---|---|---|---|
| **Deployment model** | Self-hosted Node.js + ArangoDB | Docker Compose / Kubernetes (Helm); cloud-hosted option | Local CLI / pip install |
| **UI** | Express + Alpine.js dashboard | Full web UI + WeCom / Feishu / Slack / Telegram / WeChat Mini Program / Chrome Extension | CLI only (`he` commands) |
| **API** | RESTful HTTP API (Express) | RESTful API + CLI (`weknora`) | Python library + CLI |
| **Auth / multi-tenant** | None | 4-tier RBAC (Owner / Admin / Contributor / Viewer), per-tenant audit log, OIDC | None |
| **Observability** | None | Langfuse full tracing (agent loops, token usage, pipeline stages) | None |
| **Security** | None mentioned | AES-256-GCM key encryption, gRPC TLS, SSRF-safe client, sandbox isolation | MseeP.ai security assessment |
| **IM / chat integrations** | None | WeCom, Feishu, Slack, Telegram, DingTalk, Mattermost, WeChat | None |
| **Data source connectors** | File upload / CLI path | Feishu, Notion, Yuque auto-sync | Local file / URL |
| **Object storage** | Local filesystem | Local, MinIO, S3, Volcengine, Alibaba OSS, KS3, Huawei OBS | Local |

---

## 7. Developer Experience

| Capability | Doc Ohara | WeKnora | Hyper-Extract |
|---|---|---|---|
| **Setup** | `npm install`, copy `.env`, run `npm run dev` | `docker compose up -d` | `uv tool install hyperextract` |
| **CLI** | `node bin/ohara.js ingest / query / export` | `weknora auth / kb / doc / chat` | `he parse / search / show / export / clean` |
| **Testing** | Node.js built-in test runner (`tests/ingest.test.js`) | E2E pipeline evaluation with BLEU / ROUGE metrics | Not mentioned |
| **Hot reload** | nodemon | Air (Go) + Vite (frontend) | N/A |
| **In-memory simulator** | Yes — ArangoDB simulator for dev without a real DB | No | N/A |
| **Prompt editing** | Markdown files in `prompts/` (editable) | Online prompt editing in UI | YAML templates in `hyperextract/templates/presets/` |
| **80+ domain templates** | No (single ingest prompt + one edge enrichment prompt) | No | Yes — Finance, Legal, Medical, TCM, Industry, General |

---

## 8. Unique Strengths Summary

### Doc Ohara — unique to this project
- **DoCO structural hierarchy** preserved as graph nodes (Chapter → Section → Paragraph → Table) — retrieval is structurally aware, not just semantically aware
- **SUMO ontology validation** (22,700 entries) on every node — formal ontology grounding for both indexing and retrieval expansion
- **LLM-enriched cross-doc edges** — `SIMILAR_TO` edges carry a natural-language `verb` + `summary` generated at ingest time, surfaced at retrieval time
- **Five-phase hybrid engine** combining BM25, ontology, cross-doc edges, entity pivot, and structural graph traversal in a single `query()` call
- **ArangoDB-native** — graph traversal (AQL) and full-text search (ArangoSearch) from a single store with no external vector DB

### WeKnora — unique advantages
- Enterprise-grade multi-tenant RBAC + audit log + OIDC
- ReAct autonomous agent with tool orchestration and web search
- Wiki Mode auto-generates and maintains interlinked Markdown knowledge bases
- 15+ LLM providers and 7+ vector DBs — fully swappable
- IM channel integrations (WeCom, Feishu, Slack, Telegram, WeChat)
- Langfuse observability across the full pipeline
- Chrome Extension and WeChat Mini Program

### Hyper-Extract — unique advantages
- **8 strongly-typed knowledge structures** including Hypergraph and Spatio-Temporal Graph
- **80+ YAML domain templates** (Finance, Legal, Medical, TCM, Industry, General) — zero-code extraction
- Obsidian vault export with `[[wikilinks]]` for local personal knowledge management
- Truly incremental — feed new documents any time to evolve the same Knowledge Abstract
- Lightest setup: single `uv tool install hyperextract` command

---

## 9. Gap Analysis — What Doc Ohara Is Missing vs Peers

| Gap | Impact | Reference |
|---|---|---|
| No vector / dense retrieval | Limits semantic recall for paraphrase queries where BM25 and graph edges don't fire | WeKnora pgvector, Hyper-Extract embeddings |
| Single LLM provider (Gemini only) | Vendor lock-in; no fallback if Gemini is unavailable | WeKnora 15+ providers, Hyper-Extract 4+ |
| No autonomous agent / multi-step reasoning | Complex queries require manual decomposition | WeKnora ReAct agent |
| No multi-tenancy / auth | Blocks enterprise or shared deployments | WeKnora 4-tier RBAC |
| No temporal / spatial graph types | Cannot natively model time-series or geographic knowledge | Hyper-Extract Temporal / Spatio-Temporal |
| No Hypergraph support | n-ary relations must be decomposed into binary edges | Hyper-Extract Hypergraph |
| No domain-specific templates | Users must craft their own prompts from scratch | Hyper-Extract 80+ YAML templates |
| No observability / tracing | Hard to debug retrieval quality or LLM calls in production | WeKnora Langfuse integration |
| No incremental / streaming ingest | Re-ingest with `--force` is all-or-nothing | Hyper-Extract incremental evolution |
| No IM / external integrations | Knowledge stays inside the tool | WeKnora WeCom / Feishu / Slack / … |
