// Shared helper utilities extracted from ingest.js and retrieval.js.
// Original files still contain these — this module re-exports them for callers
// that want a single import point.

// Remove \X escape sequences that are invalid in JSON (markdown escapes like \*, \_, \[, \(, etc.).
// Valid JSON escapes are: \" \\ \/ \b \f \n \r \t \uXXXX — everything else is illegal.
export function sanitizeJsonEscapes(s) {
	return s.replace(/\\([^"\\\/bfnrtu\n\r])/g, (_, ch) => ch);
}

// Helper: attempt to extract a JSON object from noisy LLM text outputs.
// Tries progressively more aggressive fixes before giving up.
export function safeParseJsonFromText(text) {
	const t = String(text || '').trim();

	// 1. direct parse
	try { return JSON.parse(t); } catch (_) {}

	// 2. strip markdown fences then try again
	let s = t.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
	try { return JSON.parse(s); } catch (_) {}

	// 3. sanitize invalid escape sequences (e.g. \* \_ from LLM markdown habits) then parse
	const sanitized = sanitizeJsonEscapes(s);
	try { return JSON.parse(sanitized); } catch (_) {}

	// 4. extract the outermost JSON object, sanitize, fix trailing commas
	const jsonBlockMatch = sanitized.match(/\{[\s\S]*\}/m);
	if (jsonBlockMatch) {
		const candidate = jsonBlockMatch[0];
		try { return JSON.parse(candidate); } catch (_) {}
		const fixed = candidate.replace(/,\s*([}\]])/g, '$1');
		try { return JSON.parse(fixed); } catch (_) {}
	}

	// 5. find a fenced ```json ... ``` block inside the text, sanitize, fix trailing commas
	const codeJson = s.match(/```json([\s\S]*?)```/i);
	if (codeJson && codeJson[1]) {
		const candidate = sanitizeJsonEscapes(codeJson[1].trim());
		try { return JSON.parse(candidate); } catch (_) {}
		const fixed = candidate.replace(/,\s*([}\]])/g, '$1');
		try { return JSON.parse(fixed); } catch (_) {}
	}

	throw new Error('Unable to extract valid JSON from LLM output');
}

// Normalise a LLM-returned date value to "YYYY-MM-DD" or "YYYY", or null.
export function _normaliseDate(val) {
	if (!val || typeof val !== 'string') return null;
	const s = val.trim();
	if (/^\d{4}$/.test(s)) return s;                      // bare year "1995"
	if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;          // full ISO date
	if (/^\d{4}-\d{2}$/.test(s)) return s + '-01';        // "YYYY-MM" → day 1
	return null;
}

// Convert a date string ("YYYY", "YYYY-MM-DD") to a JS Date or null.
export function _toDate(val) {
	if (!val) return null;
	const d = new Date(/^\d{4}$/.test(val) ? `${val}-01-01` : val);
	return isNaN(d.getTime()) ? null : d;
}
