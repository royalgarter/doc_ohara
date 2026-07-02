#!/usr/bin/env node
/**
 * Run OHARA retrieval evaluation against a ground-truth Q&A set.
 *
 * Metrics:
 *   Recall@k  - fraction of questions where ground_truth_para_id in top-k results
 *   MRR       - mean reciprocal rank (0 if not found in top-20)
 *   NDCG@10   - normalized discounted cumulative gain (binary relevance)
 *
 * Phase source breakdown: which retrieval phases contributed to hits.
 *
 * Ablation mode (--ablate): zeroes out one OHARA_*_WEIGHT env var per run
 * and reports delta Recall@10 - shows which phases actually contribute.
 *
 * Usage:
 *   node --env-file=.env scripts/run_eval.js
 *   node --env-file=.env scripts/run_eval.js --input=eval/eval_set.json
 *   node --env-file=.env scripts/run_eval.js --limit=20             # first N questions only
 *   node --env-file=.env scripts/run_eval.js --ablate               # per-phase ablation
 *   node --env-file=.env scripts/run_eval.js --output=eval/my.json  # custom report path
 */

import fs from 'node:fs';
import path from 'node:path';
import { initArangoClient } from '../src/db/client.js';
import { RetrievalEngine } from '../src/retrieval.js';

const INPUT = process.argv.find(a => a.startsWith('--input='))?.split('=')[1] || 'eval/eval_set.json';
const LIMIT = parseInt((process.argv.find(a => a.startsWith('--limit='))?.split('=')[1]) || '0', 10) || null;
const ABLATE = process.argv.includes('--ablate');
const OUTPUT = process.argv.find(a => a.startsWith('--output='))?.split('=')[1] || null;
const RESULT_LIMIT = 20; // top-K to retrieve per question

// Phase weight env vars for ablation
const PHASE_WEIGHTS = {
	bm25:        'OHARA_BM25_WEIGHT',
	sumo:        'OHARA_SUMO_WEIGHT',
	structural:  'OHARA_STRUCT_WEIGHT',
	entity_pivot:'OHARA_ENTITY_PIVOT_WEIGHT',
	cross_doc:   'OHARA_CROSS_DOC_WEIGHT',
	vector:      'OHARA_VECTOR_WEIGHT',
};

// ── Metrics ───────────────────────────────────────────────────────────────────

function recallAtK(perQuestion, k) {
	const hits = perQuestion.filter(q => q.rank !== null && q.rank < k).length;
	return hits / perQuestion.length;
}

function mrr(perQuestion) {
	const sum = perQuestion.reduce((acc, q) => acc + (q.rank !== null ? 1 / (q.rank + 1) : 0), 0);
	return sum / perQuestion.length;
}

function ndcgAt10(perQuestion) {
	const ideal = 1 / Math.log2(2); // DCG for perfect rank-1 hit
	const sum = perQuestion.reduce((acc, q) => {
		if (q.rank === null || q.rank >= 10) return acc;
		return acc + (1 / Math.log2(q.rank + 2)); // rank is 0-indexed
	}, 0);
	return (sum / perQuestion.length) / ideal;
}

function computeMetrics(perQuestion) {
	return {
		recall_at_1:  Math.round(recallAtK(perQuestion, 1)  * 10000) / 10000,
		recall_at_5:  Math.round(recallAtK(perQuestion, 5)  * 10000) / 10000,
		recall_at_10: Math.round(recallAtK(perQuestion, 10) * 10000) / 10000,
		recall_at_20: Math.round(recallAtK(perQuestion, 20) * 10000) / 10000,
		mrr:          Math.round(mrr(perQuestion)            * 10000) / 10000,
		ndcg_at_10:   Math.round(ndcgAt10(perQuestion)      * 10000) / 10000,
	};
}

// ── Source distribution ────────────────────────────────────────────────────────

function sourceDistribution(perQuestion) {
	const dist = {};
	for (const q of perQuestion) {
		if (q.rank === null) continue;
		for (const src of (q.hit_sources || [])) {
			dist[src] = (dist[src] || 0) + 1;
		}
	}
	return dist;
}

// ── Run one eval pass ─────────────────────────────────────────────────────────

async function runPass(engine, questions) {
	const perQuestion = [];

	for (let i = 0; i < questions.length; i++) {
		const q = questions[i];
		let result;
		try {
			result = await engine.query(q.question, { limit: RESULT_LIMIT });
		} catch (err) {
			perQuestion.push({ id: q.id, question: q.question, rank: null, error: err.message, hit_sources: [] });
			continue;
		}

		const resultIds = (result.results || []).map(r => r.node?._id);
		const rank = resultIds.indexOf(q.ground_truth_para_id);
		const hitResult = rank >= 0 ? result.results[rank] : null;
		const hitSources = hitResult?.sources || hitResult?.contributions?.map(c => c.phase) || [];

		perQuestion.push({
			id: q.id,
			question: q.question,
			ground_truth_para_id: q.ground_truth_para_id,
			rank: rank >= 0 ? rank : null,
			hit_sources: hitSources,
		});

		if ((i + 1) % 10 === 0) {
			const sofar = perQuestion.filter(x => x.rank !== null).length;
			console.log(`  ${i + 1}/${questions.length} - Recall@10 so far: ${(recallAtK(perQuestion, 10) * 100).toFixed(1)}% (${sofar} hits)`);
		}
	}

	return perQuestion;
}

