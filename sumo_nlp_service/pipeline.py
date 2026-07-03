import json
import re
import os
from typing import Any

import ollama_client
import vocab

_SUMO_TERMS_PATH = os.environ.get(
	"SUMO_INDEX_PATH",
	os.path.join(os.path.dirname(__file__), "..", "ontology", "sumo_index.json"),
)

_sumo_terms: list[str] = []

def _load_sumo_terms() -> list[str]:
	global _sumo_terms
	if _sumo_terms:
		return _sumo_terms
	with open(_SUMO_TERMS_PATH) as f:
		idx = json.load(f)
	_sumo_terms = sorted(set(e["localName"] for e in idx))
	return _sumo_terms

SYSTEM_PROMPT = """You are a SUMO (Suggested Upper Merged Ontology) expert. Given input text, extract SUMO ontological tags and generate SUO-KIF logical formulas.

SUMO is a formal ontology covering concepts like: Human, Animal, Object, Process, Action, Event, Place, Organization, Artifact, Motion, Communication, etc.

Rules:
- Return ONLY valid JSON (no markdown, no explanation)
- sumo_tags: list of SUMO concept names from the provided SUMO term list
- kif: SUO-KIF logical formula string (use exists, and, instance, subclass, etc.)
- confidence: 0.0-1.0

Example input: "John drove a car to the store."
Example output:
{"sumo_tags": ["Human", "Driving", "Automobile", "CommercialAgent"], "kif": "(exists (?john ?car ?store) (and (instance ?john Human) (instance ?car Automobile) (instance ?store CommercialAgent) (instance ?driving Driving) (agent ?driving ?john) (patient ?driving ?car)))", "confidence": 0.85}"""

def _build_prompt(text: str, known_words: list[str], sumo_terms: list[str]) -> str:
	# Provide a relevant subset of SUMO terms based on text keywords
	text_lower = text.lower()
	terms_subset = [t for t in sumo_terms if t.lower() in text_lower]
	if len(terms_subset) < 20:
		terms_subset += sumo_terms[:50]
	terms_str = ", ".join(sorted(set(terms_subset))[:60])

	vocab_hint = f"\nKnown SUMO-vocabulary words in text: {', '.join(known_words)}" if known_words else ""

	return f"""Available SUMO terms (subset): {terms_str}
{vocab_hint}

Input text: {text}

Return JSON only:"""

def analyze(text: str) -> dict[str, Any]:
	sumo_terms = _load_sumo_terms()
	known_words = vocab.get_known_words(text)

	prompt = _build_prompt(text, known_words, sumo_terms)
	raw = ollama_client.generate(prompt, system=SYSTEM_PROMPT)

	# Extract JSON from response
	result = _parse_json(raw)
	result["known_vocab_words"] = known_words
	result["raw_response"] = raw
	return result

def _parse_json(raw: str) -> dict[str, Any]:
	# Try direct parse first
	try:
		return json.loads(raw)
	except json.JSONDecodeError:
		pass

	# Extract JSON block from response
	match = re.search(r'\{[^{}]*\}', raw, re.DOTALL)
	if match:
		try:
			return json.loads(match.group())
		except json.JSONDecodeError:
			pass

	# Fallback: extract sumo_tags from raw text
	tags = re.findall(r'"([A-Z][a-zA-Z]+)"', raw)
	sumo_terms_set = set(_load_sumo_terms())
	valid_tags = [t for t in tags if t in sumo_terms_set]
	return {
		"sumo_tags": valid_tags,
		"kif": "",
		"confidence": 0.0,
		"parse_error": "Could not parse JSON from model response",
	}
