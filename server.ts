import express from 'express';
import path from 'path';
import fs from 'fs';
import { getArangoDBSimulator } from './src/arangodb_sim.ts';
import { 
  getPipelineLogs, 
  isPipelineActive, 
  runPipelineExecution, 
  clearPipelineLogs,
  addPipelineLog
} from './src/pipeline_runner.ts';

// Setup directories
const INPUT_DIR = 'doc_pipeline/input';
const RAW_OUT_DIR = 'doc_pipeline/raw_output';
const FINAL_OUT_DIR = 'doc_pipeline/collections';

fs.mkdirSync(INPUT_DIR, { recursive: true });
fs.mkdirSync(RAW_OUT_DIR, { recursive: true });
fs.mkdirSync(FINAL_OUT_DIR, { recursive: true });

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '10mb' }));

  // Initialize DB
  const dbSim = getArangoDBSimulator();

  // API: Get current ArangoDB simulated collections and graph structures
  app.get('/api/database/state', (req, res) => {
    try {
      res.json({
        success: true,
        state: dbSim.getState()
      });
    } catch (err: any) {
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
    } catch (err: any) {
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
    } catch (err: any) {
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
    } catch (err: any) {
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
    } catch (err: any) {
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
    } catch (err: any) {
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
    } catch (err: any) {
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
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Mount clean, direct static handlers (No Vite build, serve everything from root folder instantly)
  app.use(express.static(path.join(process.cwd(), '.')));

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
