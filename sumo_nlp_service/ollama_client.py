import requests
import json
import os

OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434")
MODEL = os.getenv("OLLAMA_MODEL", "gemma3:4b-it-qat")

def generate(prompt: str, system: str = "", temperature: float = 0.1) -> str:
	payload = {
		"model": MODEL,
		"prompt": prompt,
		"stream": False,
		"options": {"temperature": temperature},
	}
	if system:
		payload["system"] = system
	resp = requests.post(f"{OLLAMA_URL}/api/generate", json=payload, timeout=300)
	resp.raise_for_status()
	return resp.json()["response"].strip()

def is_available() -> bool:
	try:
		r = requests.get(f"{OLLAMA_URL}/api/tags", timeout=5)
		return r.status_code == 200
	except Exception:
		return False
