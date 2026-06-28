#!/usr/bin/env node
// Doc_Ohara MCP Server — exposes ingest/query/answer/get_graph_context to MCP clients
// Register with Claude Code: claude mcp add ohara -- node bin/ohara-mcp.js
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import * as arangoClient from '../src/db/client.js';
import { getArangoDBSimulator } from '../src/db/simulator.js';
import { RetrievalEngine } from '../src/retrieval.js';
import { getIngestionQueue } from '../src/ingest/queue.js';
import { runWorkerOnce } from '../src/ingest/worker.js';

const INPUT_DIR = 'doc_pipeline/input';

// Init real DB if ARANGO_URL set, else fall back to in-memory simulator
let retrievalEngine;
async function getEngine() {
	if (retrievalEngine) return retrievalEngine;
	if (process.env.ARANGO_URL) {
		await arangoClient.initArangoClient();
		const db = { executeAQL: (q, b) => arangoClient.executeAQL(q, b) };
		retrievalEngine = new RetrievalEngine(db);
	} else {
		retrievalEngine = new RetrievalEngine(getArangoDBSimulator());
	}
	return retrievalEngine;
}

const server = new McpServer({ name: 'doc-ohara', version: '2.0.0' });

server.registerTool(
	'ingest',
	{
		title: 'Ingest a document',
		description: 'Copy a document into the pipeline input directory and run ingestion synchronously. Supports PDF, EPUB, DOCX, and plain Markdown.',
		inputSchema: {
			path: z.string().describe('Absolute or relative filesystem path to the document'),
			force: z.boolean().optional().describe('Re-ingest even if already processed (skips SHA-256 dedup). Default false.'),
		}
	},
	async ({ path: filePath, force = false }) => {
		if (!fs.existsSync(filePath)) {
			return { content: [{ type: 'text', text: `File not found: ${filePath}` }], isError: true };
		}
		fs.mkdirSync(INPUT_DIR, { recursive: true });
		const filename = path.basename(filePath);
		fs.copyFileSync(filePath, path.join(INPUT_DIR, filename));

		const queue = getIngestionQueue();
		const job = await queue.add('ingestion', { filename, force });
		await runWorkerOnce(process.env.GEMINI_API_KEY);
		const finished = await queue.getJob(job.id);

		const status = finished?.status || 'unknown';
		const msg = finished?.error ? `Error: ${finished.error}` : `Ingestion ${status}`;
		return { content: [{ type: 'text', text: `${msg}\n\n${JSON.stringify(finished, null, 2)}` }] };
	}
);

server.registerTool(
	'query',
	{
		title: 'Query the Space-Time Graph',
		description: 'Run hybrid retrieval (BM25 + SUMO + entity pivot + structural traversal) against ingested documents. Returns ranked results with Principal/Integrity/Explorer tier breakdown.',
		inputSchema: {
			text: z.string().describe('Natural language search query'),
			mode: z.enum(['standard', 'cor', 'agent']).optional().describe('Retrieval mode: standard (default), cor (Chain-of-Retrieval multi-hop), agent (Gemini-guided tool dispatch)'),
			limit: z.number().optional().describe('Max results to return (default 20)'),
			depth: z.number().optional().describe('Structural traversal depth (default 2)'),
			session_history: z.array(z.object({ role: z.string(), content: z.string() })).optional().describe('Prior conversation turns for Conversational RAG anaphora resolution'),
			self_rag_verify: z.boolean().optional().describe('Run Gemini responsiveness check on Principal tier (opt-in)'),
			reasoning_rag: z.boolean().optional().describe('Generate gap-filling sub-queries after BM25 (opt-in)'),
		}
	},
	async ({ text, mode = 'standard', limit, depth, session_history, self_rag_verify, reasoning_rag }) => {
		const engine = await getEngine();
		const opts = {
			limit,
			depth,
			sessionHistory: session_history,
			selfRagVerify: self_rag_verify,
			reasoningRag: reasoning_rag,
		};
		const queryFn = mode === 'agent'
			? engine.queryAgent.bind(engine)
			: mode === 'cor'
				? engine.queryCoR.bind(engine)
				: engine.query.bind(engine);

		const result = await queryFn(text, opts);

		const summary = {
			total_results: result.results?.length || 0,
			principal_count: result.tiers?.principal?.length || 0,
			integrity_count: result.tiers?.integrity?.length || 0,
			explorer_frontier: result.tiers?.explorer?.frontier?.length || 0,
			agent_trace: result.agent_trace,
			cor_iterations: result.cor_iter_count,
			top_results: (result.results || []).slice(0, 5).map(r => ({
				id: r.node?._id,
				score: r.score,
				sources: r.sources,
				snippet: (r.node?.content || r.node?.title || '').slice(0, 200),
				edge_verb: r.edge_verb,
			})),
			principal: (result.tiers?.principal || []).map(r => ({
				id: r.node?._id,
				score: r.score,
				sources: r.sources,
				snippet: (r.node?.content || r.node?.title || '').slice(0, 300),
			})),
			explorer_frontier_items: result.tiers?.explorer?.frontier?.slice(0, 3),
		};
		return { content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }] };
	}
);

