// Backfill Gemini text-embedding-004 vectors for all paragraphs that lack an embedding.
// Usage: node scripts/backfill_embeddings.js [--dry-run]
// Requires: GEMINI_API_KEY, ARANGO_URL, OHARA_EMBED_BATCH_SIZE (default 20)
import * as client from '../src/db/client.js';
import { GoogleGenAI } from '@google/genai';

const DRY_RUN = process.argv.includes('--dry-run');
const BATCH = parseInt(process.env.OHARA_EMBED_BATCH_SIZE || '20', 10);

(async () => {
	if (!process.env.GEMINI_API_KEY) { console.error('GEMINI_API_KEY required'); process.exit(1); }
	const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
	const db = await client.initArangoClient();

	// Fetch all paragraphs missing embedding
	const rows = await db.query(
		'FOR p IN paragraphs FILTER p.embedding == null AND LENGTH(p.content) >= 20 RETURN { key: p._key, text: p.content }'
	).then(c => c.all());

	console.log(`Paragraphs missing embeddings: ${rows.length}${DRY_RUN ? ' (dry-run)' : ''}`);
	if (!rows.length || DRY_RUN) process.exit(0);

	let done = 0;
	for (let i = 0; i < rows.length; i += BATCH) {
		const batch = rows.slice(i, i + BATCH);
		try {
			const resp = await ai.models.embedContent({
				model: 'text-embedding-004',
				contents: batch.map(b => b.text.slice(0, 8192)),
				config: { taskType: 'RETRIEVAL_DOCUMENT' },
			});
			const embeddings = resp.embeddings || [];
			for (let j = 0; j < batch.length; j++) {
				const vec = embeddings[j]?.values;
				if (vec) {
					await client.updateDocument(batch[j].key, { embedding: vec }).catch(e =>
						console.warn(`  skip ${batch[j].key}: ${e.message}`)
					);
					done++;
				}
			}
			console.log(`  ${done}/${rows.length} embedded`);
		} catch (e) {
			console.error(`  batch ${i}–${i + BATCH} failed: ${e.message}`);
		}
	}
	console.log(`Done. ${done} paragraphs embedded.`);
})();
