#!/usr/bin/env node
// Convert MultiHop-RAG corpus.json (609 news articles) into markdown files under
// doc_pipeline/input/ ready for `ohara ingest`, plus a manifest mapping
// source_file → gold metadata (title, source, published_at) used by run_matrix.js
// and set_published_dates.js. Does NOT ingest.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const CORPUS = path.join(__dirname, 'data', 'multihop', 'corpus.json');
const INPUT_DIR = path.join(ROOT, 'doc_pipeline', 'input');
const MANIFEST = path.join(__dirname, 'data', 'multihop', 'doc_manifest.json');

if (!fs.existsSync(CORPUS)) {
	console.error('corpus.json missing. Run tests/eval/download_datasets.sh first.');
	process.exit(1);
}

const articles = JSON.parse(fs.readFileSync(CORPUS, 'utf8'));
fs.mkdirSync(INPUT_DIR, { recursive: true });

function slugify(s) {
	return (s || 'untitled').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}

const manifest = {};
let written = 0;
articles.forEach((a, i) => {
	const idx = String(i + 1).padStart(4, '0');
	const fileName = `mhrag_${idx}_${slugify(a.title)}.md`;
	// Date + source stated up front so LLM temporal detection extracts published_date reliably
	const md = [
		`# ${a.title}`,
		'',
		`Published: ${a.published_at || 'unknown'}`,
		`Source: ${a.source || 'unknown'}${a.author ? ` — by ${a.author}` : ''}`,
		`Category: ${a.category || 'news'}`,
		'',
		a.body || '',
	].join('\n');
	fs.writeFileSync(path.join(INPUT_DIR, fileName), md, 'utf8');
	manifest[fileName] = {
		title: a.title,
		source: a.source || null,
		published_at: a.published_at || null,
		url: a.url || null,
		category: a.category || null,
	};
	written++;
});

fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2), 'utf8');
console.log(`Wrote ${written} markdown files → ${INPUT_DIR}`);
console.log(`Manifest → ${MANIFEST}`);
console.log('NOT ingested. Review, then batch-ingest via: for f in doc_pipeline/input/mhrag_*.md; do npm run ohara -- ingest "$(basename "$f")"; done');
