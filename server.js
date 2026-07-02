import { loadEnvFromDB } from './src/db/env.js';
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { GoogleGenAI } from '@google/genai';
import * as arangoClient from './src/db/client.js';
import { getArangoDBSimulator } from './src/db/simulator.js';
import { QuartzExporter } from './src/exporter.js';
import { RetrievalEngine } from './src/retrieval.js';
import { getIngestionQueue } from './src/ingest/queue.js';
import { runWorkerOnce, startWorkerLoop } from './src/ingest/worker.js';
import {
	getPipelineLogs,
	isPipelineActive,
	runPipelineExecution,
	clearPipelineLogs,
	addPipelineLog
} from './src/ingest/ingest.js';

// Tool catalog shared between /tools discovery and the MCP server (bin/ohara-mcp.js)
const AGENT_TOOLS = [
	{ name: 'ingest', description: 'Queue a document at a filesystem path for ingestion into the Space-Time Graph', input: { path: 'string' } },
	{ name: 'query', description: 'Run a hybrid (shallow + deep) search against the Space-Time Graph', input: { text: 'string', depth: 'number?' } },
	{ name: 'get_graph_context', description: 'Fetch the deep graph neighborhood of a given node id', input: { node_id: 'string', depth: 'number?' } }
];

// Setup directories
const INPUT_DIR = 'doc_pipeline/input';
const RAW_OUT_DIR = 'doc_pipeline/raw_output';
const FINAL_OUT_DIR = 'doc_pipeline/collections';

fs.mkdirSync(INPUT_DIR, { recursive: true });
fs.mkdirSync(RAW_OUT_DIR, { recursive: true });
fs.mkdirSync(FINAL_OUT_DIR, { recursive: true });

await loadEnvFromDB();