// ── Pretty print ──────────────────────────────────────────────────────────────

function printMetrics(label, metrics, baseline = null) {
	const delta = (key) => {
		if (!baseline) return '';
		const d = metrics[key] - baseline[key];
		return d === 0 ? '' : ` (${d > 0 ? '+' : ''}${(d * 100).toFixed(1)}%)`;
	};
	console.log(`\n── ${label} ──`);
	console.log(`  Recall@1  : ${(metrics.recall_at_1  * 100).toFixed(1)}%${delta('recall_at_1')}`);
	console.log(`  Recall@5  : ${(metrics.recall_at_5  * 100).toFixed(1)}%${delta('recall_at_5')}`);
	console.log(`  Recall@10 : ${(metrics.recall_at_10 * 100).toFixed(1)}%${delta('recall_at_10')}`);
	console.log(`  Recall@20 : ${(metrics.recall_at_20 * 100).toFixed(1)}%${delta('recall_at_20')}`);
	console.log(`  MRR       : ${metrics.mrr.toFixed(4)}${delta('mrr')}`);
	console.log(`  NDCG@10   : ${metrics.ndcg_at_10.toFixed(4)}${delta('ndcg_at_10')}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
	const inputPath = path.resolve(INPUT);
	if (!fs.existsSync(inputPath)) {
		console.error(`Eval set not found: ${inputPath}\nRun: node scripts/generate_eval_set.js first`);
		process.exit(1);
	}

	let questions = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
	if (LIMIT) questions = questions.slice(0, LIMIT);
	console.log(`Loaded ${questions.length} questions from ${inputPath}`);

	const db = await initArangoClient();
	// Wrap db to match RetrievalEngine's expected interface (executeAQL)
	const dbShim = {
		executeAQL: async (aql, vars) => {
			const cursor = await db.query(aql, vars);
			return cursor.all();
		},
		query: async (aql, vars) => db.query(aql, vars),
	};
	const engine = new RetrievalEngine(dbShim);

	// ── Baseline run ──
	console.log('\nRunning baseline evaluation…');
	const basePerQ = await runPass(engine, questions);
	const baseMetrics = computeMetrics(basePerQ);
	const baseSources = sourceDistribution(basePerQ);

	printMetrics('BASELINE', baseMetrics);
	console.log('\n  Phase source distribution (hits only):');
	Object.entries(baseSources).sort((a, b) => b[1] - a[1]).forEach(([src, n]) => {
		console.log(`    ${src.padEnd(20)}: ${n}`);
	});

	const report = {
		run_at: new Date().toISOString(),
		eval_set: inputPath,
		eval_set_size: questions.length,
		baseline: {
			metrics: baseMetrics,
			phase_source_distribution: baseSources,
			per_question: basePerQ,
		},
		ablation: {},
	};

	// ── Ablation runs ──
	if (ABLATE) {
		console.log('\nRunning per-phase ablation (zeroing one weight at a time)…');
		for (const [phaseName, envVar] of Object.entries(PHASE_WEIGHTS)) {
			const original = process.env[envVar];
			process.env[envVar] = '0';

			console.log(`\n  Ablating ${phaseName} (${envVar}=0)…`);
			const ablatePerQ = await runPass(engine, questions);
			const ablateMetrics = computeMetrics(ablatePerQ);

			printMetrics(`ABLATE: ${phaseName} removed`, ablateMetrics, baseMetrics);
			report.ablation[phaseName] = { env_var: envVar, metrics: ablateMetrics };

			// Restore
			if (original !== undefined) process.env[envVar] = original;
			else delete process.env[envVar];
		}

		// Summary table
		console.log('\n── Ablation Summary (Recall@10 delta) ──');
		console.log('  Phase            Recall@10    Δ vs baseline');
		console.log('  ' + '─'.repeat(46));
		for (const [phaseName, data] of Object.entries(report.ablation)) {
			const delta = data.metrics.recall_at_10 - baseMetrics.recall_at_10;
			const bar = delta < 0 ? '▼'.repeat(Math.min(10, Math.abs(Math.round(delta * 100)))) : (delta > 0 ? '▲' : '─');
			console.log(`  ${phaseName.padEnd(16)}   ${(data.metrics.recall_at_10 * 100).toFixed(1)}%       ${delta > 0 ? '+' : ''}${(delta * 100).toFixed(1)}% ${bar}`);
		}
	}

	// ── Write report ──
	const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
	const outPath = path.resolve(OUTPUT || `eval/eval_report_${ts}.json`);
	fs.mkdirSync(path.dirname(outPath), { recursive: true });
	fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
	console.log(`\nReport written → ${outPath}`);
}

main().catch(err => { console.error(err.message); process.exit(1); });
