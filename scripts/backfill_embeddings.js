// Backfill gemini-embedding-001 vectors (768-dim) for all paragraphs lacking an embedding.
// Usage: node scripts/backfill_embeddings.js [--dry-run]
// Requires: ARANGO_URL, GEMINI_API_KEY (env var or ArangoDB config/env collection)
import * as client from '../src/db/client.js';
import { GoogleGenAI } from '@google/genai';

const DRY_RUN = process.argv.includes('--dry-run');
const BATCH = parseInt(process.env.OHARA_EMBED_BATCH_SIZE || '20', 10);
const EMBED_MODEL = 'gemini-embedding-001';
const EMBED_DIM = 768; // matches idx_para_embedding dimension

(async () => {
	const db = await client.initArangoClient();

	// Resolve GEMINI_API_KEY: env var first, then config collection, then env collection
	let apiKey = process.env.GEMINI_API_KEY;
	if (!apiKey) {
		const doc = await db.collection('config').document('GEMINI_API_KEY').catch(() => null)
			|| await db.collection('env').document('GEMINI_API_KEY').catch(() => null);
		apiKey = doc?.value || '';
	}
	if (!apiKey) { console.error('GEMINI_API_KEY required (set in env or config collection)'); process.exit(1); }

	const ai = new GoogleGenAI({ apiKey });

	// Fetch all paragraphs missing embedding
	const rows = await db.query(
		'FOR p IN paragraphs FILTER p.embedding == null AND LENGTH(p.content) >= 1 RETURN { key: p._key, text: p.content }'
	).then(c => c.all());

	console.log(`Paragraphs missing embeddings: ${rows.length}${DRY_RUN ? ' (dry-run)' : ''}`);
	if (!rows.length || DRY_RUN) process.exit(0);

	const parasCol = db.collection('paragraphs');
	let done = 0;
	let failed = 0;

	for (let i = 0; i < rows.length; i += BATCH) {
		const batch = rows.slice(i, i + BATCH);
		try {
			const resp = await ai.models.embedContent({
				model: EMBED_MODEL,
				contents: batch.map(b => b.text.slice(0, 8192)),
				config: { taskType: 'RETRIEVAL_DOCUMENT', outputDimensionality: EMBED_DIM },
			});
			const embeddings = resp.embeddings || [];
			for (let j = 0; j < batch.length; j++) {
				const vec = embeddings[j]?.values;
				if (!vec) { failed++; continue; }
				try {
					await parasCol.update(batch[j].key, { embedding: vec });
					done++;
				} catch (e) {
					console.warn(`  skip ${batch[j].key}: ${e.message}`);
					failed++;
				}
			}
			console.log(`  ${done}/${rows.length} embedded, ${failed} failed`);
		} catch (e) {
			console.error(`  batch ${i}–${i + BATCH} failed: ${e.message}`);
			failed += batch.length;
		}
	}
	console.log(`Done. ${done} embedded, ${failed} failed.`);
})();
