"""Ingest OHARA's already-prepared corpus markdown into LightRAG.
Reuses doc_pipeline/input/{qasper,mhrag}_*.md — same source text as OHARA's own ingest,
for a fair architecture-only comparison (see baseline/README.md).
"""
import argparse
import asyncio
import glob
import os

from lightrag.kg.shared_storage import initialize_pipeline_status
from rag_config import make_rag

CORPUS_ROOT = os.path.join(os.path.dirname(__file__), "..", "..", "doc_pipeline", "input")


async def main(corpus: str, working_dir: str, limit: int | None):
    pattern = {"qasper": "qasper_*.md", "multihop": "mhrag_*.md"}[corpus]
    files = sorted(glob.glob(os.path.join(CORPUS_ROOT, pattern)))
    if limit:
        files = files[:limit]
    print(f"Ingesting {len(files)} docs from {pattern} into {working_dir}")

    rag = make_rag(working_dir)
    await rag.initialize_storages()
    await initialize_pipeline_status()

    for i, path in enumerate(files, 1):
        text = open(path, encoding="utf-8").read()
        await rag.ainsert(text, file_paths=os.path.basename(path))
        print(f"[{i}/{len(files)}] {os.path.basename(path)}")

    await rag.finalize_storages()
    print("Done.")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--corpus", choices=["qasper", "multihop"], required=True)
    ap.add_argument("--working-dir", default=None)
    ap.add_argument("--limit", type=int, default=None, help="smoke test: only ingest N docs")
    args = ap.parse_args()
    working_dir = args.working_dir or f"./rag_storage_{args.corpus}"
    asyncio.run(main(args.corpus, working_dir, args.limit))
