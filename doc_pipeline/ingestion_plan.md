Doc Ohara — Strict Ingest Implementation Plan

Purpose
-------
Implement the ingestion pipeline so that it strictly: (1) uses LiteParse CLI to convert source docs into Markdown, (2) runs deterministic extraction on the parsed Markdown using the system prompt(s) in prompts/, (3) never uses sample/fallback data, (4) retries transient failures (30s wait, max 3 attempts), (5) caches LLM calls (system prompt + chunk) and (6) parallelizes LLM work by chunk/group.

Constraints (mandatory)
-----------------------
- No sample/mock/fallback outputs. If any step fails after retries the job must fail and stop.
- Retries: wait 30s between attempts, max 3 attempts per action (LiteParse run, each LLM chunk call, persistence write). Retries are idempotent and safe.
- All LLM calls must be cached on-disk (cache key includes system prompt canonical form + chunk hash + model id + relevant env credentials fingerprint).
- Chunking: never send full-document in one LLM prompt. Split by heading when available, else by size/token limit (configurable; default 3000 tokens or ~12KB text).
- Parallelization: process chunks in parallel (worker pool). Reduce/merge step collects parsed nodes and validates order/continuity.
- Credentials: always read credentials from environment. If required env variables (e.g., GEMINI_API_KEY, LITEPARSE_CLI_PATH or `lit` on PATH) are missing, abort and show a clear error.
- All operations must be logged and instrumented; expose progress to queue state.

Success Criteria
----------------
- Given a real input file placed into doc_pipeline/input/<file>, running the ingestion job produces:
  - a Markdown file via LiteParse in doc_pipeline/raw_output/<file>/<name>.md
  - parsed OKF/DoCO JSON nodes produced by the system prompt (prompts/ingest_document.md) for each chunk
  - collections JSON written and persisted into ArangoDB simulator with ACID semantics
- No sample/failure-derived content should be present.
- If Lit parse, LLM structuring, or persist fails after 3 attempts, job is marked failed and no partial data is persisted.

Design Overview
---------------
1. Preflight checks
   - Verify presence of required env vars:
     - GEMINI_API_KEY (or OHARA_LLM_PROVIDER + provider-specific creds)
     - Confirm `lit` executable is available or LITEPARSE_CLI_PATH set and executable.
   - Validate concurrency env: OHARA_INGEST_CONCURRENCY (default 4).
   - If any missing -> log error and abort job immediately.

2. LiteParse conversion
   - Run: lit parse "<input>" --format markdown -o "<out>.md"
   - Retry on failure (30s backoff, max 3 attempts). Treat non-zero exit as retryable once unless stderr indicates permanent error.
   - On success, verify output MD file exists and is non-empty.

3. Chunking
   - Parse Markdown for top-level headings (e.g., #, ##, H1/H2). Create chunk per heading subtree.
   - If headings absent or chunk too large, split by size (approx. token limit). Preserve chunk order and source offsets.
   - Emit chunk metadata: {chunk_id, start_byte, end_byte, heading_path, hash}

4. LLM structuring per chunk (map-phase)
   - For each chunk:
     - Compute cache key: SHA256(system_prompt_normalized + "\n" + chunk_text + "\n" + model_id + env_credential_fingerprint)
     - If cached response exists, validate schema and use it.
     - Else call LLM with a short system prompt = contents of prompts/ingest_document.md and the chunk as input. Include explicit instructions about expected JSON schema and maximum token limits.
     - Use exponential backoff retry: wait 30s between attempts, max 3 tries.
     - Save response (raw) and parsed JSON to cache atomically (write to tmp file then rename).
   - Calls are executed with a worker pool (OHARA_INGEST_CONCURRENCY) to parallelize but keep LLM quota manageable.

5. Reduce/merge
   - Validate each chunk parsed JSON (no missing fields, nodes array present). If any chunk fails schema validation -> fail job (no fallback).
   - Reassemble nodes preserving original document order using chunk metadata.

6. Transform & Persist (atomic)
   - Convert nodes -> OKF/DoCO collections using deterministic mapping in transformRawToCollections.
   - Begin DB transaction (or simulator equivalent). Attempt to insert documents, sections, paragraphs, tables atomically.
   - Retry DB write on transient errors (30s wait, max 3). If final attempt fails -> roll back and fail job.

7. Finalization
   - Write collections files to doc_pipeline/collections only after successful DB persist.
   - Mark queue job completed with metrics (document count, node count, timing).

Implementation Tasks (code changes)
----------------------------------
- Create src/llm_cache.js: simple on-disk cache with get(key)->value, put(key,value), atomic writes, TTL optional.
- Update src/pipeline_runner.js:
  - Add preflightChecks() function to verify env and CLI availability.
  - Replace current performParsing with strict LiteParse-first flow that never falls back to sample data; implement retry semantics.
  - Implement chunking utilities for Markdown.
  - Use llm_cache for generateFromMarkdown.
  - Ensure errors bubble up so worker can apply retry policy.
- Update src/worker.js:
  - Enforce job-level retry semantics (30s wait, max 3 attempts overall), but ensure per-step retries handled inside pipeline so worker only records failure after all retries exhausted.
- Add instrumentation/logging and unit tests for llm_cache and chunking.

LLM cache details
-----------------
- Location: configurable OHARA_LLM_CACHE_DIR (default: .ohara_llm_cache/ in repo root).
- Key derivation: SHA256(normalized_prompt + "\n" + chunk_text + "\n" + model_id + "\n" + cred_fingerprint).
- cred_fingerprint: short HMAC or SHA256 of concatenated env credential values; do NOT log secrets. Use only for cache key.
- Store: { response_raw: string, parsed_json: object, meta: { model_id, cached_at, prompt_hash, chunk_hash } }
- Atomic write: write to tmp file then fs.rename.

Parallelization & resource control
----------------------------------
- Default concurrency: 4. Make configurable via OHARA_INGEST_CONCURRENCY.
- Use Promise.allSettled with concurrency limit (worker pool) for chunk LLM calls.
- Rate-limiting: add optional per-second limit to avoid provider throttling.

Testing & Verification
----------------------
- Integration test using a real file placed in doc_pipeline/input/; verify full run succeeds end-to-end.
- Unit tests:
  - llm_cache put/get and atomicity
  - Markdown chunker: heading-based and size-based splitting
  - Schema validator for LLM responses

Operational notes
-----------------
- Document must be real; CI should not include synthetic fallbacks.
- If provider credentials rotate, cache fingerprint changes; old cache entries become unused but remain safe on disk.
- On persistent failures, include error diagnostics and exact env check output (mask secrets) in job logs.

Estimated effort
----------------
- 1 day: llm_cache + chunker + unit tests
- 1 day: pipeline integration and preflight checks + worker retry behavior
- 0.5 day: testing with real documents and instrumentation

Database cleanup (2026-06-21)
-------------------------
- During recent testing an existing "edges" collection was found to be a document collection. For a clean start it was renamed to a backup collection (edges_old_<timestamp>) and a proper ArangoDB edge collection named "edges" was created.
- All edges_old_* collections have now been dropped to ensure a clean database state. An admin script scripts/drop_edges_old.js was added and committed to perform this action when needed.

Approval
--------
Proceed with implementation? If yes, confirm desired concurrency and cache directory location (defaults will be used otherwise).