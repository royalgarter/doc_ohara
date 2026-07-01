import { GoogleGenAI } from '@google/genai';
import { cacheKeyFor, readCacheAsync, writeCacheAsync, credFingerprint } from './cache.js';

const PROVIDER = process.env.LLM_PROVIDER || 'gemini';
const DEFAULT_MODEL = process.env.LLM_MODEL || 'gemma-4-26b-a4b-it';
const DEFAULT_EMBEDDING_MODEL = process.env.LLM_EMBEDDING_MODEL || 'gemini-embedding-2';
const CF_WORKERS_FALLBACK_MODEL = process.env.CF_WORKERS_MODEL || '@cf/zai-org/glm-4.7-flash';

// Errors from Gemini that warrant a fallback attempt
const GEMINI_FALLBACK_CODES = new Set([503, 429, 500]);
function _isGeminiFallbackError(err) {
	const msg = err?.message || '';
	return GEMINI_FALLBACK_CODES.has(err?.status) ||
		/503|429|unavailable|resource.?exhausted|rate.?limit|overloaded/i.test(msg);
}

let _geminiAI = null;
function _getGeminiAI() {
	if (!_geminiAI) {
		_geminiAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
	}
	return _geminiAI;
}

async function _callGemini(prompt, { model, systemPrompt, json, ...extraConfig } = {}) {
	const ai = _getGeminiAI();
	const resolvedModel = model || DEFAULT_MODEL;
	const config = { serviceTier: 'flex', ...extraConfig };
	if (json) config.responseMimeType = 'application/json';
	console.log(`[llm] gemini • model=${resolvedModel} • json=${!!json} • tier=${config.serviceTier}`);

	const contents = systemPrompt
		? [{ role: 'user', parts: [{ text: `${systemPrompt}\n\n${prompt}` }] }]
		: prompt;

	const result = await ai.models.generateContent({ model: resolvedModel, contents, config });
	const text = result.text?.trim() || '';
	if (json) return JSON.parse(text);
	return text;
}

function _cfGatewayUrl() {
	const accountId = process.env.CF_ACCOUNT_ID;
	const gatewayId = process.env.CF_GATEWAY_ID;
	if (!accountId || !gatewayId) throw new Error('CF_ACCOUNT_ID and CF_GATEWAY_ID must be set for cloudflare provider');
	return `https://gateway.ai.cloudflare.com/v1/${accountId}/${gatewayId}/openai/chat/completions`;
}

async function _callCloudflare(prompt, { model, systemPrompt, json } = {}) {
	const resolvedModel = model || DEFAULT_MODEL;
	console.log(`[llm] cloudflare-gateway • model=${resolvedModel} • json=${!!json}`);
	const messages = [];
	if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
	messages.push({ role: 'user', content: prompt });

	const body = { model: resolvedModel, messages };
	if (json) body.response_format = { type: 'json_object' };

	const resp = await fetch(_cfGatewayUrl(), {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'Authorization': `Bearer ${process.env.CF_GATEWAY_TOKEN}`,
		},
		body: JSON.stringify(body),
	});
	if (!resp.ok) {
		const errText = await resp.text();
		throw new Error(`Cloudflare AI Gateway error ${resp.status}: ${errText}`);
	}
	const data = await resp.json();
	const text = data.choices?.[0]?.message?.content?.trim() || '';
	if (json) return JSON.parse(text);
	return text;
}

