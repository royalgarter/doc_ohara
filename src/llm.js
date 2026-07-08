import { GoogleGenAI } from '@google/genai';
import { cacheKeyFor, readCacheAsync, writeCacheAsync, credFingerprint } from './cache.js';

// Token usage accumulator - callers attach a handler via onTokenUsage()
let _tokenUsageHandler = null;
export function onTokenUsage(fn) { _tokenUsageHandler = fn; }
export function clearTokenUsageHandler() { _tokenUsageHandler = null; }

function _emitUsage(usageMeta, label) {
	if (!usageMeta) return;
	const u = {
		label,
		prompt:    usageMeta.promptTokenCount    ?? 0,
		output:    usageMeta.candidatesTokenCount ?? 0,
		cached:    usageMeta.cachedContentTokenCount ?? 0,
		thoughts:  usageMeta.thoughtsTokenCount   ?? 0,
		total:     usageMeta.totalTokenCount      ?? 0,
	};
	console.log(`[llm:tokens] ${label} • prompt=${u.prompt} output=${u.output} cached=${u.cached} thoughts=${u.thoughts} total=${u.total}`);
	if (_tokenUsageHandler) _tokenUsageHandler(u);
}

const PROVIDER = () => process.env.LLM_PROVIDER || 'gemini';
const DEFAULT_EMBEDDING_MODEL = process.env.LLM_EMBEDDING_MODEL || 'gemini-embedding-2';
const CF_WORKERS_FALLBACK_MODEL = process.env.CF_WORKERS_MODEL || '@cf/zai-org/glm-4.7-flash';

// Ordered model chain: LLM_MODELS (comma-separated) → LLM_MODEL → hardcoded default
// Each model is tried in order; if one fails with a retryable error, next is used.
function _modelChain() {
	const chain = process.env.LLM_MODELS || process.env.LLM_MODEL || 'gemini-2.5-flash-lite,gemini-2.5-flash';
	return chain.split(',').map(m => m.trim()).filter(Boolean);
}
const DEFAULT_MODEL = () => _modelChain()[0];

// Errors from Gemini that warrant a fallback attempt
const GEMINI_FALLBACK_CODES = new Set([503, 429, 500]);
function _isGeminiFallbackError(err) {
	const msg = err?.message || '';
	return GEMINI_FALLBACK_CODES.has(err?.status) ||
		/503|429|unavailable|resource.?exhausted|rate.?limit|overloaded|no longer available/i.test(msg);
}

function _getGeminiAI() {
	return new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
}

async function _callGemini(prompt, { model, systemPrompt, json, ...extraConfig } = {}) {
	const ai = _getGeminiAI();
	const resolvedModel = model || DEFAULT_MODEL();
	const config = { temperature: 0, serviceTier: 'flex', ...extraConfig };
	if (json) config.responseMimeType = 'application/json';
	console.log(`[llm] gemini • model=${resolvedModel} • json=${!!json} • tier=${config.serviceTier}`);

	const contents = systemPrompt
		? [{ role: 'user', parts: [{ text: `${systemPrompt}\n\n${prompt}` }] }]
		: prompt;

	const result = await ai.models.generateContent({ model: resolvedModel, contents, config });
	_emitUsage(result.usageMetadata, `gemini:${resolvedModel}`);
	const text = result.text?.trim() || '';
	if (json) return JSON.parse(text);
	return text;
}

function _cfGatewayUrl() {
	const accountId = process.env.CF_ACCOUNT_ID;
	if (!accountId) throw new Error('CF_ACCOUNT_ID must be set for cloudflare provider');
	return `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run`;
}

