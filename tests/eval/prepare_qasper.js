#!/usr/bin/env node
// Sample N QASPER papers (seeded, reproducible) into markdown files with real
// section structure under doc_pipeline/input/, plus manifest. Does NOT ingest.
// Papers keep their section hierarchy so TOC-guided Phase 0b + structural
// traversal are actually exercised (news articles cannot do this).
//
// Usage: node tests/eval/prepare_qasper.js [--count=200] [--seed=42]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const QASPER_DIR = path.join(__dirname, 'data', 'qasper');
const INPUT_DIR = path.join(ROOT, 'doc_pipeline', 'input');
const MANIFEST = path.join(QASPER_DIR, 'doc_manifest.json');

const COUNT = parseInt(process.argv.find(a => a.startsWith('--count='))?.split('=')[1] || '200', 10);
const SEED = parseInt(process.argv.find(a => a.startsWith('--seed='))?.split('=')[1] || '42', 10);

const devFile = fs.readdirSync(QASPER_DIR).find(f => /dev.*\.json$/.test(f));
if (!devFile) {
	console.error('QASPER dev json missing. Run tests/eval/download_datasets.sh first.');
	process.exit(1);
}
const papers = JSON.parse(fs.readFileSync(path.join(QASPER_DIR, devFile), 'utf8'));

// Deterministic shuffle (mulberry32)
function rng(seed) {
	return () => {
		seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
const rand = rng(SEED);
const ids = Object.keys(papers).sort();
for (let i = ids.length - 1; i > 0; i--) {
	const j = Math.floor(rand() * (i + 1));
	[ids[i], ids[j]] = [ids[j], ids[i]];
}
const sampled = ids.slice(0, COUNT);

fs.mkdirSync(INPUT_DIR, { recursive: true });
const manifest = {};
let written = 0;
for (const id of sampled) {
	const p = papers[id];
	const fileName = `qasper_${id.replace(/[^a-zA-Z0-9.]/g, '_')}.md`;
	const parts = [`# ${p.title}`, '', '## Abstract', '', p.abstract || ''];
	for (const sec of p.full_text || []) {
		if (!sec.section_name && !(sec.paragraphs || []).length) continue;
		parts.push('', `## ${sec.section_name || 'Section'}`, '');
		parts.push((sec.paragraphs || []).join('\n\n'));
	}
	fs.writeFileSync(path.join(INPUT_DIR, fileName), parts.join('\n'), 'utf8');
	manifest[fileName] = { paper_id: id, title: p.title, question_count: (p.qas || []).length };
	written++;
}

fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2), 'utf8');
console.log(`Wrote ${written} papers (seed=${SEED}) → ${INPUT_DIR}`);
console.log(`Manifest → ${MANIFEST}`);
console.log('NOT ingested.');
