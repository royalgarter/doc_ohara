/**
 * Deletes all per-page rwatimes.io documents (and their sections/paragraphs/edges)
 * ingested before the domain-bundling fix. Run once, then re-ingest via ingestCrawledDomain.
 *
 * Usage:
 *   node scripts/cleanup_rwatimes.js [--dry-run]
 */

import { initArangoClient } from '../src/db/client.js';
import { deleteDocumentAndNodes } from '../src/db/client.js';

const DRY_RUN = process.argv.includes('--dry-run');

const db = await initArangoClient();

const cursor = await db.query(`
	FOR d IN documents
		FILTER CONTAINS(d.source_file, "rwatimes")
		RETURN { _key: d._key, title: d.title, source_file: d.source_file }
`);
const docs = await cursor.all();

if (docs.length === 0) {
	console.log('No rwatimes.io documents found - nothing to delete.');
	process.exit(0);
}

console.log(`Found ${docs.length} rwatimes.io document(s):${DRY_RUN ? ' [DRY RUN]' : ''}`);
for (const doc of docs) {
	console.log(`  ${doc._key}  ${doc.source_file}`);
}

if (DRY_RUN) {
	console.log('\nDry run - no changes made. Remove --dry-run to delete.');
	process.exit(0);
}

console.log('\nDeleting...');
let deleted = 0;
for (const doc of docs) {
	await deleteDocumentAndNodes(doc._key);
	console.log(`  deleted ${doc._key}  ${doc.source_file}`);
	deleted++;
}

console.log(`\nDone. ${deleted} document(s) removed. Re-ingest via ingestCrawledDomain('rwatimes.io', ...).`);
process.exit(0);