async function _callCloudflare(prompt, { model, systemPrompt, json } = {}) {
	const resolvedModel = model || DEFAULT_MODEL();
	const gatewayId = process.env.CF_GATEWAY_ID || 'ohara';
	const accountId = process.env.CF_ACCOUNT_ID;
	const token = process.env.CF_API_TOKEN;
	if (!token) throw new Error('CF_API_TOKEN must be set for cloudflare provider');
	if (!accountId) throw new Error('CF_ACCOUNT_ID must be set for cloudflare provider');

	console.log(`[llm] cloudflare-ai-gateway • model=${resolvedModel} • gateway=${gatewayId} • json=${!!json}`);

	const contents = [];
	if (systemPrompt) {
		contents.push({ role: 'user', parts: [{ text: systemPrompt }] });
	}
	contents.push({ role: 'user', parts: [{ text: prompt }] });

	const body = {
		model: resolvedModel,
		input: { contents, temperature: 0 }
	};

	const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run`;
	const headers = {
		'Content-Type': 'application/json',
		'Authorization': `Bearer ${token}`,
		'cf-aig-gateway-id': gatewayId,
	};
	// BYOK: pass provider API key so gateway doesn't bill from CF balance
	if (process.env.GEMINI_API_KEY) headers['x-goog-api-key'] = process.env.GEMINI_API_KEY;
	const resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
	if (!resp.ok) {
		const errText = await resp.text();
		throw new Error(`Cloudflare AI Gateway error ${resp.status}: ${errText}`);
	}
	const data = await resp.json();
	const text = data.result?.response?.trim?.() || data.result?.trim?.() || '';
	if (json) return JSON.parse(text);
	return text;
}

// Cloudflare Workers AI - direct API (CF_ACCOUNT_ID + CF_API_TOKEN required)
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
		body: JSON.stringify({ messages, temperature: 0 }),
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
 * Call Gemini via Cloudflare AI Gateway (BYOK). Uses CF as proxy, same model quality.
 * Falls back gracefully — if CF_ACCOUNT_ID/CF_API_TOKEN/GEMINI_API_KEY not set, throws.
 */
export async function callLLMCFGateway(prompt, { model, systemPrompt, json, serviceTier } = {}) {
	const accountId = process.env.CF_ACCOUNT_ID;
	const token = process.env.CF_API_TOKEN;
	const apiKey = process.env.GEMINI_API_KEY;
	if (!accountId || !token || !apiKey) throw new Error('CF_ACCOUNT_ID, CF_API_TOKEN and GEMINI_API_KEY required for CF Gateway');

	const gatewayId = process.env.CF_GATEWAY_ID || 'ohara';
	const resolvedModel = model || DEFAULT_MODEL();
	console.log(`[llm] cf-gateway→gemini • model=${resolvedModel} • gateway=${gatewayId} • tier=${serviceTier || 'flex'} • json=${!!json}`);

	const url = `https://gateway.ai.cloudflare.com/v1/${accountId}/${gatewayId}/google-ai-studio/v1beta/models/${resolvedModel}:generateContent`;
	const contents = systemPrompt
		? [{ role: 'user', parts: [{ text: `${systemPrompt}\n\n${prompt}` }] }]
		: [{ role: 'user', parts: [{ text: typeof prompt === 'string' ? prompt : JSON.stringify(prompt) }] }];
	const generationConfig = { temperature: 0 };
	if (json) generationConfig.responseMimeType = 'application/json';
	if (serviceTier) generationConfig.serviceTier = serviceTier;

	const resp = await fetch(url, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'Authorization': `Bearer ${token}`,
			'x-goog-api-key': apiKey,
		},
		body: JSON.stringify({ contents, generationConfig }),
	});
	if (!resp.ok) {
		const errText = await resp.text();
		throw new Error(`CF Gateway error ${resp.status}: ${errText}`);
	}
	const data = await resp.json();
	const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
	if (json) return JSON.parse(text);
	return text;
}

/**
 * Generate text from a prompt, with automatic disk+DB caching.
 * Pass cache: false to skip cache lookup/write.
 * Extra keys (e.g. temperature, maxOutputTokens, serviceTier) forwarded to Gemini config.
 */
async function _callPrimary(prompt, { model, systemPrompt, json, serviceTier, ...extraConfig } = {}) {
	if (PROVIDER() === 'cloudflare') return _callCloudflare(prompt, { model, systemPrompt, json });
	if (PROVIDER() === 'cf-workers') return _callCFWorkersAI(prompt, { model, systemPrompt, json });
	if (PROVIDER() === 'cf-gateway') return callLLMCFGateway(prompt, { model, systemPrompt, json, serviceTier });
	return _callGemini(prompt, { model, systemPrompt, json, serviceTier, ...extraConfig });
}

