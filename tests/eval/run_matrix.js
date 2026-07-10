#!/usr/bin/env node
// Run the TODO.md experiment config matrix against an ingested corpus.
// Doc-level scoring for MultiHop-RAG (gold = evidence article set),
// paragraph-level for QASPER (gold = evidence text match).
//
// Configs (env-var overrides, ingest reused — near-zero LLM cost per re-run):
//   bm25_only | vector_only | full | no_sumo | no_crossdoc | no_temporal | no_toc | no_corroboration
//
// Usage:
//   node --env-file=.env tests/eval/run_matrix.js --input=eval/multihop_queries.json
//   node --env-file=.env tests/eval/run_matrix.js --input=eval/qasper_queries.json --configs=full,no_toc
//   node --env-file=.env tests/eval/run_matrix.js --input=eval/multihop_queries.json --limit=20   # smoke test
//
// Reports → eval/matrix_<dataset>_<timestamp>.json (per-query detail + summary).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initArangoClient } from '../../src/db/client.js';
import { loadEnvFromDB } from '../../src/db/env.js';
import { RetrievalEngine } from '../../src/retrieval.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

const INPUT = process.argv.find(a => a.startsWith('--input='))?.split('=')[1] || 'eval/multihop_queries.json';
const LIMIT = parseInt(process.argv.find(a => a.startsWith('--limit='))?.split('=')[1] || '0', 10) || null;
const CONFIGS_ARG = process.argv.find(a => a.startsWith('--configs='))?.split('=')[1] || null;
const RESULT_LIMIT = 20;

const ZERO_ALL = {
	OHARA_SUMO_WEIGHT: '0', OHARA_ENTITY_PIVOT_WEIGHT: '0', OHARA_CROSS_DOC_WEIGHT: '0',
	OHARA_STRUCT_WEIGHT: '0', OHARA_VECTOR_WEIGHT: '0', OHARA_TEMPORAL_WEIGHT: '0',
	OHARA_ADAPTIVE_WEIGHTS: 'false', OHARA_TOC_GUIDANCE: 'false',
};

// Matrix from TODO.md "Systems compared"
const CONFIGS = {
	bm25_only:        { env: { ...ZERO_ALL, OHARA_BM25_WEIGHT: '1.0' } },
	vector_only:      { env: { ...ZERO_ALL, OHARA_BM25_WEIGHT: '0', OHARA_VECTOR_WEIGHT: '1.0' } },
	full:             { env: {} },
	no_sumo:          { env: { OHARA_SUMO_WEIGHT: '0' } },
	no_crossdoc:      { env: { OHARA_CROSS_DOC_WEIGHT: '0' } },
	no_temporal:      { env: { OHARA_TEMPORAL_WEIGHT: '0' } },
	no_toc:           { env: { OHARA_TOC_GUIDANCE: 'false' } },
	no_corroboration: { env: {}, principalMode: 'topk' }, // Principal = plain top-k, no ≥2-phase constraint
};

// ── Metrics ───────────────────────────────────────────────────────────────────

function hitsAtK(perQ, k) {
	const scored = perQ.filter(q => !q.is_null);
	return scored.filter(q => q.first_hit_rank !== null && q.first_hit_rank < k).length / Math.max(scored.length, 1);
}
function mrrAt10(perQ) {
	const scored = perQ.filter(q => !q.is_null);
	return scored.reduce((s, q) => s + (q.first_hit_rank !== null && q.first_hit_rank < 10 ? 1 / (q.first_hit_rank + 1) : 0), 0) / Math.max(scored.length, 1);
}
function mapAt10(perQ) {
	const scored = perQ.filter(q => !q.is_null);
	const ap = (q) => {
		if (!q.gold_count) return 0;
		let hits = 0, sum = 0;
		q.hit_ranks.filter(r => r < 10).forEach((r, i) => { hits = i + 1; sum += hits / (r + 1); });
		return sum / Math.min(q.gold_count, 10);
	};
	return scored.reduce((s, q) => s + ap(q), 0) / Math.max(scored.length, 1);
}
function goldRecallAt10(perQ) {
	const scored = perQ.filter(q => !q.is_null && q.gold_count > 0);
	return scored.reduce((s, q) => s + q.hit_ranks.filter(r => r < 10).length / q.gold_count, 0) / Math.max(scored.length, 1);
}
function principalHitRate(perQ) {
	const scored = perQ.filter(q => !q.is_null);
	return scored.filter(q => q.principal_hit).length / Math.max(scored.length, 1);
}
function nullAbstention(perQ) {
	const nulls = perQ.filter(q => q.is_null);
	if (!nulls.length) return null;
	return nulls.filter(q => q.principal_count === 0).length / nulls.length;
}

function summarize(perQ) {
	const r4 = (x) => Math.round(x * 10000) / 10000;
	return {
		hits_at_4: r4(hitsAtK(perQ, 4)),
		hits_at_10: r4(hitsAtK(perQ, 10)),
		mrr_at_10: r4(mrrAt10(perQ)),
		map_at_10: r4(mapAt10(perQ)),
		gold_recall_at_10: r4(goldRecallAt10(perQ)),
		principal_hit_rate: r4(principalHitRate(perQ)),
		null_abstention_rate: nullAbstention(perQ) === null ? null : r4(nullAbstention(perQ)),
	};
}

// ── Gold matching ─────────────────────────────────────────────────────────────

