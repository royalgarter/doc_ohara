FROM python:3.10-slim

WORKDIR /app

# Install deps first (layer cache)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy service code
COPY api.py ollama_client.py pipeline.py vocab.py ./

# Copy data files baked into image
COPY vocabulary.db ./
COPY sumo_index.json ./

ENV SUMO_INDEX_PATH=/app/sumo_index.json
ENV OLLAMA_URL=http://ollama:11434
ENV OLLAMA_MODEL=gemma3:4b-it-qat

COPY docker-entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh && apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*

EXPOSE 8765

ENTRYPOINT ["/entrypoint.sh"]
