# LightRAG baseline

Repo: https://github.com/HKUDS/LightRAG (EMNLP 2025)

## Install

```sh
cd baseline/lightrag
python3 -m venv .venv
source .venv/bin/activate
pip install -e "lightrag-hku[api]"
cp .env.example .env   # fill OPENAI_API_KEY (or point LLM_BINDING=ollama for local)
```

Requirements: Python 3.8+, ~5GB disk for API mode. No GPU needed if using OpenAI/Gemini API
(match embedding model to what's cheap — don't need to match OHARA's gemini-embedding-2 exactly,
just document whichever is used for the paper's methodology section).

## Ingest

Point at the same raw corpus markdown OHARA already ingested (`doc_pipeline/input/qasper_*.md`,
`doc_pipeline/input/mhrag_*.md`) — same source text, fair comparison. Do NOT re-derive corpus text.

```sh
python ingest.py --corpus qasper    # smoke test first, ~200 docs
python ingest.py --corpus multihop  # only after QASPER cost looks sane
```

## Query + score

```sh
python query.py --input ../../eval/qasper_queries.json --out results_qasper.json
python query.py --input ../../eval/multihop_queries.json --out results_multihop.json
```

`query.py` must output the same per-query top-k shape as `tests/eval/run_matrix.js` so
`tests/eval/run_matrix.js`'s scoring logic can be reused/adapted rather than reimplemented.

## Status

- [ ] venv + pip install verified
- [ ] .env configured
- [ ] ingest.py written (wraps LightRAG's `insert()` API over doc_pipeline/input/*.md)
- [ ] query.py written (wraps LightRAG's `query()` API, mode=hybrid, outputs matrix-compatible JSON)
- [ ] QASPER smoke run (cost check before full run)
- [ ] QASPER full run
- [ ] MultiHop full run (only if QASPER cost was reasonable)