function normText(s) {
	return (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

// MultiHop-RAG: node hit if its parent document's title matches a gold article title
function makeDocMatcher(q, docByKey) {
	const goldTitles = new Set((q.gold_doc_titles || []).map(normText));
	return (node) => {
		const dk = (node.document_id || node._key || '').split('/').pop();
		const doc = docByKey.get(dk);
		return doc ? goldTitles.has(normText(doc.title)) && normText(doc.title) : false;
	};
}

// QASPER: node hit if its content contains (or is contained by) a gold evidence snippet
function makeParaMatcher(q) {
	const evid = (q.gold_evidence_text || []).map(normText).filter(e => e.length > 40);
	return (node) => {
		const content = normText(node.content || node.markdown_representation);
		if (!content) return false;
		const m = evid.find(e => content.includes(e.slice(0, 200)) || e.includes(content.slice(0, 200)));
		return m ? m.slice(0, 60) : false;
	};
}

// ── Runner ────────────────────────────────────────────────────────────────────

async function runConfig(name, cfg, engine, questions, docByKey, isQasper) {
	const saved = {};
	for (const [k, v] of Object.entries(cfg.env)) { saved[k] = process.env[k]; process.env[k] = v; }

	const perQ = [];
	for (let i = 0; i < questions.length; i++) {
		const q = questions[i];
		const isNull = q.question_type === 'null_query' || q.question_type === 'null';
		let result;
		try {
			result = await engine.query(q.question, { limit: RESULT_LIMIT });
		} catch (err) {
			perQ.push({ id: q.id, is_null: isNull, first_hit_rank: null, hit_ranks: [], gold_count: 0, principal_hit: false, principal_count: 0, error: err.message });
			continue;
		}

		const matcher = isQasper ? makeParaMatcher(q) : makeDocMatcher(q, docByKey);
		const nodes = (result.results || []).map(r => r.node).filter(Boolean);
		const matchedGold = new Set();
		const hitRanks = [];
		nodes.forEach((n, rank) => {
			const m = matcher(n);
			if (m && !matchedGold.has(m)) { matchedGold.add(m); hitRanks.push(rank); }
		});

		const principal = cfg.principalMode === 'topk'
			? (result.results || []).slice(0, 5)
			: (result.tiers?.principal || []);
		const principalHit = principal.some(p => matcher(p.node || p));

		perQ.push({
			id: q.id,
			question_type: q.question_type || 'qasper',
			is_null: isNull,
			gold_count: isQasper ? (q.gold_evidence_text || []).length : (q.gold_doc_titles || []).length,
			first_hit_rank: hitRanks.length ? hitRanks[0] : null,
			hit_ranks: hitRanks,
			principal_hit: principalHit,
			principal_count: principal.length,
		});

		if ((i + 1) % 25 === 0) console.log(`  [${name}] ${i + 1}/${questions.length} — Hits@10 so far: ${(hitsAtK(perQ, 10) * 100).toFixed(1)}%`);
	}

	for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
	return perQ;
}

function byTypeBreakdown(perQ) {
	const types = [...new Set(perQ.map(q => q.question_type))];
	const out = {};
	for (const t of types) out[t] = summarize(perQ.filter(q => q.question_type === t));
	return out;
}

async function main() {
	const inputPath = path.resolve(ROOT, INPUT);
	let questions = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
	if (LIMIT) questions = questions.slice(0, LIMIT);
	const isQasper = /qasper/.test(inputPath);
	console.log(`Loaded ${questions.length} queries from ${inputPath} (${isQasper ? 'paragraph' : 'doc'}-level scoring)`);

	await loadEnvFromDB(); // GEMINI_API_KEY + OHARA_* weights live in the env collection
	const db = await initArangoClient();
	const dbShim = {
		executeAQL: async (aql, vars) => (await db.query(aql, vars)).all(),
		query: async (aql, vars) => db.query(aql, vars),
	};
	const engine = new RetrievalEngine(dbShim);

	// One-time doc lookup for doc-level gold matching
	const docs = await dbShim.executeAQL('FOR d IN documents RETURN { _key: d._key, title: d.title, source_file: d.source_file }', {});
	const docByKey = new Map(docs.map(d => [d._key, d]));
	console.log(`${docByKey.size} documents in DB`);

	const configNames = CONFIGS_ARG ? CONFIGS_ARG.split(',') : Object.keys(CONFIGS);
	const report = { run_at: new Date().toISOString(), input: INPUT, query_count: questions.length, configs: {} };

	for (const name of configNames) {
		const cfg = CONFIGS[name];
		if (!cfg) { console.error(`Unknown config: ${name}`); continue; }
		if (isQasper && name === 'no_temporal') continue; // no temporal queries in QASPER
		console.log(`\n── config: ${name} ──`);
		const perQ = await runConfig(name, cfg, engine, questions, docByKey, isQasper);
		const summary = summarize(perQ);
		report.configs[name] = { summary, by_type: byTypeBreakdown(perQ), per_question: perQ };
		console.log(`  ${JSON.stringify(summary)}`);
	}

	// Summary table
	console.log('\n── Matrix summary (Hits@10 / MRR@10 / Principal-hit) ──');
	for (const [name, data] of Object.entries(report.configs)) {
		const s = data.summary;
		console.log(`  ${name.padEnd(18)} ${(s.hits_at_10 * 100).toFixed(1).padStart(5)}%  ${s.mrr_at_10.toFixed(4)}  ${(s.principal_hit_rate * 100).toFixed(1).padStart(5)}%`);
	}

	const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
	const dataset = isQasper ? 'qasper' : 'multihop';
	const outPath = path.resolve(ROOT, `eval/matrix_${dataset}_${ts}.json`);
	fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
	console.log(`\nReport → ${outPath}`);
}

main().catch(err => { console.error(err); process.exit(1); });
