import 'dotenv/config';
import { loadEnvFromDB } from './src/db/env.js';
import express from 'express';
import path from 'path';
import fs from 'fs';
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
} from './src/ingest/pipeline.js';

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
  const retrievalEngine = new RetrievalEngine(dbSim);
  const ingestionQueue = getIngestionQueue();
  startWorkerLoop(process.env.GEMINI_API_KEY);

  // API: Get database stats — real ArangoDB when ARANGO_URL is set, otherwise simulator
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

  // API: Graph data for the UI — queries real ArangoDB when available, falls back to simulator
  app.get('/api/graph', async (req, res) => {
    try {
      if (process.env.ARANGO_URL) {
        const db = await arangoClient.initArangoClient();
        const [docs, sections, paragraphs, tables, edges] = await Promise.all([
          db.query('FOR d IN documents SORT d._key DESC RETURN d').then(c => c.all()),
          db.query('FOR s IN sections SORT s.level ASC, s._key ASC RETURN {_key:s._key,_id:s._id,title:s.title,document_id:s.document_id,level:s.level,node_type:s.node_type,parent_section_id:s.parent_section_id}').then(c => c.all()),
          db.query('LET docKeys = (FOR d IN documents RETURN d._key) FOR p IN paragraphs FILTER p.document_id IN docKeys RETURN {_key:p._key,_id:p._id,document_id:p.document_id,section_id:p.section_id,node_type:p.node_type}').then(c => c.all()),
          db.query('LET docKeys = (FOR d IN documents RETURN d._key) FOR t IN tables FILTER t.document_id IN docKeys RETURN {_key:t._key,_id:t._id,document_id:t.document_id,section_id:t.section_id,node_type:t.node_type}').then(c => c.all()),
          db.query('LET docKeys = (FOR d IN documents RETURN d._key) LET validIds = UNION((FOR d IN documents RETURN d._id),(FOR s IN sections FILTER s.document_id IN docKeys RETURN s._id),(FOR p IN paragraphs FILTER p.document_id IN docKeys RETURN p._id),(FOR t IN tables FILTER t.document_id IN docKeys RETURN t._id)) FOR e IN edges FILTER e._from IN validIds OR e._to IN validIds RETURN {_key:e._key,_id:e._id,_from:e._from,_to:e._to,relation:e.relation}').then(c => c.all()),
        ]);
        return res.json({ success: true, source: 'arangodb', documents: docs, sections, paragraphs, tables, edges });
      }
      const state = dbSim.getState();
      res.json({ success: true, source: 'simulator', ...state });
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
        'FOR e IN edges FILTER e._from == @id OR e._to == @id RETURN {_key:e._key,_id:e._id,_from:e._from,_to:e._to,relation:e.relation}',
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

      // If the clicked node is a paragraph/table, fetch its own full content too
      const selfParaIds  = nodeId.startsWith('paragraphs/') ? [nodeId] : [];
      const selfTableIds = nodeId.startsWith('tables/')     ? [nodeId] : [];
      const allParaIds   = [...new Set([...paraIds,  ...selfParaIds])];
      const allTableIds  = [...new Set([...tableIds, ...selfTableIds])];

      const [paragraphs, tables, sections] = await Promise.all([
        allParaIds.length
          ? db.query('FOR p IN paragraphs FILTER p._id IN @ids RETURN {_key:p._key,_id:p._id,content:p.content,document_id:p.document_id,section_id:p.section_id,node_type:p.node_type,sumo_tags:p.sumo_tags,sumo_candidate_tags_raw:p.sumo_candidate_tags_raw}', { ids: allParaIds }).then(c=>c.all())
          : [],
        allTableIds.length
          ? db.query('FOR t IN tables FILTER t._id IN @ids RETURN {_key:t._key,_id:t._id,document_id:t.document_id,section_id:t.section_id,node_type:t.node_type,matrix_data:t.matrix_data,markdown_representation:t.markdown_representation}', { ids: allTableIds }).then(c=>c.all())
          : [],
        sectionIds.length
          ? db.query('FOR s IN sections FILTER s._id IN @ids RETURN {_key:s._key,_id:s._id,title:s.title,document_id:s.document_id,level:s.level,node_type:s.node_type,parent_section_id:s.parent_section_id}', { ids: sectionIds }).then(c=>c.all())
          : [],
      ]);

      res.json({ success: true, paragraphs, tables, sections, edges });
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

  // API: Two-Step Hybrid Retrieval (Shallow + Deep context)
  app.post('/api/retrieval/query', (req, res) => {
    try {
      const { query, depth, limit } = req.body;
      if (!query) {
        return res.status(400).json({ success: false, error: 'Query is required.' });
      }
      const result = retrievalEngine.query(query, { depth, limit });
      res.json({ success: true, ...result });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // API: Agent tool discovery (mirrors the MCP tool catalog in bin/ohara-mcp.js)
  app.get('/tools', (req, res) => {
    res.json({ success: true, tools: AGENT_TOOLS });
  });

  // API: Queue a single document for background ingestion (used by CLI `ohara ingest` and agents)
  app.post('/api/queue/ingest', (req, res) => {
    try {
      const { filename } = req.body;
      if (!filename || !fs.existsSync(path.join(INPUT_DIR, filename))) {
        return res.status(400).json({ success: false, error: `File not staged in input dir: ${filename}` });
      }
      const job = ingestionQueue.add('ingestion', { filename });
      res.json({ success: true, job });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // API: Queue / worker status — optionally filtered by ?status=failed|completed|waiting
  app.get('/api/queue/jobs', (req, res) => {
    const { status } = req.query;
    const jobs = status ? ingestionQueue.list({ status }) : ingestionQueue.list();
    res.json({ success: true, jobs, stats: ingestionQueue.stats() });
  });

  // API: Requeue a failed/completed job (sets status back to waiting, resets attempts, optionally with --force)
  app.post('/api/queue/jobs/:id/retry', (req, res) => {
    try {
      const job = ingestionQueue.getJob(req.params.id);
      if (!job) return res.status(404).json({ success: false, error: 'Job not found' });
      const force = req.body?.force ?? false;
      ingestionQueue.update(job.id, {
        status: 'waiting',
        attempts: 0,
        error: null,
        result: null,
        progress: 0,
        progressMessage: '',
        data: { ...job.data, force },
      });
      res.json({ success: true, job: ingestionQueue.getJob(job.id) });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // API: Delete a job record from the queue
  app.delete('/api/queue/jobs/:id', (req, res) => {
    try {
      const removed = ingestionQueue.remove(req.params.id);
      if (!removed) return res.status(404).json({ success: false, error: 'Job not found' });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // API: Deep graph context for a node (backs the agent's "Focus on Node X" view)
  app.get('/api/retrieval/context/:nodeId', (req, res) => {
    try {
      const nodeId = decodeURIComponent(req.params.nodeId);
      const depth = parseInt(req.query.depth, 10) || 2;
      const context = retrievalEngine.getDeepContext(nodeId, undefined, { depth });
      res.json({ success: true, nodeId, context });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // API: Generates a system-prompt snippet summarizing current graph state for Claude
  app.get('/api/agent/system-prompt', async (req, res) => {
    const stats = ingestionQueue.stats();
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
