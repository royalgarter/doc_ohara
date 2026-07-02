#!/usr/bin/env node
/**
 * Generate ground-truth Q&A pairs for OHARA retrieval evaluation.
 *
 * For each sampled paragraph, Gemini generates one factual question that
 * can ONLY be answered by retrieving that specific paragraph. The source
 * paragraph _id becomes ground_truth_para_id for Recall@k / MRR scoring.
 *
 * Stratified sampling: up to ceil(count/docCount) paragraphs per document
 * so the eval set covers all ingested docs, not just one large book.
 *
 * Cache: Gemini calls are cached by paragraph content - reruns are free.
 *
 * Usage:
 *   node scripts/generate_eval_set.js                         # 100 pairs → eval/eval_set.json
 *   node scripts/generate_eval_set.js --count=50              # smaller set
 *   node scripts/generate_eval_set.js --output=eval/my.json   # custom output path
 *   node scripts/generate_eval_set.js --dry-run               # print sample paragraphs, no Gemini
 */

import fs from 'node:fs';
import path from 'node:path';
import { initArangoClient } from '../src/db/client.js';
import { cacheKeyFor, readCacheSync, writeCacheSync } from '../src/cache.js';
import { GoogleGenAI } from '@google/genai';

const COUNT = parseInt((process.argv.find(a => a.startsWith('--count='))?.split('=')[1]) || '100', 10);
const OUTPUT = process.argv.find(a => a.startsWith('--output='))?.split('=')[1] || 'eval/eval_set.json';
const DRY_RUN = process.argv.includes('--dry-run');
const CONCURRENCY = 6;
const MIN_CHARS = 150;
const GEMINI_MODEL = 'gemini-2.5-flash-lite';

const GENERATION_PROMPT = `You are building a retrieval evaluation dataset.

Given a passage from a document, generate ONE factual question (≤15 words) that:
- Can ONLY be answered by reading this specific passage
- Asks about a specific fact, number, name, definition, or relationship in the text
- Would NOT be answerable from general knowledge alone
- Is phrased as a user would naturally ask it

Output ONLY a JSON object, no markdown:
{"question": "...", "answer": "<direct answer from the passage, ≤30 words>"}

PASSAGE:
`;

async function generateQA(ai, para) {
	const key = cacheKeyFor(['eval_qa_v1', GEMINI_MODEL, para.content.slice(0, 2000)]);
	const cached = readCacheSync(key);
	if (cached?.question) return cached;

	const prompt = GENERATION_PROMPT + para.content.slice(0, 2000);
	try {
		const resp = await ai.models.generateContent({
			model: GEMINI_MODEL,
			contents: prompt,
			config: { serviceTier: 'flex', temperature: 0 },
		});
		const raw = (resp.text || '').replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
		const parsed = JSON.parse(raw);
		if (!parsed.question || !parsed.answer) return null;
		const result = {
			question: parsed.question.trim(),
			answer: parsed.answer.trim(),
		};
		writeCacheSync(key, result);
		return result;
	} catch (_) {
		return null;
	}
}

async function main() {
	if (!process.env.GEMINI_API_KEY && !DRY_RUN) throw new Error('GEMINI_API_KEY not set');
	const db = await initArangoClient();

	// Load all qualifying paragraphs with doc/section metadata
	console.log(`Loading paragraphs (min ${MIN_CHARS} chars)…`);
	const cursor = await db.query(`
		FOR p IN paragraphs
			FILTER LENGTH(p.content) >= ${MIN_CHARS}
			RETURN {
				_id: p._id,
				_key: p._key,
				content: p.content,
				document_id: p.document_id,
				section_id: p.section_id
			}
	`);
	const allParas = await cursor.all();
	console.log(`${allParas.length} qualifying paragraphs across all docs`);

	// Stratified sampling: group by document_id, pick proportionally
	const byDoc = new Map();
	for (const p of allParas) {
		const docId = p.document_id || 'unknown';
		if (!byDoc.has(docId)) byDoc.set(docId, []);
		byDoc.get(docId).push(p);
	}

	const docsCount = byDoc.size;
	const perDoc = Math.max(1, Math.ceil(COUNT / docsCount));
	const sampled = [];

	for (const [, paras] of byDoc) {
		// Pick longest paragraphs per doc (most factual content)
		const sorted = [...paras].sort((a, b) => b.content.length - a.content.length);
		sampled.push(...sorted.slice(0, perDoc));
		if (sampled.length >= COUNT * 1.5) break; // collect ~50% extra for dedup headroom
	}

	// Trim to COUNT
	const pool = sampled.slice(0, Math.min(sampled.length, COUNT * 2));
	console.log(`Sampled ${pool.length} paragraphs from ${docsCount} documents (target: ${COUNT})`);

	if (DRY_RUN) {
		console.log('\nSample paragraphs:');
		pool.slice(0, 3).forEach((p, i) => {
			console.log(`\n[${i + 1}] ${p._id}\n${p.content.slice(0, 200)}…`);
		});
		return;
	}

	const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

	// Generate Q&A pairs with concurrency
	const results = [];
	const seenQuestions = new Set();
	let processed = 0;
	let failed = 0;

	for (let i = 0; i < pool.length; i += CONCURRENCY) {
		const batch = pool.slice(i, i + CONCURRENCY);
		const batchResults = await Promise.all(batch.map(async (para) => {
			const qa = await generateQA(ai, para);
			processed++;
			if (processed % 20 === 0) console.log(`  ${processed}/${pool.length} processed, ${results.length} valid pairs`);
			if (!qa) { failed++; return null; }
			// Deduplicate by normalised question
			const norm = qa.question.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
			if (seenQuestions.has(norm)) return null;
			seenQuestions.add(norm);
			return { qa, para };
		}));

		for (const item of batchResults) {
			if (!item) continue;
			results.push({
				id: `eq_${String(results.length + 1).padStart(3, '0')}`,
				question: item.qa.question,
				answer: item.qa.answer,
				ground_truth_para_id: item.para._id,
				ground_truth_doc_id: item.para.document_id || null,
				ground_truth_section_id: item.para.section_id || null,
				generated_at: new Date().toISOString(),
			});
			if (results.length >= COUNT) break;
		}

		if (results.length >= COUNT) break;
	}

	console.log(`\nGenerated ${results.length} Q&A pairs (${failed} failed, ${processed - failed - results.length} deduped)`);

	// Write output
	const outPath = path.resolve(OUTPUT);
	fs.mkdirSync(path.dirname(outPath), { recursive: true });
	fs.writeFileSync(outPath, JSON.stringify(results, null, 2), 'utf8');
	console.log(`Written → ${outPath}`);
	console.log('\nSample:');
	results.slice(0, 3).forEach(r => console.log(`  [${r.id}] "${r.question}"\n        → ${r.ground_truth_para_id}`));
}

main().catch(err => { console.error(err.message); process.exit(1); });
