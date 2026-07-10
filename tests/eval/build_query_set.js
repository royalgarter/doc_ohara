#!/usr/bin/env node
// Build stratified eval query sets (per TODO.md experiment plan):
//   eval/multihop_queries.json — 125 per type (inference/comparison/temporal/null), gold = evidence doc titles
//   eval/qasper_queries.json   — questions from the sampled QASPER papers, gold = paper + evidence snippets
//
// Usage: node tests/eval/build_query_set.js [--per-type=125] [--qasper-count=150] [--seed=42]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const EVAL_DIR = path.join(ROOT, 'eval');
const MH_QUERIES = path.join(__dirname, 'data', 'multihop', 'MultiHopRAG.json');
const QASPER_MANIFEST = path.join(__dirname, 'data', 'qasper', 'doc_manifest.json');
const QASPER_DIR = path.join(__dirname, 'data', 'qasper');

const PER_TYPE = parseInt(process.argv.find(a => a.startsWith('--per-type='))?.split('=')[1] || '125', 10);
const QASPER_COUNT = parseInt(process.argv.find(a => a.startsWith('--qasper-count='))?.split('=')[1] || '150', 10);
const SEED = parseInt(process.argv.find(a => a.startsWith('--seed='))?.split('=')[1] || '42', 10);

function rng(seed) {
	return () => {
		seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
function shuffled(arr, rand) {
	const a = [...arr];
	for (let i = a.length - 1; i > 0; i--) {
		const j = Math.floor(rand() * (i + 1));
		[a[i], a[j]] = [a[j], a[i]];
	}
	return a;
}

fs.mkdirSync(EVAL_DIR, { recursive: true });

// ── MultiHop-RAG ──────────────────────────────────────────────────────────────
if (fs.existsSync(MH_QUERIES)) {
	const all = JSON.parse(fs.readFileSync(MH_QUERIES, 'utf8'));
	const byType = {};
	for (const q of all) (byType[q.question_type] = byType[q.question_type] || []).push(q);

	const rand = rng(SEED);
	const selected = [];
	for (const [type, qs] of Object.entries(byType)) {
		selected.push(...shuffled(qs, rand).slice(0, PER_TYPE));
		console.log(`  ${type}: ${Math.min(PER_TYPE, qs.length)}/${qs.length}`);
	}

	const out = selected.map((q, i) => ({
		id: `mh_${String(i + 1).padStart(4, '0')}`,
		question: q.query,
		question_type: q.question_type,
		answer: q.answer,
		// Doc-level gold: retrieval hit = retrieved node belongs to one of these articles
		gold_doc_titles: [...new Set((q.evidence_list || []).map(e => e.title))],
		gold_evidence: (q.evidence_list || []).map(e => ({
			title: e.title, source: e.source, published_at: e.published_at, fact: e.fact,
		})),
	}));
	const outPath = path.join(EVAL_DIR, 'multihop_queries.json');
	fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
	console.log(`MultiHop-RAG: ${out.length} queries → ${outPath}`);
} else {
	console.log('MultiHopRAG.json missing — skipped (run download_datasets.sh).');
}

// ── QASPER ────────────────────────────────────────────────────────────────────
if (fs.existsSync(QASPER_MANIFEST)) {
	const manifest = JSON.parse(fs.readFileSync(QASPER_MANIFEST, 'utf8'));
	const devFile = fs.readdirSync(QASPER_DIR).find(f => /dev.*\.json$/.test(f));
	const papers = JSON.parse(fs.readFileSync(path.join(QASPER_DIR, devFile), 'utf8'));
	const sampledIds = new Set(Object.values(manifest).map(m => m.paper_id));

	const candidates = [];
	for (const [fileName, meta] of Object.entries(manifest)) {
		const p = papers[meta.paper_id];
		for (const qa of p.qas || []) {
			const ans = (qa.answers || [])[0]?.answer;
			const evidence = (ans?.evidence || []).filter(e => e && !e.startsWith('FLOAT SELECTED'));
			if (!evidence.length || ans?.unanswerable) continue;
			candidates.push({
				question: qa.question,
				paper_id: meta.paper_id,
				source_file: fileName,
				gold_doc_titles: [meta.title],
				gold_evidence_text: evidence, // matched against retrieved paragraph content at eval time
			});
		}
	}
	const rand2 = rng(SEED + 1);
	const out = shuffled(candidates, rand2).slice(0, QASPER_COUNT)
		.map((q, i) => ({ id: `qa_${String(i + 1).padStart(4, '0')}`, ...q }));
	const outPath = path.join(EVAL_DIR, 'qasper_queries.json');
	fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
	console.log(`QASPER: ${out.length}/${candidates.length} answerable questions (${sampledIds.size} papers) → ${outPath}`);
} else {
	console.log('QASPER manifest missing — skipped (run prepare_qasper.js).');
}
