import * as client from '../src/db/client.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process?.loadEnvFile?.();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Credentials and infra keys — never stored in the config collection.
const SKIP_KEYS = new Set([
	'ARANGO_URL', 'ARANGO_USER', 'ARANGO_PASSWORD',
	'GEMINI_API_KEY', 'APP_URL', 'PORT',
	'LITEPARSE_CLI_PATH', 'OHARA_LLM_CACHE_DIR', 'OHARA_TEST_CHUNKS_LIMIT',
]);

// Parse .env.example → Map<key, defaultValue> for all non-credential, non-empty lines.
function parseEnvExample(filePath) {
	const defaults = new Map();
	const raw = fs.readFileSync(filePath, 'utf8');
	for (const line of raw.split('\n')) {
		const trimmed = line.trim();
		// Skip blank lines, comment-only lines, or commented-out keys
		if (!trimmed || trimmed.startsWith('#')) continue;
		const eqIdx = trimmed.indexOf('=');
		if (eqIdx === -1) continue;
		const key = trimmed.slice(0, eqIdx).trim();
		const value = trimmed.slice(eqIdx + 1).trim();
		// Skip empty defaults and credential keys
		if (!value || SKIP_KEYS.has(key)) continue;
		defaults.set(key, value);
	}
	return defaults;
}

(async () => {
	try {
		const db = await client.initArangoClient();
		console.log('initArangoClient succeeded');
		const colls = await db.listCollections();
		console.log('collections now:', colls.map(c => c.name));
		await client.createSearchViewIfNotExists();
		console.log('ArangoSearch view ready');

		// Persistent index on published_date for temporal range queries / sort
		try {
			const docsCol = db.collection('documents');
			await docsCol.ensureIndex({ type: 'persistent', fields: ['published_date'], sparse: true, name: 'idx_published_date' });
			console.log('Index on documents.published_date ready');
		} catch (e) {
			console.warn('Could not create published_date index:', e.message);
		}

		// Vector index on paragraphs.embedding for ANN cosine similarity (ArangoDB 3.12+ Enterprise).
		// Requires at least one paragraph with an embedding field — run backfill_embeddings.js first.
		try {
			const embCount = await db.query(
				'RETURN LENGTH(FOR p IN paragraphs FILTER p.embedding != null LIMIT 1 RETURN 1)'
			).then(c => c.next());
			if (!embCount) {
				console.warn('Vector index skipped — no paragraphs have embedding field yet. Run: node scripts/backfill_embeddings.js');
			} else {
				const parasCol = db.collection('paragraphs');
				await parasCol.ensureIndex({
					type: 'vector',
					fields: ['embedding'],
					inBackground: true,
					name: 'idx_para_embedding',
					params: { metric: 'cosine', dimension: 768, nLists: 4 },
				});
				console.log('Vector index on paragraphs.embedding ready');
			}
		} catch (e) {
			console.warn('Could not create vector index (requires ArangoDB 3.12 Enterprise):', e.message);
		}

		// ── Config collection seeding ─────────────────────────────────────────────
		// Upsert default values from .env.example into the `config` collection.
		// Only inserts if the key does not already exist — never overwrites user edits.
		const envExamplePath = path.resolve(__dirname, '../.env.example');
		const defaults = parseEnvExample(envExamplePath);
		const configCol = db.collection('config');

		let inserted = 0;
		let skipped = 0;
		for (const [key, value] of defaults) {
			const existing = await configCol.document(key).catch(() => null);
			if (existing) {
				skipped++;
			} else {
				await configCol.save({ _key: key, value, source: 'default' });
				inserted++;
				console.log(`  config: inserted ${key}=${value}`);
			}
		}
		console.log(`Config seeding done — ${inserted} inserted, ${skipped} already present (${defaults.size} total keys).`);

	} catch (e) {
		console.error('init failed:', e.message);
		process.exit(1);
	}
})();
