// Generation eval (TODO step 10): answer MultiHop-RAG queries from retrieved context,
// judge correctness against gold answers (exact/substring first, flash-lite judge fallback).
// Usage: node --env-file=.env tests/eval/run_generation.js [--limit=100] [--configs=full_tuned,vector_only]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initArangoClient } from '../../src/db/client.js';
import { loadEnvFromDB } from '../../src/db/env.js';
import { RetrievalEngine } from '../../src/retrieval.js';
import { callLLM } from '../../src/llm.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const LIMIT = parseInt(process.argv.find(a => a.startsWith('--limit='))?.split('=')[1] || '100', 10);
const CONFIGS_ARG = process.argv.find(a => a.startsWith('--configs='))?.split('=')[1] || null;
const GEN_MODEL = 'gemini-2.5-flash-lite';

const CONFIGS = {
	vector_only: { env: { OHARA_BM25_WEIGHT: '0', OHARA_SUMO_WEIGHT: '0', OHARA_ENTITY_PIVOT_WEIGHT: '0', OHARA_STRUCT_WEIGHT: '0', OHARA_CROSS_DOC_WEIGHT: '0', OHARA_VECTOR_WEIGHT: '1.0' } },
	full_tuned:  { env: { OHARA_BM25_WEIGHT: '0.6', OHARA_VECTOR_WEIGHT: '1.0' } },
};

function normAns(s) {
	return (s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

async function judge(question, gold, generated) {
	const g = normAns(gold), a = normAns(generated);
	if (!a) return { correct: false, method: 'empty' };
	if (a === g || a.includes(g) || (g.length > 3 && g.includes(a) && a.length > 2)) return { correct: true, method: 'string' };
	const prompt = `Question: ${question}\nGold answer: ${gold}\nCandidate answer: ${generated}\n\nDoes the candidate answer convey the same answer as the gold answer? Reply with exactly one word: YES or NO.`;
	const resp = await callLLM(prompt, { model: GEN_MODEL, cache: false });
	return { correct: /^\s*yes/i.test(resp || ''), method: 'llm' };
}

async function main() {
	await loadEnvFromDB();
	const db = await initArangoClient();
	const dbShim = {
		executeAQL: async (aql, vars) => (await db.query(aql, vars)).all(),
		query: async (aql, vars) => db.query(aql, vars),
	};
	const engine = new RetrievalEngine(dbShim);

	const all = JSON.parse(fs.readFileSync(path.resolve(ROOT, 'eval/multihop_queries.json'), 'utf8'));
	const answerable = all.filter(q => q.question_type !== 'null_query' && q.answer);
	// even sample across the 3 answerable types
	const byType = {};
	for (const q of answerable) (byType[q.question_type] ||= []).push(q);
	const per = Math.ceil(LIMIT / Object.keys(byType).length);
	const questions = Object.values(byType).flatMap(list => list.slice(0, per)).slice(0, LIMIT);
	console.log(`${questions.length} answerable queries (${Object.keys(byType).map(t => t + ':' + Math.min(per, byType[t].length)).join(', ')})`);

	const configNames = CONFIGS_ARG ? CONFIGS_ARG.split(',') : Object.keys(CONFIGS);
	const report = { run_at: new Date().toISOString(), model: GEN_MODEL, query_count: questions.length, configs: {} };

	for (const name of configNames) {
		const cfg = CONFIGS[name];
		if (!cfg) { console.error(`Unknown config: ${name}`); continue; }
		console.log(`\n── config: ${name} ──`);
		const saved = {};
		for (const [k, v] of Object.entries(cfg.env)) { saved[k] = process.env[k]; process.env[k] = v; }

		const perQ = [];
		for (let i = 0; i < questions.length; i++) {
			const q = questions[i];
			try {
				const result = await engine.query(q.question, { limit: 10 });
				const nodes = (result.results || []).map(r => r.node).filter(Boolean).slice(0, 10);
				const context = nodes.map((n, j) => `[${j + 1}] ${n.content || n.markdown_representation || ''}`).join('\n\n').slice(0, 24000);
				const gen = await callLLM(
					`Answer the question based on the context. Be concise: a short phrase, or exactly "Yes" or "No" for yes/no questions. You may combine facts from multiple context passages. Only reply "Insufficient information" if the context truly contains nothing relevant.\n\nContext:\n${context}\n\nQuestion: ${q.question}\nAnswer:`,
					{ model: GEN_MODEL, cache: false }
				);
				const verdict = await judge(q.question, q.answer, gen);
				perQ.push({ id: q.id, question_type: q.question_type, gold: q.answer, generated: (gen || '').slice(0, 200), correct: verdict.correct, judge: verdict.method });
			} catch (err) {
				perQ.push({ id: q.id, question_type: q.question_type, error: err.message, correct: false });
			}
			if ((i + 1) % 20 === 0) {
				const acc = perQ.filter(p => p.correct).length / perQ.length;
				console.log(`  [${name}] ${i + 1}/${questions.length} — accuracy so far: ${(acc * 100).toFixed(1)}%`);
			}
		}

		for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }

		const summary = { accuracy: perQ.filter(p => p.correct).length / perQ.length };
		for (const t of [...new Set(perQ.map(p => p.question_type))]) {
			const sub = perQ.filter(p => p.question_type === t);
			summary[t] = sub.filter(p => p.correct).length / sub.length;
		}
		console.log(' ', JSON.stringify(summary));
		report.configs[name] = { summary, per_question: perQ };
	}

	const out = path.resolve(ROOT, `eval/generation_multihop_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`);
	fs.writeFileSync(out, JSON.stringify(report, null, 1));
	console.log(`\nReport → ${out}`);
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
