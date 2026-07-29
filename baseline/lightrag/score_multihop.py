"""Score LightRAG MultiHop-RAG results against gold answers.
OHARA's own convention (tests/eval/run_matrix.js makeDocMatcher) scores
doc-level hits: is a gold source article among the retrieved nodes.
LightRAG's context is an unranked text blob with no document ids, so a
doc-level match isn't directly computable here. Instead we use answer-string
presence in the context blob (query.py's --input mapping happens to place
the query's short gold answer, e.g. "Google", into `gold_evidence_text`) as
a standard RAG recall proxy: did the retrieved context contain the literal
answer text. This is a different, weaker-guarantee metric than OHARA's
doc-level Hits@10 — caveat accordingly in any write-up.
"""
import argparse
import json
import re


def norm_text(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "")).strip().lower()


def is_hit(answer: str, context: str) -> bool:
    content = norm_text(context)
    ans = norm_text(answer)
    if not content or not ans or len(ans) < 2:
        return False
    return ans in content


def main(results_path: str, out_path: str):
    results = json.load(open(results_path))
    n = len(results)
    hits = 0
    per_q = []
    by_type = {}
    for r in results:
        answer = r.get("gold_evidence_text") or ""
        ctx = r.get("retrieved_context") or ""
        hit = is_hit(answer, ctx)
        hits += hit
        qtype = r.get("question_type", "unknown")
        by_type.setdefault(qtype, {"n": 0, "hits": 0})
        by_type[qtype]["n"] += 1
        by_type[qtype]["hits"] += hit
        per_q.append({"id": r["id"], "hit": hit, "question_type": qtype, "answer": answer})

    by_type_summary = {
        t: {"n": v["n"], "hits": v["hits"], "hit_rate": round(v["hits"] / v["n"], 4) if v["n"] else 0}
        for t, v in by_type.items()
    }

    summary = {
        "dataset": "multihop",
        "system": "lightrag+gemini",
        "n_queries": n,
        "hits": hits,
        "hit_rate": round(hits / n, 4) if n else 0,
        "by_type": by_type_summary,
        "per_query": per_q,
    }
    json.dump(summary, open(out_path, "w"), indent=2)
    print(f"Hit rate: {hits}/{n} = {summary['hit_rate']*100:.1f}%")
    for t, v in by_type_summary.items():
        print(f"  {t}: {v['hits']}/{v['n']} = {v['hit_rate']*100:.1f}%")
    print(f"Wrote {out_path}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", default="results_multihop.json")
    ap.add_argument("--out", default="score_multihop.json")
    args = ap.parse_args()
    main(args.input, args.out)
