#!/usr/bin/env node
// Post-ingest fixup: force known-gold published_date + decay_class onto ingested
// MultiHop-RAG documents from the manifest (LLM temporal detection is best-effort;
// the benchmark gives us exact dates). Run AFTER ingest, BEFORE run_matrix.js.
//
// Usage: node --env-file=.env tests/eval/set_published_dates.js [--dry-run]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initArangoClient } from '../../src/db/client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MANIFEST = path.join(__dirname, 'data', 'multihop', 'doc_manifest.json');
const DRY = process.argv.includes('--dry-run');

const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
const db = await initArangoClient();

let updated = 0, missing = 0, dateless = 0;
for (const [sourceFile, meta] of Object.entries(manifest)) {
	if (!meta.published_at) { dateless++; continue; }
	const iso = new Date(meta.published_at).toISOString().slice(0, 10);
	const cursor = await db.query(
		`FOR d IN documents FILTER d.source_file == @sf
			${DRY ? 'RETURN d._key' : `UPDATE d WITH {
				published_date: @date,
				temporal_granularity: "day",
				temporal_confidence: 1,
				temporal_needs_review: false,
				decay_class: "CURRENT",
				effective_decay_class: d.effective_decay_class == "EVERGREEN" ? "EVERGREEN" : "CURRENT"
			} IN documents RETURN d._key`}`,
		{ sf: sourceFile, ...(DRY ? {} : { date: iso }) },
	);
	const keys = await cursor.all();
	if (keys.length) updated += keys.length; else missing++;
}

console.log(`${DRY ? '[dry-run] would update' : 'Updated'} ${updated} docs; ${missing} not in DB; ${dateless} without date in manifest.`);
