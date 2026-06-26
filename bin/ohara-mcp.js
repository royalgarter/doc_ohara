#!/usr/bin/env node
// Doc_Ohara MCP Server — exposes ingest/query/get_graph_context to MCP clients (e.g. Claude Code)
// over stdio. Configure in Claude Code with: claude mcp add ohara -- node bin/ohara-mcp.js
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import { getArangoDBSimulator } from '../src/db/simulator.js';
import { RetrievalEngine } from '../src/retrieval.js';
import { getIngestionQueue } from '../src/ingest/queue.js';
import { runWorkerOnce } from '../src/ingest/worker.js';

const INPUT_DIR = 'doc_pipeline/input';

const server = new McpServer({ name: 'doc-ohara', version: '2.0.0' });

server.registerTool(
	'ingest',
	{
		title: 'Ingest a document',
		description: 'Queue a document at the given filesystem path for ingestion into the Space-Time Graph',
		inputSchema: { path: z.string().describe('Absolute or relative path to the document') }
	},
	async ({ path: filePath }) => {
		if (!fs.existsSync(filePath)) {
			return { content: [{ type: 'text', text: `File not found: ${filePath}` }], isError: true };
		}
		fs.mkdirSync(INPUT_DIR, { recursive: true });
		const filename = path.basename(filePath);
		fs.copyFileSync(filePath, path.join(INPUT_DIR, filename));

		const queue = getIngestionQueue();
		const job = queue.add('ingestion', { filename });
		await runWorkerOnce(process.env.GEMINI_API_KEY);
		const finished = queue.getJob(job.id);

		return { content: [{ type: 'text', text: JSON.stringify(finished, null, 2) }] };
	}
);

server.registerTool(
	'query',
	{
		title: 'Query the graph',
		description: 'Run a hybrid (shallow + deep) search against the Space-Time Graph',
		inputSchema: { text: z.string().describe('Natural language search query'), depth: z.number().optional() }
	},
	async ({ text, depth }) => {
		const engine = new RetrievalEngine(getArangoDBSimulator());
		const result = engine.query(text, { depth: depth || 2 });
		return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
	}
);

server.registerTool(
	'get_graph_context',
	{
		title: 'Get graph context for a node',
		description: 'Fetch the deep graph neighborhood (parents/children/siblings) of a given node id',
		inputSchema: { node_id: z.string().describe('e.g. "documents/quantum_paper_001"'), depth: z.number().optional() }
	},
	async ({ node_id, depth }) => {
		const engine = new RetrievalEngine(getArangoDBSimulator());
		const context = engine.getDeepContext(node_id, undefined, { depth: depth || 2 });
		return { content: [{ type: 'text', text: JSON.stringify(context, null, 2) }] };
	}
);

const transport = new StdioServerTransport();
await server.connect(transport);
