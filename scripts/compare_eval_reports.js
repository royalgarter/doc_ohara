#!/usr/bin/env node
/**
 * Compare two OHARA eval reports side-by-side.
 * Shows Recall@k, MRR, NDCG@10 deltas and per-phase source shifts.
 *
 * Usage:
 *   node scripts/compare_eval_reports.js eval/report_A.json eval/report_B.json
 */

import fs from 'node:fs';

const [, , fileA, fileB] = process.argv;
if (!fileA || !fileB) {
	console.error('Usage: node scripts/compare_eval_reports.js <report_A.json> <report_B.json>');
	process.exit(1);
}

const A = JSON.parse(fs.readFileSync(fileA, 'utf8'));
const B = JSON.parse(fs.readFileSync(fileB, 'utf8'));
const mA = A.baseline?.metrics || A.metrics;
const mB = B.baseline?.metrics || B.metrics;

if (!mA || !mB) { console.error('Invalid report format — missing metrics'); process.exit(1); }

const delta = (key) => {
	const d = mB[key] - mA[key];
	const sign = d > 0 ? '+' : '';
	return `${sign}${(d * 100).toFixed(1)}%`;
};
const pct = (v) => `${(v * 100).toFixed(1)}%`;

console.log(`\n── Eval Report Comparison ──`);
console.log(`  A: ${fileA}  (${A.run_at || '?'})`);
console.log(`  B: ${fileB}  (${B.run_at || '?'})`);
console.log(`  Questions: ${A.eval_set_size} → ${B.eval_set_size}`);
console.log(`\n  Metric       A          B          Δ`);
console.log(`  ${'─'.repeat(42)}`);

const metrics = ['recall_at_1', 'recall_at_5', 'recall_at_10', 'recall_at_20', 'mrr', 'ndcg_at_10'];
for (const m of metrics) {
	const label = m.replace(/_/g, '@').replace('at', '@').padEnd(12);
	console.log(`  ${label}   ${pct(mA[m]).padEnd(9)}  ${pct(mB[m]).padEnd(9)}  ${delta(m)}`);
}

// Phase source shift
const sA = A.baseline?.phase_source_distribution || {};
const sB = B.baseline?.phase_source_distribution || {};
const phases = [...new Set([...Object.keys(sA), ...Object.keys(sB)])].sort();
if (phases.length > 0) {
	console.log(`\n  Phase source distribution (hits only):`);
	console.log(`  ${'Phase'.padEnd(20)}  A     B     Δ`);
	console.log(`  ${'─'.repeat(38)}`);
	for (const p of phases) {
		const a = sA[p] || 0, b = sB[p] || 0;
		const d = b - a;
		console.log(`  ${p.padEnd(20)}  ${String(a).padEnd(5)} ${String(b).padEnd(5)} ${d > 0 ? '+' : ''}${d}`);
	}
}
console.log('');
