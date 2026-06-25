#!/usr/bin/env node
// Admin query scripts for the Doc Ohara Space-Time Graph.
// Usage: node scripts/admin-queries.js [query-name]
// Available queries: docs, sections, tags, tag-coverage, missing-tags, repair-stats, missing-temporal, decay-distribution, all
import dotenv from 'dotenv';
dotenv.config();
import { loadEnvFromDB } from '../src/db/env.js';
import { initArangoClient } from '../src/db/client.js';
import { getArangoDBSimulator } from '../src/db/simulator.js';
import fs from 'fs';
import path from 'path';

// Unified query executor — real ArangoDB or simulator
async function makeExec() {
	if (process.env.ARANGO_URL) {
		await loadEnvFromDB();
		const db = await initArangoClient();
		return async (aql, vars = {}) => {
			const cursor = await db.query(aql, vars);
			return cursor.all();
		};
	}
	const sim = getArangoDBSimulator();
	return async (aql) => sim.executeAQL(aql).results ?? [];
}

function pct(n, total) {
	if (!total) return '—';
	return `${((n / total) * 100).toFixed(1)}%`;
}

const queries = {
	async docs(exec) {
		const rows = await exec(
			'FOR d IN documents SORT d.upload_time DESC RETURN { id: d._key, title: d.title, engine: d.parser_engine, size: d.file_size, uploaded: d.upload_time }'
		);
		console.log('\n=== Documents ===');
		if (!rows.length) { console.log('  (none)'); return; }
		rows.forEach(d => console.log(`  [${d.id}] ${d.title}  (${d.engine}, ${d.size}, uploaded: ${d.uploaded})`));
		console.log(`  Total: ${rows.length}`);
	},

	async sections(exec) {
		const rows = await exec(
			'FOR s IN sections SORT s.document_id, s.level RETURN { id: s._key, doc: s.document_id, title: s.title, level: s.level }'
		);
		console.log('\n=== Sections ===');
		if (!rows.length) { console.log('  (none)'); return; }
		rows.forEach(s => console.log(`  [${s.doc}] ${'  '.repeat(s.level || 0)}${s.title}  (level ${s.level})`));
		console.log(`  Total: ${rows.length}`);
	},

	async tags(exec) {
		const rows = await exec('FOR p IN paragraphs RETURN p.sumo_tags');
		const tagFreq = {};
		rows.forEach(tags => {
			(tags || []).forEach(t => { tagFreq[t] = (tagFreq[t] || 0) + 1; });
		});
		const sorted = Object.entries(tagFreq).sort((a, b) => b[1] - a[1]);
		console.log('\n=== SUMO Tag Frequency ===');
		if (!sorted.length) { console.log('  (no tags found)'); return; }
		sorted.forEach(([tag, count]) => console.log(`  ${tag.padEnd(40)} ${count}`));
		console.log(`  Unique tags: ${sorted.length}`);
	},

	async 'tag-coverage'(exec) {
		const rows = await exec('FOR p IN paragraphs RETURN { sumo_tags: p.sumo_tags, raw: p.sumo_candidate_tags_raw }');
		const total = rows.length;
		const withTags = rows.filter(p => p.sumo_tags && p.sumo_tags.length > 0).length;
		const withCandidates = rows.filter(p => p.raw && p.raw.length > 0).length;
		console.log('\n=== SUMO Tag Coverage ===');
		console.log(`  Total paragraphs:            ${total}`);
		console.log(`  With validated sumo_tags:    ${withTags}  (${pct(withTags, total)})`);
		console.log(`  With raw candidates:         ${withCandidates}  (${pct(withCandidates, total)})`);
		console.log(`  No tags at all:              ${total - withCandidates}  (${pct(total - withCandidates, total)})`);
	},

	async 'missing-tags'(exec) {
		const rows = await exec('FOR p IN paragraphs RETURN { key: p._key, sumo_tags: p.sumo_tags, raw: p.sumo_candidate_tags_raw, content: p.content }');
		const gaps = rows.filter(p => p.raw && p.raw.length > 0 && (!p.sumo_tags || p.sumo_tags.length === 0));
		console.log('\n=== Paragraphs with unresolved candidate tags ===');
		if (!gaps.length) { console.log('  (none — great coverage!)'); return; }
		gaps.forEach(p => {
			console.log(`  [${p.key}] candidates: ${p.raw.join(', ')}`);
			console.log(`    content: ${String(p.content || '').slice(0, 100)}…`);
		});
		console.log(`  Total gaps: ${gaps.length}`);
	},

	async 'missing-temporal'(exec) {
		const rows = await exec('FOR d IN documents RETURN { key: d._key, title: d.title, published_date: d.published_date }');
		const missing = rows.filter(d => !d.published_date);
		const present = rows.filter(d => d.published_date);
		console.log('\n=== Temporal Metadata Coverage ===');
		console.log(`  Total documents:        ${rows.length}`);
		console.log(`  With published_date:    ${present.length}`);
		console.log(`  Missing published_date: ${missing.length}`);
		if (missing.length) {
			console.log('\n  Documents missing temporal metadata:');
			missing.forEach(d => console.log(`    [${d.key}] ${d.title}`));
		}
	},

	async 'decay-distribution'(exec) {
		const rows = await exec('FOR d IN documents RETURN { title: d.title, key: d._key, decay_class: d.decay_class, effective_decay_class: d.effective_decay_class, published_date: d.published_date, temporal_confidence: d.temporal_confidence }');
		const byCls = {};
		for (const d of rows) {
			const cls = d.effective_decay_class || d.decay_class || '(unset)';
			byCls[cls] = byCls[cls] || [];
			byCls[cls].push(d.title || d.key);
		}
		console.log('\n=== Decay Class Distribution ===');
		for (const [cls, titles] of Object.entries(byCls)) {
			console.log(`  ${cls.padEnd(12)} (${titles.length}): ${titles.join(', ')}`);
		}
		const withDate = rows.filter(d => d.published_date).length;
		const avgConf = rows.reduce((s, d) => s + (d.temporal_confidence || 0), 0) / Math.max(rows.length, 1);
		console.log(`\n  published_date populated: ${withDate}/${rows.length}`);
		console.log(`  temporal_confidence avg:  ${avgConf.toFixed(2)}`);
	},

	async 'repair-stats'(_exec) {
		const diagDir = path.join('doc_pipeline', 'diagnostics');
		if (!fs.existsSync(diagDir)) { console.log('\n=== Repair Stats ===\n  (no diagnostics files found)'); return; }
		const files = fs.readdirSync(diagDir).filter(f => f.endsWith('.json'));
		if (!files.length) { console.log('\n=== Repair Stats ===\n  (no diagnostics files found)'); return; }

		let totalChunks = 0, totalCacheHits = 0, totalRepairs = 0, totalRepairSuccess = 0, totalFailures = 0;
		console.log('\n=== LLM Repair & Cache Statistics (per run) ===');
		files.sort().reverse().slice(0, 10).forEach(f => {
			const run = JSON.parse(fs.readFileSync(path.join(diagDir, f), 'utf-8'));
			totalChunks      += run.total_chunks       || 0;
			totalCacheHits   += run.cache_hits         || 0;
			totalRepairs     += run.repairs_attempted  || 0;
			totalRepairSuccess += run.repairs_succeeded || 0;
			totalFailures    += run.failures           || 0;
			console.log(`  ${f}`);
			console.log(`    chunks=${run.total_chunks}  cache_hits=${run.cache_hits}  repairs=${run.repairs_attempted}/${run.repairs_succeeded} ok  failures=${run.failures}`);
		});
		if (files.length > 10) console.log(`  … and ${files.length - 10} older run(s)`);
		console.log(`\n  Totals across shown runs:`);
		console.log(`    chunks=${totalChunks}  cache_hit_rate=${pct(totalCacheHits, totalChunks)}  repair_success_rate=${pct(totalRepairSuccess, totalRepairs)}  failure_rate=${pct(totalFailures, totalChunks)}`);
	},
};

const arg = process.argv[2] || 'all';
const exec = await makeExec();
const source = process.env.ARANGO_URL ? 'ArangoDB' : 'simulator';
console.log(`(source: ${source})`);

if (arg === 'all') {
	for (const fn of Object.values(queries)) await fn(exec);
} else if (queries[arg]) {
	await queries[arg](exec);
} else {
	console.error(`Unknown query "${arg}". Available: ${Object.keys(queries).join(', ')}, all`);
	process.exit(1);
}
