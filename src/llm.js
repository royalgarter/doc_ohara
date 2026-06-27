// Thin LLM abstraction supporting Gemini (default) and OpenRouter.
// Callers handle caching; this module stays stateless.

import { GoogleGenAI } from '@google/genai';

const PROVIDER = process.env.LLM_PROVIDER || 'gemini';
const DEFAULT_MODEL = process.env.LLM_MODEL || 'gemini-2.5-flash-lite-preview-06-17';
const DEFAULT_EMBEDDING_MODEL = process.env.LLM_EMBEDDING_MODEL || 'gemini-embedding-exp-03-07';

let _geminiAI = null;
function _getGeminiAI() {
	if (!_geminiAI) {
		_geminiAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
	}
	return _geminiAI;
}

async function _callGemini(prompt, { model, systemPrompt, json } = {}) {
	const ai = _getGeminiAI();
	const resolvedModel = model || DEFAULT_MODEL;
	const config = {};
	if (json) config.responseMimeType = 'application/json';

	const contents = systemPrompt
		? [{ role: 'user', parts: [{ text: `${systemPrompt}\n\n${prompt}` }] }]
		: prompt;

	const result = await ai.models.generateContent({
		model: resolvedModel,
		contents,
		config: { serviceTier: 'flex', ...config },
	});
	const text = result.text?.trim() || '';
	if (json) {
		return JSON.parse(text);
	}
	return text;
}

async function _callOpenRouter(prompt, { model, systemPrompt, json } = {}) {
	const resolvedModel = model || DEFAULT_MODEL;
	const messages = [];
	if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
	messages.push({ role: 'user', content: prompt });

	const body = { model: resolvedModel, messages };
	if (json) body.response_format = { type: 'json_object' };

	const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
		},
		body: JSON.stringify(body),
	});
	if (!resp.ok) {
		const errText = await resp.text();
		throw new Error(`OpenRouter error ${resp.status}: ${errText}`);
	}
	const data = await resp.json();
	const text = data.choices?.[0]?.message?.content?.trim() || '';
	if (json) {
		return JSON.parse(text);
	}
	return text;
}

// Generate text from a prompt.
// Returns: string (raw text) or parsed object if json=true
export async function callLLM(prompt, { model, systemPrompt, json } = {}) {
	if (PROVIDER === 'openrouter') {
		return _callOpenRouter(prompt, { model, systemPrompt, json });
	}
	return _callGemini(prompt, { model, systemPrompt, json });
}

// Generate embeddings for a text string.
// Returns: number[] (embedding vector)
export async function callEmbedding(text, { model } = {}) {
	if (PROVIDER === 'openrouter') {
		throw new Error('OpenRouter does not support embeddings. Set LLM_PROVIDER=gemini for embedding calls.');
	}
	const ai = _getGeminiAI();
	const resolvedModel = model || DEFAULT_EMBEDDING_MODEL;
	const resp = await ai.models.embedContent({
		model: resolvedModel,
		contents: [text],
		config: { taskType: 'RETRIEVAL_DOCUMENT' },
	});
	const vec = resp.embeddings?.[0]?.values;
	if (!vec) throw new Error('No embedding returned from Gemini');
	return vec;
}