server.registerTool(
	'answer',
	{
		title: 'Answer a question with citations',
		description: 'Retrieve relevant passages then synthesise a Gemini-grounded answer with inline [n] citations. Returns answer text + citation list.',
		inputSchema: {
			query: z.string().describe('Natural language question to answer'),
			mode: z.enum(['standard', 'cor', 'agent']).optional().describe('Underlying retrieval mode (default standard)'),
			session_history: z.array(z.object({ role: z.string(), content: z.string() })).optional(),
		}
	},
	async ({ query, mode = 'standard', session_history }) => {
		const apiKey = process.env.GEMINI_API_KEY;
		if (!apiKey) return { content: [{ type: 'text', text: 'GEMINI_API_KEY not set' }], isError: true };

		const engine = await getEngine();
		const opts = { sessionHistory: session_history };
		const queryFn = mode === 'agent'
			? engine.queryAgent.bind(engine)
			: mode === 'cor'
				? engine.queryCoR.bind(engine)
				: engine.query.bind(engine);

		const result = await queryFn(query, opts);
		const principalNodes = (result.tiers?.principal?.length ? result.tiers.principal : result.results || []).slice(0, 6);

		if (!principalNodes.length) {
			return { content: [{ type: 'text', text: 'No relevant documents found.' }] };
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

		return {
			content: [{
				type: 'text',
				text: `${answer}\n\n---\nCitations:\n${citations.map(c => `[${c.ref}] ${c.title || c.node_id} (${c.document_id}) score=${c.score?.toFixed(3)}`).join('\n')}`,
			}]
		};
	}
);

server.registerTool(
	'get_graph_context',
	{
		title: 'Get graph context for a node',
		description: 'Fetch the structural graph neighbourhood (parents/children/siblings via HAS_CHILD, NEXT_SIBLING, BELONGS_TO) of a given node ID.',
		inputSchema: {
			node_id: z.string().describe('Full node ID, e.g. "paragraphs/abc123" or "documents/quantum_paper_001"'),
			depth: z.number().optional().describe('Traversal depth (default 2)'),
		}
	},
	async ({ node_id, depth = 2 }) => {
		const engine = await getEngine();
		const context = await engine.getDeepContext(node_id, undefined, { depth });
		return {
			content: [{
				type: 'text',
				text: JSON.stringify(
					(context || []).map(r => ({
						id: r.node?._id,
						type: r.node?._id?.split('/')[0],
						title: r.node?.title,
						snippet: (r.node?.content || '').slice(0, 200),
					})),
					null, 2
				),
			}]
		};
	}
);

const transport = new StdioServerTransport();
await server.connect(transport);
