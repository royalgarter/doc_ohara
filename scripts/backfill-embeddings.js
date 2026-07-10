#!/usr/bin/env node
/**
 * Backfill Gemini text-embedding-004 vectors on paragraphs that lack them.
 * Requires OHARA_EMBED_PARAGRAPHS=true in .env to be used going forward;
 * this script handles already-ingested content.
 *
 * Usage:
 *   node scripts/backfill-embeddings.js          # dry-run (count only)
 *   node scripts/backfill-embeddings.js --write  # embed and store
 */
import { loadEnvFromDB } from '../src/db/env.js';
import { initArangoClient } from '../src/db/client.js';
import { GoogleGenAI } from '@google/genai';

if (process.env.ARANGO_URL) await loadEnvFromDB();

const DRY_RUN = !process.argv.includes('--write');
const BATCH = parseInt(process.env.OHARA_EMBED_BATCH_SIZE || '20', 10);
// Must match the query-side model in _phase1dVector (gemini-embedding-2 @768d) -
// mixed-model cosine similarity is meaningless. embedding_model is stored so
// stale vectors from older models get re-embedded.
const MODEL = 'gemini-embedding-2';
const DIMS = 768;

async function main() {
	if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not set');
	const db = await initArangoClient();
	const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

	// Find paragraphs missing embeddings (or embedded with a different model)
	const cursor = await db.query(`
		FOR p IN paragraphs
		FILTER p.embedding == null OR p.embedding_model != @model
		FILTER LENGTH(p.content) >= 20
		RETURN { key: p._key, content: p.content }
	`, { model: MODEL });
	const paras = await cursor.all();

	console.log(`Found ${paras.length} paragraph(s) missing embeddings.`);
	if (DRY_RUN) { console.log('DRY RUN - pass --write to apply.'); return; }

	// gemini-embedding models accept ONE content per request - batching via the
	// contents array silently embeds only the first item. Parallel workers instead.
	let done = 0, failed = 0, cursor2 = 0;
	async function worker() {
		while (cursor2 < paras.length) {
			const p = paras[cursor2++];
			try {
				const resp = await ai.models.embedContent({
					model: MODEL,
					contents: p.content.slice(0, 8192),
					config: { taskType: 'RETRIEVAL_DOCUMENT', outputDimensionality: DIMS },
				});
				const vec = resp.embeddings?.[0]?.values;
				if (!vec) { failed++; continue; }
				await db.query(
					`UPDATE @key WITH { embedding: @vec, embedding_model: @model } IN paragraphs`,
					{ key: p.key, vec, model: MODEL }
				);
				done++;
				if (done % 100 === 0) process.stdout.write(`\r  ${done}/${paras.length} embedded (${failed} failed)`);
			} catch (err) {
				failed++;
				if (failed <= 3) console.error(`\n  ${p.key} failed: ${err.message.slice(0, 120)}`);
			}
		}
	}
	await Promise.all(Array.from({ length: BATCH }, worker));
	console.log(`\n✓ Embedded ${done} paragraph(s), ${failed} failed.`);
}

main().catch(err => { console.error(err.message); process.exit(1); });
