"""Shared LightRAG instance factory wired to the same Gemini models OHARA uses
(src/llm.js: gemini-2.5-flash-lite for LLM, gemini-embedding-2 @768d for embeddings).
Same models on both sides isolates the architecture comparison from model-quality confounds.
"""
import asyncio
import os
import numpy as np
from google import genai
from google.genai import types
from lightrag import LightRAG
from lightrag.llm.gemini import gemini_model_complete
from lightrag.utils import EmbeddingFunc

LLM_MODEL = os.environ.get("LLM_MODEL_NAME", "gemini-2.5-flash-lite")
EMBEDDING_MODEL = os.environ.get("EMBEDDING_MODEL_NAME", "gemini-embedding-2")
EMBEDDING_DIM = int(os.environ.get("EMBEDDING_DIM", "768"))

_client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])


async def _safe_embed(texts, context="document", embedding_dim=None, **_):
    # LightRAG's built-in gemini_embed batches contents=texts in one call, but the
    # Gemini API doesn't actually batch that way (silently returns fewer vectors than
    # inputs). OHARA's own src/llm.js never batches either — one embedContent call per
    # text (contents=[text]). Match that proven pattern for a 1:1 input:output guarantee.
    task_type = "RETRIEVAL_QUERY" if context == "query" else "RETRIEVAL_DOCUMENT"

    async def embed_one(text):
        text = text if text and text.strip() else "(empty)"
        resp = await _client.aio.models.embed_content(
            model=EMBEDDING_MODEL,
            contents=[text],
            config=types.EmbedContentConfig(
                task_type=task_type, output_dimensionality=embedding_dim or EMBEDDING_DIM
            ),
        )
        return np.array(resp.embeddings[0].values, dtype=np.float32)

    vecs = await asyncio.gather(*(embed_one(t) for t in texts))
    return np.stack(vecs)


embedding_func = EmbeddingFunc(
    embedding_dim=EMBEDDING_DIM,
    max_token_size=2048,
    func=_safe_embed,
    model_name=EMBEDDING_MODEL,
    supports_asymmetric=True,
)


def make_rag(working_dir: str) -> LightRAG:
    return LightRAG(
        working_dir=working_dir,
        llm_model_func=gemini_model_complete,
        llm_model_name=LLM_MODEL,
        embedding_func=embedding_func,
    )
