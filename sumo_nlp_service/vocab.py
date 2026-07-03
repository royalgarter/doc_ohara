import sqlite3
import re
import os

DB_PATH = os.path.join(os.path.dirname(__file__), "vocabulary.db")

_conn = None

def _get_conn():
	global _conn
	if _conn is None:
		_conn = sqlite3.connect(DB_PATH, check_same_thread=False)
	return _conn;

def get_known_words(text: str) -> list[str]:
	"""Return word roots from text that exist in SUMO vocabulary."""
	words = re.findall(r'\b[a-zA-Z]+\b', text.lower())
	if not words:
		return []
	conn = _get_conn()
	cur = conn.cursor()
	placeholders = ",".join("?" * len(words))
	cur.execute(f"SELECT DISTINCT root FROM Word WHERE root IN ({placeholders})", words)
	return [row[0] for row in cur.fetchall()]

def word_in_vocab(word: str) -> bool:
	conn = _get_conn()
	cur = conn.cursor()
	cur.execute("SELECT 1 FROM Word WHERE root = ? LIMIT 1", (word.lower(),))
	return cur.fetchone() is not None