const PORT = process.env.PORT || 6454;
async function startServer() {
	const app = express();

	app.use(express.json({ limit: '10mb' }));

	// CORS: allow agent/MCP clients running from other origins to call the API
	app.use((req, res, next) => {
		res.header('Access-Control-Allow-Origin', '*');
		res.header('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
		res.header('Access-Control-Allow-Headers', 'Content-Type');
		if (req.method === 'OPTIONS') return res.sendStatus(204);
		next();
	});

	// Initialize DB
	const dbSim = getArangoDBSimulator();

	// Wire retrieval to real ArangoDB when available, otherwise use simulator shim
	let retrievalDB;
	if (process.env.ARANGO_URL) {
		await arangoClient.initArangoClient();
		await arangoClient.createSearchViewIfNotExists().catch(err =>
			console.warn('[server] Could not create ArangoSearch view:', err.message)
		);
		arangoClient.startPeriodicCleanup();
		retrievalDB = { executeAQL: (q, b) => arangoClient.executeAQL(q, b) };
	} else {
		// Simulator shim: executeAQL delegates to dbSim
		retrievalDB = {
			executeAQL: (q, b) => {
				const r = dbSim.executeAQL(q, b);
				return Promise.resolve(r?.results || []);
			},
		};
	}
	const retrievalEngine = new RetrievalEngine(retrievalDB);
	const ingestionQueue = getIngestionQueue();
	startWorkerLoop(process.env.GEMINI_API_KEY);

	// API: Get database stats - real ArangoDB when ARANGO_URL is set, otherwise simulator
	app.get('/api/database/state', async (req, res) => {
		try {
			if (process.env.ARANGO_URL) {
				const stats = await arangoClient.getStats();
				return res.json({ success: true, source: 'arangodb', stats });
			}
			res.json({ success: true, source: 'simulator', state: dbSim.getState() });
		} catch (err) {
			res.status(500).json({ success: false, error: err.message });
		}
	});

	// API: Document list only - cheap, used for the initial page load before any
	// document is selected (the full graph is no longer fetched eagerly).
	app.get('/api/documents', async (req, res) => {
		try {
			if (process.env.ARANGO_URL) {
				const db = await arangoClient.initArangoClient();
				const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);
				const offset = parseInt(req.query.offset || '0', 10);
				const [docs, totalArr, healthArr] = await Promise.all([
					db.query({
						query: `FOR d IN documents SORT d._key DESC LIMIT @offset, @limit RETURN d`,
						bindVars: { offset, limit },
					}).then(c => c.all()),
					db.query(`RETURN LENGTH(documents)`).then(c => c.all()),
					db.query(`
						RETURN {
							total: LENGTH(documents),
							partial: LENGTH(FOR d IN documents FILTER d.ingestion_status == 'partial' RETURN 1),
							needs_review: LENGTH(FOR d IN documents FILTER d.temporal_needs_review == true RETURN 1),
							total_entities: LENGTH(entities),
							total_paragraphs: LENGTH(paragraphs)
						}
					`).then(c => c.all()),
				]);
				const total = totalArr[0] || 0;
				const health = healthArr[0] || {};
				return res.json({ success: true, source: 'arangodb', documents: docs, total, offset, limit, health });
			}
			const all = dbSim.getState().documents || [];
			res.json({ success: true, source: 'simulator', documents: all, total: all.length, offset: 0, limit: all.length });
		} catch (err) {
			res.status(500).json({ success: false, error: err.message });
		}
	});

	// API: Patch temporal metadata on a single document (manual override).
	app.patch('/api/documents/:key', async (req, res) => {
		const ALLOWED = ['decay_class', 'effective_decay_class', 'published_date', 'temporal_needs_review'];
		const patch = {};
		for (const f of ALLOWED) if (req.body[f] !== undefined) patch[f] = req.body[f];
		if (Object.keys(patch).length === 0) return res.status(400).json({ success: false, error: 'No patchable fields' });
		try {
			if (process.env.ARANGO_URL) {
				const db = await arangoClient.initArangoClient();
				await db.query(`UPDATE @key WITH @patch IN documents`, { key: req.params.key, patch });
				return res.json({ success: true });
			}
			res.status(501).json({ success: false, error: 'Patch not supported on simulator' });
		} catch (err) {
			res.status(500).json({ success: false, error: err.message });
		}
	});

	// API: Structural graph (sections/paragraphs/tables) for a set of selected documents.
	// Entities, SUMO tags, and edges are intentionally NOT included here - those are
	// only ever fetched per-node via /api/graph/node/:collection/:key/neighbors, on click.
	app.get('/api/graph', async (req, res) => {
		try {
			if (process.env.ARANGO_URL) {
				const docKeys = (req.query.docKeys || '').split(',').map(s => s.trim()).filter(Boolean);
				if (docKeys.length === 0) {
					return res.status(400).json({ success: false, error: 'docKeys query param is required' });
				}
				const db = await arangoClient.initArangoClient();
				const [sections, paragraphs, tables] = await Promise.all([
					db.query(`
						FOR s IN sections
						FILTER s.document_id IN @docKeys
						SORT s.level ASC, s._key ASC
						RETURN { _key: s._key, _id: s._id, title: s.title, document_id: s.document_id, level: s.level, node_type: s.node_type, parent_section_id: s.parent_section_id }
					`, { docKeys }).then(c => c.all()),
					db.query(`
						FOR p IN paragraphs
						FILTER p.document_id IN @docKeys
						RETURN { _key: p._key, _id: p._id, document_id: p.document_id, section_id: p.section_id, node_type: p.node_type }
					`, { docKeys }).then(c => c.all()),
					db.query(`
						FOR t IN tables
						FILTER t.document_id IN @docKeys
						RETURN { _key: t._key, _id: t._id, document_id: t.document_id, section_id: t.section_id, node_type: t.node_type }
					`, { docKeys }).then(c => c.all()),
				]);
				return res.json({ success: true, source: 'arangodb', sections, paragraphs, tables });
			}
			// Simulator is tiny/in-memory - not the perf problem, so it isn't scoped by docKeys.
			const state = dbSim.getState();
			res.json({ success: true, source: 'simulator', sections: state.sections, paragraphs: state.paragraphs, tables: state.tables });
		} catch (err) {
			res.status(500).json({ success: false, error: err.message });
		}
	});

	// API: Lazy-load direct neighbors of a node (paragraphs, tables, sibling sections)
	app.get('/api/graph/node/:collection/:key/neighbors', async (req, res) => {
		try {
			if (!process.env.ARANGO_URL) return res.json({ success: true, nodes: [], edges: [] });
			const db = await arangoClient.initArangoClient();
			const nodeId = `${req.params.collection}/${req.params.key}`;

			// Get all edges touching this node
			const edgesCursor = await db.query(
				`FOR e IN edges
				FILTER e._from == @id OR e._to == @id
				RETURN { _key: e._key, _id: e._id, _from: e._from, _to: e._to, relation: e.relation }`,
				{ id: nodeId }
			);
			const edges = await edgesCursor.all();

			// Collect neighbor IDs not already in doc/section collections (i.e. paragraphs, tables)
			const neighborIds = new Set();
			for (const e of edges) {
				if (e._from !== nodeId) neighborIds.add(e._from);
				if (e._to   !== nodeId) neighborIds.add(e._to);
			}

			// Fetch paragraph and table neighbors in bulk
			const paraIds    = [...neighborIds].filter(id => id.startsWith('paragraphs/'));
			const tableIds   = [...neighborIds].filter(id => id.startsWith('tables/'));
			const sectionIds = [...neighborIds].filter(id => id.startsWith('sections/'));
			const entityIds  = [...neighborIds].filter(id => id.startsWith('entities/'));

			// If the clicked node is a paragraph/table, fetch its own full content too
			const selfParaIds  = nodeId.startsWith('paragraphs/') ? [nodeId] : [];
			const selfTableIds = nodeId.startsWith('tables/')     ? [nodeId] : [];
			const allParaIds   = [...new Set([...paraIds,  ...selfParaIds])];
			const allTableIds  = [...new Set([...tableIds, ...selfTableIds])];

			const [paragraphs, tables, sections, entities] = await Promise.all([
				allParaIds.length
					? db.query(
						`FOR p IN paragraphs
						FILTER p._id IN @ids
						RETURN { _key: p._key, _id: p._id, content: p.content, document_id: p.document_id, section_id: p.section_id, node_type: p.node_type, sumo_tags: p.sumo_tags, sumo_candidate_tags_raw: p.sumo_candidate_tags_raw }`,
						{ ids: allParaIds }
					).then(c => c.all())
					: [],
				allTableIds.length
					? db.query(
						`FOR t IN tables
						FILTER t._id IN @ids
						RETURN { _key: t._key, _id: t._id, document_id: t.document_id, section_id: t.section_id, node_type: t.node_type, matrix_data: t.matrix_data, markdown_representation: t.markdown_representation }`,
						{ ids: allTableIds }
					).then(c => c.all())
					: [],
				sectionIds.length
					? db.query(
						`FOR s IN sections
						FILTER s._id IN @ids
						RETURN { _key: s._key, _id: s._id, title: s.title, document_id: s.document_id, level: s.level, node_type: s.node_type, parent_section_id: s.parent_section_id }`,
						{ ids: sectionIds }
					).then(c => c.all())
					: [],
				entityIds.length
					? db.query(
						`FOR e IN entities
						FILTER e._id IN @ids
						RETURN { _key: e._key, _id: e._id, name: e.name, type: e.type, mention_count: e.mention_count, document_ids: e.document_ids }`,
						{ ids: entityIds }
					).then(c => c.all())
					: [],
			]);

			res.json({ success: true, paragraphs, tables, sections, entities, edges });
		} catch (err) {
			res.status(500).json({ success: false, error: err.message });
		}
	});

	// API: Re-seed database with default samples
	app.post('/api/database/seed', (req, res) => {
		try {
			dbSim.seedInitialData();
			res.json({
				success: true,
				message: 'Database seeded with default templates successfully.',
				state: dbSim.getState()
			});
		} catch (err) {
			res.status(500).json({ success: false, error: err.message });
		}
	});

	// API: Wipe database state
	app.post('/api/database/clear', (req, res) => {
		try {
			dbSim.clearAllData();
			res.json({
				success: true,
				message: 'Database state cleared.',
				state: dbSim.getState()
			});
		} catch (err) {
			res.status(500).json({ success: false, error: err.message });
		}
	});

	// API: Execute AQL queries
	app.post('/api/database/query', (req, res) => {
		try {
			const { query, bindVars } = req.body;
			const result = dbSim.executeAQL(query, bindVars || {});
			res.json({
				success: !result.error,
				results: result.results,
				stats: result.stats,
				error: result.error
			});
		} catch (err) {
			res.status(500).json({ success: false, error: err.message });
		}
	});

	// API: Get pipeline status and console execution logs
	app.get('/api/pipeline/status', (req, res) => {
		res.json({
			active: isPipelineActive(),
			logs: getPipelineLogs()
		});
	});

	// API: Get list of current input files on disk
	app.get('/api/pipeline/input-files', (req, res) => {
		try {
			const files = fs.readdirSync(INPUT_DIR)
				.filter(f => !f.startsWith('.'))
				.map(name => {
					const stats = fs.statSync(path.join(INPUT_DIR, name));
					return {
						name,
						size: `${(stats.size / 1024).toFixed(1)} KB`,
						mtime: stats.mtime
					};
				});
			res.json({ success: true, files });
		} catch (err) {
			res.status(500).json({ success: false, error: err.message });
		}
	});

	// API: Create/Upload custom document manually to inputs folder
	app.post('/api/pipeline/upload', (req, res) => {
		try {
			const { filename, content, format } = req.body;
			if (!filename) {
				return res.status(400).json({ success: false, error: 'Filename is required.' });
			}

			// Add appropriate extension if missing
			let resolvedName = filename;
			if (format && !filename.toLowerCase().endsWith(`.${format}`)) {
				resolvedName = `${filename}.${format}`;
			}

			// Safe save
			const targetPath = path.join(INPUT_DIR, resolvedName);
			fs.writeFileSync(targetPath, content || 'Empty document representation.', 'utf-8');

			res.json({
				success: true,
				message: `File "${resolvedName}" uploaded and queued in inputs successfully.`,
				file: {
					name: resolvedName,
					size: `${(content?.length || 0) / 1024} KB`
				}
			});
		} catch (err) {
			res.status(500).json({ success: false, error: err.message });
		}
	});

	// API: Trigger Extraction Pipeline run
	app.post('/api/pipeline/run', async (req, res) => {
		try {
			if (isPipelineActive()) {
				return res.status(400).json({ success: false, error: 'Pipeline is currently executing.' });
			}

			// Get the API Key from environment
			const apiKey = process.env.GEMINI_API_KEY;

			// Executing in background
			runPipelineExecution(apiKey);

			res.json({
				success: true,
				message: 'Pipeline workflow started successfully.'
			});
		} catch (err) {
			res.status(500).json({ success: false, error: err.message });
		}
	});

	// API: Post-ingest entity resolution - dedup and variant-link entities across all ingested docs
	app.post('/api/pipeline/resolve-entities', async (req, res) => {
		try {
			const apiKey = process.env.GEMINI_API_KEY;
			if (!apiKey) return res.status(400).json({ success: false, error: 'GEMINI_API_KEY not set.' });
			const { runEntityResolution } = await import('./src/entity_resolver.js');
			const manifest = await runEntityResolution(apiKey, FINAL_OUT_DIR);
			res.json({ success: true, stats: manifest.stats, output: `${FINAL_OUT_DIR}/entity_resolution.json` });
		} catch (err) {
			res.status(500).json({ success: false, error: err.message });
		}
	});

	// API: Multi-phase Hybrid Retrieval (BM25 + SUMO + Entity + Structural)
	app.post('/api/retrieval/query', async (req, res) => {
		try {
			const { query, depth, limit, expandDepth, crossDocLimit, crossDocWeight, selfRagVerify, sessionHistory, cor, agent, reasoningRag, rerank } = req.body;
			if (!query) {
				return res.status(400).json({ success: false, error: 'Query is required.' });
			}
			const queryFn = agent
				? retrievalEngine.queryAgent.bind(retrievalEngine)
				: cor
					? retrievalEngine.queryCoR.bind(retrievalEngine)
					: retrievalEngine.query.bind(retrievalEngine);
			const result = await queryFn(query, { depth, limit, expandDepth, crossDocLimit, crossDocWeight, selfRagVerify, sessionHistory, reasoningRag, rerank });
			res.json({ success: true, ...result });
		} catch (err) {
			res.status(500).json({ success: false, error: err.message });
		}
	});

	// REFEED RAG: store per-result user feedback for weight tuning
	app.post('/api/retrieval/feedback', async (req, res) => {
		try {
			const { query_hash, node_id, result_rank, signal } = req.body;
			if (!query_hash || !node_id || !signal) {
				return res.status(400).json({ success: false, error: 'query_hash, node_id, signal required.' });
			}
			if (!['positive', 'negative'].includes(signal)) {
				return res.status(400).json({ success: false, error: 'signal must be positive or negative.' });
			}
			const db = await arangoClient.initArangoClient();
			await db.collection('feedback').save({ query_hash, node_id, result_rank: result_rank || 0, signal, ts: new Date().toISOString() });
			res.json({ success: true });
		} catch (err) {
			res.status(500).json({ success: false, error: err.message });
		}
	});

	// API: Agent tool discovery (mirrors the MCP tool catalog in bin/ohara-mcp.js)
	app.get('/tools', (req, res) => {
		res.json({ success: true, tools: AGENT_TOOLS });
	});

	// API: Queue a single document for background ingestion (used by CLI `ohara ingest` and agents)
	app.post('/api/queue/ingest', async (req, res) => {
		try {
			const { filename, force = false } = req.body;
			if (!filename || !fs.existsSync(path.join(INPUT_DIR, filename))) {
				return res.status(400).json({ success: false, error: `File not staged in input dir: ${filename}` });
			}
			const job = await ingestionQueue.add('ingestion', { filename, force: !!force });
			res.json({ success: true, job });
		} catch (err) {
			res.status(500).json({ success: false, error: err.message });
		}
	});

	// API: Queue / worker status - optionally filtered by ?status=failed|completed|waiting
	app.get('/api/queue/jobs', async (req, res) => {
		try {
			const { status } = req.query;
			const [jobs, stats] = await Promise.all([
				ingestionQueue.list({ status }),
				ingestionQueue.stats(),
			]);
			res.json({ success: true, jobs, stats });
		} catch (err) {
			res.status(500).json({ success: false, error: err.message });
		}
	});

	// API: Requeue a failed/completed job (sets status back to waiting, resets attempts, optionally with --force)
	app.post('/api/queue/jobs/:id/retry', async (req, res) => {
		try {
			const job = await ingestionQueue.getJob(req.params.id);
			if (!job) return res.status(404).json({ success: false, error: 'Job not found' });
			const force = req.body?.force ?? false;
			await ingestionQueue.update(job.id, {
				status: 'waiting',
				attempts: 0,
				error: null,
				result: null,
				progress: 0,
				progressMessage: '',
				data: { ...job.data, force },
			});
			res.json({ success: true, job: await ingestionQueue.getJob(job.id) });
		} catch (err) {
			res.status(500).json({ success: false, error: err.message });
		}
	});

	// API: Delete a job record from the queue
	app.delete('/api/queue/jobs/:id', async (req, res) => {
		try {
			const removed = await ingestionQueue.remove(req.params.id);
			if (!removed) return res.status(404).json({ success: false, error: 'Job not found' });
			res.json({ success: true });
		} catch (err) {
			res.status(500).json({ success: false, error: err.message });
		}
	});

	// API: Answer synthesis - run retrieval then Gemini-generate a grounded answer with citations
	app.post('/api/retrieval/answer', async (req, res) => {
		try {
			const { query, sessionHistory, cor, agent, reasoningRag, selfRagVerify } = req.body;
			if (!query) return res.status(400).json({ success: false, error: 'query is required' });
			const apiKey = process.env.GEMINI_API_KEY;
			if (!apiKey) return res.status(500).json({ success: false, error: 'GEMINI_API_KEY not set' });

			const queryFn = agent
				? retrievalEngine.queryAgent.bind(retrievalEngine)
				: cor
					? retrievalEngine.queryCoR.bind(retrievalEngine)
					: retrievalEngine.query.bind(retrievalEngine);
			const result = await queryFn(query, { sessionHistory, reasoningRag, selfRagVerify });

			const principalNodes = (result.tiers?.principal?.length ? result.tiers.principal : result.results || []).slice(0, 6);
			if (!principalNodes.length) {
				return res.json({ success: true, answer: 'No relevant documents found.', citations: [], retrieval: result });
			}

			const context = principalNodes.map((r, i) => {
				const n = r.node || r;
				const src = n.document_id || n._id || '';
				const content = (n.content || n.markdown_representation || '').slice(0, 600);
				return `[${i + 1}] (${src})\n${content}`;
			}).join('\n\n');

			const prompt = `You are an expert assistant answering questions from a document knowledge base.\n\nQuestion: ${query}\n\nRelevant passages:\n${context}\n\nAnswer the question using only the passages above. Cite sources with [n] inline. Be concise. If passages don't answer the question, say so.`;

			const ai = new GoogleGenAI({ apiKey });
			const geminiRes = await ai.models.generateContent({
				model: 'gemini-2.5-flash-lite',
				contents: [{ role: 'user', parts: [{ text: prompt }] }],
				config: { temperature: 0.2 },
			});
			const answer = geminiRes.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';

			const citations = principalNodes.map((r, i) => {
				const n = r.node || r;
				return { ref: i + 1, document_id: n.document_id || '', node_id: n._id || '', title: n.title || '', score: r.score };
			});

			res.json({ success: true, answer, citations, retrieval: result });
		} catch (err) {
			res.status(500).json({ success: false, error: err.message });
		}
	});

	// API: Deep graph context for a node (backs the agent's "Focus on Node X" view)
	app.get('/api/retrieval/context/:nodeId', async (req, res) => {
		try {
			const nodeId = decodeURIComponent(req.params.nodeId);
			const depth = parseInt(req.query.depth, 10) || 2;
			const context = await retrievalEngine.getDeepContext(nodeId, undefined, { depth });
			res.json({ success: true, nodeId, context });
		} catch (err) {
			res.status(500).json({ success: false, error: err.message });
		}
	});

	// API: Generates a system-prompt snippet summarizing current graph state for Claude
	app.get('/api/agent/system-prompt', async (req, res) => {
		const stats = await ingestionQueue.stats();
		let counts;
		if (process.env.ARANGO_URL) {
			counts = await arangoClient.getStats().catch(() => null);
		}
		if (!counts) {
			const state = dbSim.getState();
			counts = { documents: state.documents.length, sections: state.sections.length,
								 paragraphs: state.paragraphs.length, tables: state.tables.length, edges: state.edges.length };
		}
		const prompt = [
			`You have access to the Doc Ohara Space-Time Graph via MCP tools (ingest, query, get_graph_context).`,
			`Current graph: ${counts.documents} document(s), ${counts.sections} section(s), ${counts.paragraphs} paragraph(s), ${counts.tables} table(s), ${counts.edges} edge(s).`,
			`Ingestion queue: waiting=${stats.waiting} active=${stats.active} completed=${stats.completed} failed=${stats.failed}.`,
		].join('\n');
		res.json({ success: true, prompt });
	});

	// API: Query Analytics - feedback accuracy by rank, top entities, tier summary
	app.get('/api/analytics', async (req, res) => {
		try {
			if (!process.env.ARANGO_URL) return res.json({ success: true, source: 'simulator', byRank: [], topEntities: [], summary: {} });
			const db = await arangoClient.initArangoClient();
			const [byRankRaw, topEntitiesRaw, summaryRaw] = await Promise.all([
				db.query(`
					FOR f IN feedback
						COLLECT rank = f.result_rank INTO group
						LET pos = LENGTH(FOR g IN group FILTER g.f.signal == 'positive' RETURN 1)
						LET neg = LENGTH(FOR g IN group FILTER g.f.signal == 'negative' RETURN 1)
						SORT rank ASC
						RETURN { rank, positive: pos, negative: neg, total: pos + neg }
				`).then(c => c.all()),
				db.query(`
					FOR f IN feedback FILTER f.signal == 'positive'
						COLLECT node_id = f.node_id WITH COUNT INTO cnt
						SORT cnt DESC LIMIT 10
						RETURN { node_id, count: cnt }
				`).then(c => c.all()),
				db.query(`
					RETURN {
						total_feedback: LENGTH(feedback),
						positive: LENGTH(FOR f IN feedback FILTER f.signal == 'positive' RETURN 1),
						negative: LENGTH(FOR f IN feedback FILTER f.signal == 'negative' RETURN 1),
						total_docs: LENGTH(documents),
						total_paragraphs: LENGTH(paragraphs),
						total_entities: LENGTH(entities)
					}
				`).then(c => c.all()),
			]);
			res.json({ success: true, byRank: byRankRaw, topEntities: topEntitiesRaw, summary: summaryRaw[0] || {} });
		} catch (err) {
			res.status(500).json({ success: false, error: err.message });
		}
	});

	// API: Trigger Quartz Wiki Export
	app.post('/api/quartz/export', async (req, res) => {
		try {
			const db = process.env.ARANGO_URL ? arangoClient.realDBAdapter() : dbSim;
			const exporter = new QuartzExporter(db, 'wiki');
			await exporter.export();
			res.json({
				success: true,
				message: 'Quartz wiki export completed successfully.',
				path: path.join(process.cwd(), 'wiki')
			});
		} catch (err) {
			res.status(500).json({ success: false, error: err.message });
		}
	});

	// API: Remove input file from staging
	app.delete('/api/pipeline/input-files/:name', (req, res) => {
		try {
			const name = req.params.name;
			const targetPath = path.join(INPUT_DIR, name);
			if (fs.existsSync(targetPath)) {
				fs.unlinkSync(targetPath);
				res.json({ success: true, message: `File deleted: ${name}` });
			} else {
				res.status(404).json({ success: false, error: 'File not found.' });
			}
		} catch (err) {
			res.status(500).json({ success: false, error: err.message });
		}
	});

	// Mount clean, direct static handlers (No Vite build, serve everything from root folder instantly)
	app.use(express.static(path.join(process.cwd(), '.')));

	// Agentic Command Center dashboard
	app.get('/agent', (req, res) => {
		res.sendFile(path.join(process.cwd(), 'agent.html'));
	});

	app.get('/', (req, res) => {
		res.sendFile(path.join(process.cwd(), 'index.html'));
	});

	app.get('*', (req, res) => {
		res.sendFile(path.join(process.cwd(), 'index.html'));
	});

	app.listen(PORT, '0.0.0.0', () => {
		console.log(`[Server] Document Pipeline listening on http://localhost:${PORT} in direct vanilla static mode.`);
	});
}

startServer();
