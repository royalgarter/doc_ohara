from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Any
import ollama_client
import pipeline

app = FastAPI(title="SUMO NLP API", version="1.0.0")

class AnalyzeRequest(BaseModel):
	text: str

class AnalyzeResponse(BaseModel):
	text: str
	sumo_tags: list[str]
	kif: str
	confidence: float
	known_vocab_words: list[str]
	raw_response: str | None = None

@app.get("/health")
def health():
	ollama_ok = ollama_client.is_available()
	return {"status": "ok", "ollama": ollama_ok}

@app.post("/analyze", response_model=AnalyzeResponse)
def analyze(req: AnalyzeRequest):
	if not req.text.strip():
		raise HTTPException(status_code=400, detail="text is required")
	result = pipeline.analyze(req.text.strip())
	return AnalyzeResponse(
		text=req.text,
		sumo_tags=result.get("sumo_tags", []),
		kif=result.get("kif", ""),
		confidence=result.get("confidence", 0.0),
		known_vocab_words=result.get("known_vocab_words", []),
		raw_response=result.get("raw_response"),
	)

@app.get("/vocab/check")
def vocab_check(word: str):
	import vocab as v
	return {"word": word, "in_vocab": v.word_in_vocab(word)}
