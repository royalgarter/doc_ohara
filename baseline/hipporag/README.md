# HippoRAG baseline

Repo: https://github.com/OSU-NLP-Group/HippoRAG (NeurIPS'24 / ICML'25 for v2)

## Install

```sh
cd baseline/hipporag
python3 -m venv .venv
source .venv/bin/activate
pip install hipporag   # PyPI route, current repo recommends Python 3.10
cp .env.example .env   # fill OPENAI_API_KEY
```

Requirements: Python 3.10 (repo-recommended; pin venv explicitly — system python here is 3.14,
too new for the pinned NeurIPS'24 requirements.txt route if that's used instead of PyPI).
No GPU required for OpenAI-API mode; only needed for local HF embedding models.

## Ingest

Same corpus source as LightRAG baseline — reuse `doc_pipeline/input/qasper_*.md` and
`doc_pipeline/input/mhrag_*.md`, do not re-derive.

```sh
python ingest.py --corpus qasper    # smoke test first
python ingest.py --corpus multihop  # only after cost check
```

## Query + score

```sh
python query.py --input ../../eval/qasper_queries.json --out results_qasper.json
python query.py --input ../../eval/multihop_queries.json --out results_multihop.json
```

Output shape must match `tests/eval/run_matrix.js`'s per-query top-k format for reused scoring.

## Status

- [ ] venv (python 3.10) + pip install verified
- [ ] .env configured
- [ ] ingest.py written (wraps HippoRAG's indexing API over doc_pipeline/input/*.md)
- [ ] query.py written (wraps HippoRAG's retrieve API, outputs matrix-compatible JSON)
- [ ] QASPER smoke run (cost check — OpenIE extraction pass is the expensive step)
- [ ] QASPER full run
- [ ] MultiHop full run (only if QASPER cost was reasonable)