export async function callLLM(prompt, { model, systemPrompt, json, cache = true, ...extraConfig } = {}) {
	// If caller pinned a model, use only that. Otherwise walk the chain.
	const models = model ? [model] : _modelChain();

	const invoke = async () => {
		let lastErr;
		for (const m of models) {
			try {
				return await _callPrimary(prompt, { model: m, systemPrompt, json, ...extraConfig });
			} catch (err) {
				if (_isGeminiFallbackError(err)) {
					console.warn(`[llm] model=${m} failed (${err.message?.slice(0, 80)}) — trying next`);
					lastErr = err;
					continue;
				}
				throw err;
			}
		}
		// All Gemini models exhausted — try CF Workers AI if available (skip for JSON: GLM can't reliably produce JSON)
		if (PROVIDER() === 'gemini' && process.env.CF_API_TOKEN && !json) {
			console.warn(`[llm] all Gemini models exhausted — falling back to CF Workers AI`);
			return _callCFWorkersAI(prompt, { systemPrompt, json });
		}
		throw lastErr;
	};

	const resolvedModel = models[0];
	if (cache) {
		const key = cacheKeyFor([PROVIDER(), resolvedModel, credFingerprint(), systemPrompt || '', prompt, json ? 'json' : '']);
		const cached = await readCacheAsync(key);
		if (cached?.result !== undefined) {
			console.log(`[llm] cache-hit • provider=${PROVIDER()} • model=${resolvedModel}`);
			return cached.result;
		}
		const result = await invoke();
		await writeCacheAsync(key, { result });
		return result;
	}

	console.log(`[llm] no-cache • provider=${PROVIDER()} • model=${resolvedModel}`);
	return invoke();
}

/**
 * Create a Gemini server-side CachedContent for a large repeated system prompt.
 * Returns the cache name (e.g. "cachedContents/abc123") - pass to callLLMWithCache.
 * Minimum ~32K tokens required. Gemini provider only.
 *
 * @param {string} systemPrompt - Large system prompt to cache server-side
 * @param {object} opts
 * @param {string} [opts.model] - Gemini model ID
 * @param {number} [opts.ttlSeconds=300] - Cache TTL in seconds
 */
export async function createGeminiCache(systemPrompt, { model, ttlSeconds = 300 } = {}) {
	if (PROVIDER() !== 'gemini') throw new Error('createGeminiCache requires LLM_PROVIDER=gemini');
	const ai = _getGeminiAI();
	const resolvedModel = model || DEFAULT_MODEL();
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
	if (PROVIDER() !== 'gemini') throw new Error('callLLMWithCache requires LLM_PROVIDER=gemini');
	const ai = _getGeminiAI();
	const models = model ? [model] : _modelChain();
	const resolvedModel = models[0];

	const _invoke = async () => {
		let lastErr;
		for (const m of models) {
			try {
				const config = { temperature: 0, serviceTier: 'flex', ...extraConfig };
				if (json) config.responseMimeType = 'application/json';
				console.log(`[llm] gemini-cached (no-diskcache) • model=${m} • json=${!!json} • cache=${cachedContentName.slice(-12)}`);
				const result_obj = await ai.models.generateContent({
					model: m,
					contents: prompt,
					config: { ...config, cachedContent: cachedContentName },
				});
				_emitUsage(result_obj.usageMetadata, `gemini-cached:${m}`);
				const text = result_obj.text?.trim() || '';
				return json ? JSON.parse(text) : text;
			} catch (err) {
				if (_isGeminiFallbackError(err)) {
					console.warn(`[llm] gemini-cached model=${m} failed (${err.message?.slice(0, 80)}) — trying next`);
					lastErr = err;
					continue;
				}
				// CachedContent is model-locked — fall through to uncached call on next model
				if (/permission.denied|not found/i.test(err.message || '')) {
					console.warn(`[llm] gemini-cached model=${m} cache miss/locked — falling back to uncached`);
					return callLLM(prompt, { model: m, systemPrompt: undefined, json, cache: false, ...extraConfig });
				}
				throw err;
			}
		}
		// All cached attempts failed — retry without cache binding
		console.warn(`[llm] gemini-cached all models exhausted — retrying uncached`);
		return callLLM(prompt, { json, cache: false, ...extraConfig });
	};

	if (cache) {
		const key = cacheKeyFor(['gemini-cached', resolvedModel, credFingerprint(), cachedContentName, prompt, json ? 'json' : '']);
		const cached = await readCacheAsync(key);
		if (cached?.result !== undefined) {
			console.log(`[llm] cache-hit • provider=gemini-cached • model=${resolvedModel}`);
			return cached.result;
		}
		const result = await _invoke();
		await writeCacheAsync(key, { result });
		return result;
	}

	return _invoke();
}

/**
 * Generate embeddings. Gemini only - cloudflare provider throws.
 */
export async function callEmbedding(text, { model, cache = true } = {}) {
	if (PROVIDER() !== 'gemini') {
		throw new Error(`Provider '${PROVIDER()}' does not support embeddings. Set LLM_PROVIDER=gemini.`);
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
