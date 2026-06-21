#!/usr/bin/env node
// Doc_Ohara CLI (ohara 2.0) — multi-action front-end over the Space-Time Graph.
import dotenv from 'dotenv';
dotenv.config();
import { Command } from 'commander';
import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import { getArangoDBSimulator } from '../src/arangodb_sim.js';
import { RetrievalEngine } from '../src/retrieval_engine.js';
import { getIngestionQueue } from '../src/queue.js';
import { runWorkerOnce } from '../src/worker.js';
import { QuartzExporter } from '../src/quartz_exporter.js';

const INPUT_DIR = 'doc_pipeline/input';

function emit(json, data, humanFn) {
  if (json) {
    console.log(JSON.stringify(data, null, 2));
  } else {
    humanFn(data);
  }
}

const program = new Command();
program
  .name('ohara')
  .description('Doc Ohara CLI — ingest, query, and manage the Space-Time Graph')
  .version('2.0.0');

program
  .command('ingest <path>')
  .description('Queue a document for processing')
  .option('--json', 'machine-readable output')
  .action(async (filePath, opts) => {
    fs.mkdirSync(INPUT_DIR, { recursive: true });
    if (!fs.existsSync(filePath)) {
      const msg = `File not found: ${filePath}`;
      emit(opts.json, { success: false, error: msg }, () => console.error(chalk.red(`✖ ${msg}`)));
      process.exitCode = 1;
      return;
    }

    const filename = path.basename(filePath);
    const destPath = path.join(INPUT_DIR, filename);
    fs.copyFileSync(filePath, destPath);

    const queue = getIngestionQueue();
    const job = queue.add('ingestion', { filename });

    if (!opts.json) {
      console.log(chalk.cyan(`Queued "${filename}" as job ${job.id}`));
    }

    const aiKey = process.env.GEMINI_API_KEY;
    const processed = await runWorkerOnce(aiKey);
    const outcome = processed.find(p => p.jobId === job.id);

    emit(opts.json, { success: !!outcome?.success, job: queue.getJob(job.id) }, () => {
      if (outcome?.success) {
        console.log(chalk.green(`✔ Ingested ${filename}: ${outcome.result.documents} document(s), ${outcome.result.nodes} node(s)`));
      } else {
        console.error(chalk.red(`✖ Ingestion failed: ${outcome?.error || 'unknown error'}`));
        process.exitCode = 1;
      }
    });
  });

program
  .command('query <text>')
  .description('Hybrid search (Phase 1) over the graph')
  .option('--json', 'machine-readable output')
  .option('--depth <n>', 'deep traversal depth', '2')
  .action((text, opts) => {
    const engine = new RetrievalEngine(getArangoDBSimulator());
    const result = engine.query(text, { depth: parseInt(opts.depth, 10) });

    emit(opts.json, { success: true, ...result }, () => {
      console.log(chalk.bold(`Top matches for "${text}":`));
      if (result.shallowResults.length === 0) {
        console.log(chalk.yellow('  (no matches)'));
      }
      result.shallowResults.forEach(({ node, score }) => {
        console.log(`  ${chalk.green(score.toFixed(2))}  ${node.title || node.content?.slice(0, 80) || node._id}`);
      });
    });
  });

program
  .command('ls')
  .description('List all ingested documents')
  .option('--json', 'machine-readable output')
  .action((opts) => {
    const docs = getArangoDBSimulator().getState().documents;
    emit(opts.json, { success: true, documents: docs }, () => {
      if (docs.length === 0) console.log(chalk.yellow('No documents ingested yet.'));
      docs.forEach(d => {
        console.log(`${chalk.cyan(d._key)}  ${d.title}  ${chalk.dim(`(${d.parser_engine}, ${d.file_size})`)}`);
      });
    });
  });

program
  .command('rm <doc_id>')
  .description('Delete a document and all its associated nodes/edges')
  .option('--json', 'machine-readable output')
  .action((docId, opts) => {
    const deleted = getArangoDBSimulator().deleteDocument(docId);
    emit(opts.json, { success: deleted }, () => {
      if (deleted) console.log(chalk.green(`✔ Deleted document "${docId}" and its graph nodes/edges.`));
      else {
        console.error(chalk.red(`✖ Document "${docId}" not found.`));
        process.exitCode = 1;
      }
    });
  });

program
  .command('status')
  .description('Check ArangoDB simulator health and ingestion queue state')
  .option('--json', 'machine-readable output')
  .action((opts) => {
    const state = getArangoDBSimulator().getState();
    const queueStats = getIngestionQueue().stats();
    const health = {
      database: {
        ok: true,
        documents: state.documents.length,
        sections: state.sections.length,
        paragraphs: state.paragraphs.length,
        tables: state.tables.length,
        edges: state.edges.length
      },
      queue: queueStats
    };
    emit(opts.json, { success: true, ...health }, () => {
      console.log(chalk.bold('Database:'), chalk.green('OK'), `(${health.database.documents} docs, ${health.database.edges} edges)`);
      console.log(chalk.bold('Queue:'), `waiting=${queueStats.waiting} active=${queueStats.active} completed=${queueStats.completed} failed=${queueStats.failed}`);
    });
  });

program
  .command('export')
  .description('Trigger the wiki exporter')
  .option('--format <format>', 'quartz or json', 'quartz')
  .option('--json', 'machine-readable output')
  .action(async (opts) => {
    const dbSim = getArangoDBSimulator();
    if (opts.format === 'json') {
      const outPath = path.join(process.cwd(), 'doc_pipeline/collections/export.json');
      fs.writeFileSync(outPath, JSON.stringify(dbSim.getState(), null, 2), 'utf-8');
      emit(opts.json, { success: true, path: outPath }, () => console.log(chalk.green(`✔ Exported JSON to ${outPath}`)));
      return;
    }

    const exporter = new QuartzExporter(dbSim, 'wiki');
    await exporter.export();
    const outPath = path.join(process.cwd(), 'wiki');
    emit(opts.json, { success: true, path: outPath }, () => console.log(chalk.green(`✔ Exported Quartz wiki to ${outPath}`)));
  });

program.parse();
