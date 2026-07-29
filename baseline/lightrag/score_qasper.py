"""Score LightRAG QASPER results against gold evidence.
Mirrors tests/eval/run_matrix.js QASPER hit def: normalized gold evidence
snippet (len>40) overlaps retrieved text if either containss the other's
first 200 chars. LightRAG's context blob isn't rank-ordered like OHARA's
per-doc results, so this yields a binary hit/miss per query (no MRR).
"""
import argparse
import json
import re


def norm_text(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "")).strip().lower()


def is_hit(evid_list, context: str) -> bool:
    content = norm_text(context)
    if not content:
        return False
    for e in evid_list:
        e = norm_text(e)
        if len(e) <= 40:
            continue
        if content[:200] in e or e[:200] in content:
            return True
    return False


def main(results_path: str, out_path: str):
    results = json.load(open(results_path))
    n = len(results)
    hits = 0
    per_q = []
    for r in results:
        evid = r.get("gold_evidence_text") or []
        if isinstance(evid, str):
            evid = [evid]
        ctx = r.get("retrieved_context") or ""
        hit = is_hit(evid, ctx)
        hits += hit
        per_q.append({"id": r["id"], "hit": hit, "gold_count": len(evid)})

    summary = {
        "dataset": "qasper",
        "system": "lightrag+gemini",
        "n_queries": n,
        "hits": hits,
        "hit_rate": round(hits / n, 4) if n else 0,
        "per_query": per_q,
    }
    json.dump(summary, open(out_path, "w"), indent=2)
    print(f"Hit rate: {hits}/{n} = {summary['hit_rate']*100:.1f}%")
    print(f"Wrote {out_path}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", default="results_qasper.json")
    ap.add_argument("--out", default="score_qasper.json")
    args = ap.parse_args()
    main(args.input, args.out)
