#!/usr/bin/env bash
# Download eval datasets (MultiHop-RAG + QASPER). Idempotent — skips existing files.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p data/multihop data/qasper

# media.githubusercontent.com resolves Git-LFS pointers (raw.githubusercontent returns 132-byte stubs)
MH_BASE="https://media.githubusercontent.com/media/yixuantt/MultiHop-RAG/main/dataset"
[ -f data/multihop/corpus.json ]      || curl -fL "$MH_BASE/corpus.json"      -o data/multihop/corpus.json
[ -f data/multihop/MultiHopRAG.json ] || curl -fL "$MH_BASE/MultiHopRAG.json" -o data/multihop/MultiHopRAG.json

QASPER_URL="https://qasper-dataset.s3.us-west-2.amazonaws.com/qasper-train-dev-v0.3.tgz"
if [ ! -f data/qasper/qasper-dev-v0.3.json ]; then
	curl -fL "$QASPER_URL" -o data/qasper/qasper.tgz
	tar -xzf data/qasper/qasper.tgz -C data/qasper
	rm data/qasper/qasper.tgz
fi

echo "── downloaded ──"
ls -lh data/multihop data/qasper
