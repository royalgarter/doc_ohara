#!/bin/sh
set -e

echo "[sumo-api] Waiting for Ollama at ${OLLAMA_URL} ..."
until curl -sf "${OLLAMA_URL}/api/tags" > /dev/null; do
	sleep 3
done
echo "[sumo-api] Ollama ready."

echo "[sumo-api] Ensuring model ${OLLAMA_MODEL} is pulled ..."
curl -sf "${OLLAMA_URL}/api/pull" \
	-H "Content-Type: application/json" \
	-d "{\"name\": \"${OLLAMA_MODEL}\"}" \
	--max-time 600 > /dev/null
echo "[sumo-api] Model ready."

exec uvicorn api:app --host 0.0.0.0 --port 8765
