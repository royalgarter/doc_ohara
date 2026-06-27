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
const MODEL = 'text-embedding-004';

async function main() {
	if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not set');
	const db = await initArangoClient();
	const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

	// Find paragraphs missing embeddings with real content
	const cursor = await db.query(`
		FOR p IN paragraphs
		FILTER p.embedding == null
		FILTER LENGTH(p.content) >= 20
		RETURN { key: p._key, content: p.content }
	`);
	const paras = await cursor.all();

	console.log(`Found ${paras.length} paragraph(s) missing embeddings.`);
	if (DRY_RUN) { console.log('DRY RUN — pass --write to apply.'); return; }

	let done = 0;
	for (let i = 0; i < paras.length; i += BATCH) {
		const batch = paras.slice(i, i + BATCH);
		try {
			const resp = await ai.models.embedContent({
				model: MODEL,
				contents: batch.map(p => p.content.slice(0, 8192)),
				config: { taskType: 'RETRIEVAL_DOCUMENT' },
			});
			const embeddings = resp.embeddings || [];
			for (let j = 0; j < batch.length; j++) {
				const vec = embeddings[j]?.values;
				if (!vec) continue;
				await db.query(
					`UPDATE @key WITH { embedding: @vec } IN paragraphs`,
					{ key: batch[j].key, vec }
				);
				done++;
			}
			process.stdout.write(`\r  ${done}/${paras.length} embedded`);
		} catch (err) {
			console.error(`\n  Batch ${i}–${i + BATCH} failed: ${err.message}`);
		}
	}
	console.log(`\n✓ Embedded ${done} paragraph(s).`);
}

main().catch(err => { console.error(err.message); process.exit(1); });
