import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { loadEnvFromDB } from '../src/db/env.js';

const GEMINI_MODELS = ['gemma-4-26b-a4b-it', 'gemini-2.5-flash-lite'];
const CF_WORKERS_MODELS = ['@cf/zai-org/glm-4.7-flash'];

const PROMPT = 'Respond with exactly one word: OK';
const JSON_PROMPT = 'Respond with a JSON object with exactly one key "status" set to "ok". No other text.';

describe('LLM models', () => {
	before(async () => {
		if (process.env.ARANGO_URL) {
			const count = await loadEnvFromDB();
			console.log(`  Loaded ${count} env vars from DB`);
		}
	});

	async function callViaGemini(model, prompt, opts = {}) {
		const { GoogleGenAI } = await import('@google/genai');
		const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
		const config = { serviceTier: 'flex', ...opts };
		const result = await ai.models.generateContent({ model, contents: prompt, config });
		return result.text?.trim() || '';
	}

	async function callViaCFWorkers(model, prompt) {
		const accountId = process.env.CF_ACCOUNT_ID;
		const token = process.env.CF_API_TOKEN;
		if (!accountId || !token) throw new Error('CF_ACCOUNT_ID and CF_API_TOKEN required');
		const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`;
		const resp = await fetch(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
			body: JSON.stringify({ messages: [{ role: 'user', content: prompt }] }),
		});
		if (!resp.ok) {
			const errText = await resp.text();
			throw new Error(`CF Workers AI error ${resp.status}: ${errText}`);
		}
		const data = await resp.json();
		if (!data.success) throw new Error(`CF Workers AI failed: ${JSON.stringify(data.errors)}`);
		return (data.result?.response ?? '').trim();
	}

	for (const model of GEMINI_MODELS) {
		test(`${model} — plain text`, async () => {
			const text = await callViaGemini(model, PROMPT);
			assert.ok(text.length > 0, 'should return non-empty text');
			console.log(`  [gemini:${model}] plain text → "${text.slice(0, 80)}"`);
		});

		test(`${model} — JSON mode`, async () => {
			const text = await callViaGemini(model, JSON_PROMPT, { responseMimeType: 'application/json' });
			const parsed = JSON.parse(text);
			assert.ok(typeof parsed === 'object', 'should return valid JSON object');
			console.log(`  [gemini:${model}] JSON mode → ${JSON.stringify(parsed)}`);
		});
	}

	for (const model of CF_WORKERS_MODELS) {
		test(`${model} — plain text`, async () => {
			const text = await callViaCFWorkers(model, PROMPT);
			assert.ok(text.length > 0, `should return non-empty text, got: "${text}"`);
			console.log(`  [cf-workers:${model}] plain text → "${text.slice(0, 80)}"`);
		});
	}

	test('callLLM (gemini provider) — default model', async () => {
		const saved = process.env.LLM_PROVIDER;
		process.env.LLM_PROVIDER = 'gemini';
		try {
			const { callLLM } = await import('../src/llm.js');
			const result = await callLLM(PROMPT, { cache: false });
			assert.ok(typeof result === 'string', 'callLLM should return a string');
			assert.ok(result.length > 0, 'result should not be empty');
			console.log(`  [callLLM:gemini:default] → "${result.slice(0, 80)}"`);
		} finally {
			process.env.LLM_PROVIDER = saved;
		}
	});

	test('callLLM (cloudflare provider) — through gateway', async () => {
		const saved = process.env.LLM_PROVIDER;
		process.env.LLM_PROVIDER = 'cloudflare';
		try {
			const { callLLM } = await import('../src/llm.js');
			const result = await callLLM(PROMPT, { cache: false });
			assert.ok(typeof result === 'string', 'callLLM should return a string');
			assert.ok(result.length > 0, 'result should not be empty');
			console.log(`  [callLLM:cloudflare:default] → "${result.slice(0, 80)}"`);
		} finally {
			process.env.LLM_PROVIDER = saved;
		}
	});

	test('callLLM (cf-workers provider) — direct Workers AI', async () => {
		const saved = process.env.LLM_PROVIDER;
		process.env.LLM_PROVIDER = 'cf-workers';
		try {
			const { callLLM } = await import('../src/llm.js');
			const result = await callLLM(PROMPT, { cache: false });
			assert.ok(typeof result === 'string', 'callLLM should return a string');
			assert.ok(result.length > 0, 'result should not be empty');
			console.log(`  [callLLM:cf-workers:default] → "${result.slice(0, 80)}"`);
		} finally {
			process.env.LLM_PROVIDER = saved;
		}
	});
});
