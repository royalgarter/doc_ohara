#!/usr/bin/env node
/**
 * E4: ANSWERS_SAME edges — HopRAG-inspired logical co-relevance.
 *
 * For each paragraph (≥100 chars), Gemini generates 1-2 pseudo-questions
 * the paragraph answers. Paragraphs sharing a pseudo-question get
 * ANSWERS_SAME edges (bidirectional) with shared_query on the edge.
 *
 * Usage:
 *   node scripts/build_pseudo_query_edges.js --dry-run   # preview counts
 *   node scripts/build_pseudo_query_edges.js             # apply
 *   node scripts/build_pseudo_query_edges.js --limit 500 # cap paragraphs processed
 */

import { initArangoClient, insertEdge } from '../src/db/client.js';
import { cacheKeyFor, readCacheSync, writeCacheSync } from '../src/cache.js';
import { GoogleGenAI } from '@google/genai';

const DRY_RUN = process.argv.includes('--dry-run');
const LIMIT = parseInt((process.argv.find(a => a.startsWith('--limit='))?.split('=')[1]) || '0', 10) || null;
const CONCURRENCY = 8;
const MIN_CHARS = 100;
const GEMINI_MODEL = 'gemini-2.5-flash-lite';

async function generatePseudoQuestions(ai, content) {
	const key = cacheKeyFor(['pseudo_q_v1', GEMINI_MODEL, content.slice(0, 2000)]);
	const cached = readCacheSync(key);
	if (cached?.questions) return cached.questions;

	const prompt = `Generate 1-2 short questions (≤12 words each) that this passage directly answers. Output only a JSON array of strings, e.g. ["What is X?", "How does Y work?"]. No other text.\n\nPASSAGE:\n${content.slice(0, 1500)}`;
	try {
		const resp = await ai.models.generateContent({
			model: GEMINI_MODEL,
			contents: prompt,
			config: { serviceTier: 'flex', temperature: 0 },
		});
		const raw = (resp.text || '').replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
		const questions = JSON.parse(raw);
		if (!Array.isArray(questions)) return [];
		const result = questions.filter(q => typeof q === 'string' && q.trim()).slice(0, 2).map(q => q.trim().toLowerCase());
		writeCacheSync(key, { questions: result });
		return result;
	} catch (_) {
		return [];
	}
}

// Normalise question for dedup key: lowercase, strip punctuation, collapse spaces
function normQ(q) {
	return q.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}

async function runBatched(items, fn, concurrency) {
	for (let i = 0; i < items.length; i += concurrency) {
		await Promise.all(items.slice(i, i + concurrency).map(fn));
	}
}

async function main() {
	if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not set');
	const db = await initArangoClient();
	const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

	// Load all qualifying paragraphs
	const cursor = await db.query(
		`FOR p IN paragraphs FILTER LENGTH(p.content) >= ${MIN_CHARS} ${LIMIT ? `LIMIT ${LIMIT}` : ''} RETURN { _id: p._id, content: p.content }`
	);
	const paragraphs = await cursor.all();
	console.log(`Processing ${paragraphs.length} paragraphs…`);

	// question norm → [{paraId, original}]
	const questionIndex = new Map();
	let processed = 0;

	await runBatched(paragraphs, async (p) => {
		const questions = await generatePseudoQuestions(ai, p.content);
		for (const q of questions) {
			const norm = normQ(q);
			if (!norm) continue;
			if (!questionIndex.has(norm)) questionIndex.set(norm, []);
			questionIndex.get(norm).push({ paraId: p._id, original: q });
		}
		processed++;
		if (processed % 50 === 0) console.log(`  ${processed}/${paragraphs.length} done, ${questionIndex.size} unique questions`);
	}, CONCURRENCY);

	console.log(`Question index built: ${questionIndex.size} unique questions`);

	// Build edge pairs from shared questions
	let edgeCount = 0;
	let skipped = 0;
	for (const [norm, entries] of questionIndex) {
		if (entries.length < 2) continue;
		// All unique pairs sharing this question
		for (let i = 0; i < entries.length; i++) {
			for (let j = i + 1; j < entries.length; j++) {
				const a = entries[i];
				const b = entries[j];
				if (a.paraId === b.paraId) continue;

				if (DRY_RUN) {
					edgeCount++;
					continue;
				}

				// Check if ANSWERS_SAME edge already exists (avoid duplicates)
				const existing = await db.query(
					`FOR e IN edges FILTER e._from == @from AND e._to == @to AND e.relation == "ANSWERS_SAME" LIMIT 1 RETURN 1`,
					{ from: a.paraId, to: b.paraId }
				).then(c => c.all()).catch(() => []);

				if (existing.length > 0) { skipped++; continue; }

				await insertEdge({ _from: a.paraId, _to: b.paraId, relation: 'ANSWERS_SAME', type: 'ANSWERS_SAME', shared_query: a.original, shared_query_norm: norm }).catch(() => {});
				await insertEdge({ _from: b.paraId, _to: a.paraId, relation: 'ANSWERS_SAME', type: 'ANSWERS_SAME', shared_query: a.original, shared_query_norm: norm }).catch(() => {});
				edgeCount += 2;
			}
		}
	}

	if (DRY_RUN) {
		console.log(`[DRY RUN] Would create ~${edgeCount} ANSWERS_SAME edges`);
	} else {
		console.log(`Done. Created ${edgeCount} ANSWERS_SAME edges (${skipped} already existed).`);
	}
}

main().catch(err => { console.error(err.message); process.exit(1); });
