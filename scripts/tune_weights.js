// REFEED RAG: read feedback collection, compute per-phase accuracy, suggest OHARA_*_WEIGHT values.
// Usage: node scripts/tune_weights.js [--apply]
//   --apply  Write suggested weights to .env file in-place
import * as client from '../src/db/client.js';
import fs from 'node:fs';
import path from 'node:path';

const APPLY = process.argv.includes('--apply');
const ENV_PATH = path.resolve(process.cwd(), '.env');

const PHASE_WEIGHTS = {
	fulltext: 'OHARA_BM25_WEIGHT (fusion weight for BM25 results, default 1.0 - not an env var yet)',
	sumo: 'OHARA_SUMO_WEIGHT (fusion weight for SUMO expansion, default 0.4 - not an env var yet)',
	entity: 'OHARA_ENTITY_PIVOT_WEIGHT',
	crossdoc: 'OHARA_CROSS_DOC_WEIGHT',
	structural: 'OHARA_STRUCT_WEIGHT (fusion weight for structural traversal, default 0.3 - not an env var yet)',
	temporal: 'OHARA_TEMPORAL_WEIGHT',
};

(async () => {
	try {
		const db = await client.initArangoClient();

		// Load all feedback
		const rows = await db.query(
			'FOR f IN feedback SORT f.ts ASC RETURN f'
		).then(c => c.all());

		if (!rows.length) {
			console.log('No feedback recorded yet. Use POST /api/retrieval/feedback to record signals.');
			process.exit(0);
		}

		console.log(`\nFeedback records: ${rows.length}`);
		console.log(`Date range: ${rows[0].ts} → ${rows[rows.length - 1].ts}\n`);

		// Per-rank accuracy
		const byRank = {};
		for (const r of rows) {
			const rank = r.result_rank || 0;
			if (!byRank[rank]) byRank[rank] = { positive: 0, negative: 0 };
			byRank[rank][r.signal]++;
		}
		console.log('=== Rank → Accuracy ===');
		for (const [rank, counts] of Object.entries(byRank).sort((a, b) => a[0] - b[0])) {
			const total = counts.positive + counts.negative;
			const acc = (counts.positive / total * 100).toFixed(1);
			console.log(`  Rank ${rank}: ${acc}% positive (${total} signals)`);
		}

		// Per-node accuracy: join with retrieval results to get source phases
		// (requires node_id to carry phase info - stored if passed from UI)
		const positive = rows.filter(r => r.signal === 'positive').length;
		const negative = rows.filter(r => r.signal === 'negative').length;
		const overallAcc = (positive / rows.length * 100).toFixed(1);
		console.log(`\nOverall accuracy: ${overallAcc}% (${positive}+ / ${negative}-)`);

		console.log('\n=== Suggested Actions ===');
		if (overallAcc < 50) {
			console.log('  Low overall accuracy. Consider:');
			console.log('  - Raise OHARA_PRINCIPAL_SCORE_PCTL (stricter Principal floor)');
			console.log('  - Lower OHARA_ENTITY_PIVOT_WEIGHT (entity pivot may be adding noise)');
		} else if (overallAcc > 80) {
			console.log('  High accuracy. Consider:');
			console.log('  - Raise OHARA_CROSS_DOC_WEIGHT to surface more cross-doc results');
			console.log('  - Increase OHARA_CROSS_DOC_EXPAND_DEPTH for deeper multi-hop');
		} else {
			console.log('  Accuracy in healthy range (50-80%). No immediate weight changes needed.');
		}

		console.log('\nPhase weight env vars:');
		for (const [phase, envVar] of Object.entries(PHASE_WEIGHTS)) {
			console.log(`  ${phase}: ${envVar}`);
		}

		// --apply: write suggested weights to .env
		if (APPLY && fs.existsSync(ENV_PATH)) {
			const suggestions = [];
			if (overallAcc < 50) {
				suggestions.push(['OHARA_ENTITY_PIVOT_WEIGHT', '0.4']);
				suggestions.push(['OHARA_PRINCIPAL_SCORE_PCTL', '0.85']);
			} else if (overallAcc > 80) {
				suggestions.push(['OHARA_CROSS_DOC_WEIGHT', '0.6']);
				suggestions.push(['OHARA_CROSS_DOC_EXPAND_DEPTH', '2']);
			}
			if (suggestions.length) {
				let env = fs.readFileSync(ENV_PATH, 'utf8');
				for (const [key, val] of suggestions) {
					const re = new RegExp(`^${key}=.*$`, 'm');
					if (re.test(env)) {
						env = env.replace(re, `${key}=${val}`);
					} else {
						env += `\n${key}=${val}`;
					}
				}
				fs.writeFileSync(ENV_PATH, env, 'utf8');
				console.log('\nApplied to .env:');
				for (const [k, v] of suggestions) console.log(`  ${k}=${v}`);
			} else {
				console.log('\n--apply: no changes needed.');
			}
		} else if (APPLY) {
			console.warn('\n--apply: .env not found, skipping write.');
		}
	} catch (e) {
		console.error('Error:', e.message);
		process.exit(1);
	}
})();