// Cloudflare Workers AI — direct API (CF_ACCOUNT_ID + CF_API_TOKEN required)
// Used as Gemini fallback; model default: @cf/zai-org/glm-4.7-flash
async function _callCFWorkersAI(prompt, { model, systemPrompt, json } = {}) {
	const accountId = process.env.CF_ACCOUNT_ID;
	const token = process.env.CF_API_TOKEN;
	if (!accountId || !token) throw new Error('CF_ACCOUNT_ID and CF_API_TOKEN must be set for Workers AI fallback');

	const resolvedModel = model || CF_WORKERS_FALLBACK_MODEL;
	console.log(`[llm] cf-workers • model=${resolvedModel} • json=${!!json}`);
	const messages = [];
	if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
	messages.push({ role: 'user', content: typeof prompt === 'string' ? prompt : JSON.stringify(prompt) });

	const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${resolvedModel}`;
	const resp = await fetch(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
		body: JSON.stringify({ messages }),
	});
	if (!resp.ok) {
		const errText = await resp.text();
		throw new Error(`CF Workers AI error ${resp.status}: ${errText}`);
	}
	const data = await resp.json();
	if (!data.success) throw new Error(`CF Workers AI failed: ${JSON.stringify(data.errors)}`);
	const text = (data.result?.response ?? '').trim();
	if (json) return JSON.parse(text);
	return text;
}

/**
 * Generate text from a prompt, with automatic disk+DB caching.
 * Pass cache: false to skip cache lookup/write.
 * Extra keys (e.g. temperature, maxOutputTokens, serviceTier) forwarded to Gemini config.
 */
async function _callPrimary(prompt, { model, systemPrompt, json, ...extraConfig } = {}) {
	if (PROVIDER === 'cloudflare') return _callCloudflare(prompt, { model, systemPrompt, json });
	if (PROVIDER === 'cf-workers') return _callCFWorkersAI(prompt, { model, systemPrompt, json });
	return _callGemini(prompt, { model, systemPrompt, json, ...extraConfig });
}

export async function callLLM(prompt, { model, systemPrompt, json, cache = true, ...extraConfig } = {}) {
	const resolvedModel = model || DEFAULT_MODEL;

	const invoke = async () => {
		try {
			return await _callPrimary(prompt, { model: resolvedModel, systemPrompt, json, ...extraConfig });
		} catch (err) {
			// Fallback to CF Workers AI when Gemini is overloaded/rate-limited
			if (PROVIDER === 'gemini' && _isGeminiFallbackError(err) && process.env.CF_API_TOKEN) {
				console.error(`[llm] Gemini error (${err.message}) — falling back to CF Workers AI`);
				return _callCFWorkersAI(prompt, { systemPrompt, json });
			}
			throw err;
		}
	};

	if (cache) {
		const key = cacheKeyFor([PROVIDER, resolvedModel, credFingerprint(), systemPrompt || '', prompt, json ? 'json' : '']);
		const cached = await readCacheAsync(key);
		if (cached?.result !== undefined) {
			console.log(`[llm] cache-hit • provider=${PROVIDER} • model=${resolvedModel}`);
			return cached.result;
		}
		const result = await invoke();
		await writeCacheAsync(key, { result });
		return result;
	}

	console.log(`[llm] no-cache • provider=${PROVIDER} • model=${resolvedModel}`);
	return invoke();
}

/**
 * Create a Gemini server-side CachedContent for a large repeated system prompt.
 * Returns the cache name (e.g. "cachedContents/abc123") — pass to callLLMWithCache.
 * Minimum ~32K tokens required. Gemini provider only.
 *
 * @param {string} systemPrompt - Large system prompt to cache server-side
 * @param {object} opts
 * @param {string} [opts.model] - Gemini model ID
 * @param {number} [opts.ttlSeconds=300] - Cache TTL in seconds
 */
export async function createGeminiCache(systemPrompt, { model, ttlSeconds = 300 } = {}) {
	if (PROVIDER !== 'gemini') throw new Error('createGeminiCache requires LLM_PROVIDER=gemini');
	const ai = _getGeminiAI();
	const resolvedModel = model || DEFAULT_MODEL;
	const cache = await ai.caches.create({
		model: resolvedModel,
		config: {
			systemInstruction: systemPrompt,
			ttl: `${ttlSeconds}s`,
		},
	});
	return cache.name;
}

/**
 * Call Gemini using a pre-created CachedContent (server-side prefix cache).
 * Pass cache: false to skip disk/DB response cache lookup.
 */
export async function callLLMWithCache(cachedContentName, prompt, { model, json, cache = true, ...extraConfig } = {}) {
	if (PROVIDER !== 'gemini') throw new Error('callLLMWithCache requires LLM_PROVIDER=gemini');
	const ai = _getGeminiAI();
	const resolvedModel = model || DEFAULT_MODEL;

	if (cache) {
		const key = cacheKeyFor(['gemini-cached', resolvedModel, credFingerprint(), cachedContentName, prompt, json ? 'json' : '']);
		const cached = await readCacheAsync(key);
		if (cached?.result !== undefined) {
			console.log(`[llm] cache-hit • provider=gemini-cached • model=${resolvedModel}`);
			return cached.result;
		}

		const config = { serviceTier: 'flex', ...extraConfig };
		if (json) config.responseMimeType = 'application/json';
		console.log(`[llm] gemini-cached • model=${resolvedModel} • json=${!!json} • cache=${cachedContentName.slice(-12)}`);
		const result_obj = await ai.models.generateContent({
			model: resolvedModel,
			contents: prompt,
			config: { ...config, cachedContent: cachedContentName },
		});
		const text = result_obj.text?.trim() || '';
		const result = json ? JSON.parse(text) : text;
		await writeCacheAsync(key, { result });
		return result;
	}

	const config = { serviceTier: 'flex', ...extraConfig };
	if (json) config.responseMimeType = 'application/json';
	console.log(`[llm] gemini-cached (no-diskcache) • model=${resolvedModel} • json=${!!json} • cache=${cachedContentName.slice(-12)}`);
	const result_obj = await ai.models.generateContent({
		model: resolvedModel,
		contents: prompt,
		config: { ...config, cachedContent: cachedContentName },
	});
	const text = result_obj.text?.trim() || '';
	return json ? JSON.parse(text) : text;
}

/**
 * Generate embeddings. Gemini only — cloudflare provider throws.
 */
export async function callEmbedding(text, { model, cache = true } = {}) {
	if (PROVIDER !== 'gemini') {
		throw new Error(`Provider '${PROVIDER}' does not support embeddings. Set LLM_PROVIDER=gemini.`);
	}
	const ai = _getGeminiAI();
	const resolvedModel = model || DEFAULT_EMBEDDING_MODEL;

	if (cache) {
		const key = cacheKeyFor(['embedding', resolvedModel, credFingerprint(), text]);
		const cached = await readCacheAsync(key);
		if (cached?.result !== undefined) return cached.result;

		const resp = await ai.models.embedContent({
			model: resolvedModel,
			contents: [text],
			config: { taskType: 'RETRIEVAL_DOCUMENT' },
		});
		const vec = resp.embeddings?.[0]?.values;
		if (!vec) throw new Error('No embedding returned from Gemini');
		await writeCacheAsync(key, { result: vec });
		return vec;
	}

	const resp = await ai.models.embedContent({
		model: resolvedModel,
		contents: [text],
		config: { taskType: 'RETRIEVAL_DOCUMENT' },
	});
	const vec = resp.embeddings?.[0]?.values;
	if (!vec) throw new Error('No embedding returned from Gemini');
	return vec;
}
