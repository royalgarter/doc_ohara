"""Query LightRAG over an ingested corpus, output matrix-compatible per-query results.
Output shape mirrors tests/eval/run_matrix.js so scoring logic can be reused/adapted.
"""
import argparse
import asyncio
import json

from lightrag import QueryParam
from rag_config import make_rag


async def main(input_path: str, out_path: str, working_dir: str, limit: int | None):
    queries = json.load(open(input_path))
    if isinstance(queries, dict):
        queries = queries.get("queries", queries.get("items", []))
    if limit:
        queries = queries[:limit]

    rag = make_rag(working_dir)
    await rag.initialize_storages()

    results = []
    for i, q in enumerate(queries, 1):
        question = q.get("question") or q.get("query")
        resp = await rag.aquery(question, param=QueryParam(mode="hybrid", only_need_context=True))
        results.append({
            "id": q.get("id", i),
            "question": question,
            "gold_doc_titles": q.get("gold_doc_titles") or q.get("evidence_list"),
            "gold_evidence_text": q.get("gold_evidence_text") or q.get("gold") or q.get("answer"),
            "retrieved_context": resp,
        })
        print(f"[{i}/{len(queries)}] {question[:60]}")

    await rag.finalize_storages()
    json.dump(results, open(out_path, "w"), indent=2)
    print(f"Wrote {len(results)} results to {out_path}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--working-dir", default=None)
    ap.add_argument("--limit", type=int, default=None)
    args = ap.parse_args()
    corpus = "qasper" if "qasper" in args.input else "multihop"
    working_dir = args.working_dir or f"./rag_storage_{corpus}"
    asyncio.run(main(args.input, args.out, working_dir, args.limit))
