import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import crypto from 'crypto';
import { GoogleGenAI } from '@google/genai';
import { getArangoDBSimulator } from '../db/simulator.js';
import { cacheKeyFor, readCacheAsync, writeCache, readCacheSync, hasCache, credFingerprint, getCacheDir } from '../cache.js';
import { chunkMarkdown, readMarkdownFile } from './chunker.js';
import * as arangoClient from '../db/client.js';
import { validateTags } from '../sumo.js';

const GEMINI_MODEL = 'gemini-2.5-flash-lite';

// Global log tracking for the active pipeline run
let currentLogs = [];
let isPipelineRunning = false;

export function getPipelineLogs() {
  return currentLogs;
}

export function isPipelineActive() {
  return isPipelineRunning;
}

// Clear or add logs
export function clearPipelineLogs() {
  currentLogs = [];
}

export function addPipelineLog(level, message) {
  const log = {
    timestamp: new Date().toISOString(),
    level,
    message
  };
  currentLogs.push(log);
  console.log(`[Pipeline] ${level.toUpperCase()}: ${message}`);
}

// Trigger standard pipeline simulation or AI-driven extraction
export async function runPipelineExecution(aiKey) {
  if (isPipelineRunning) {
    addPipelineLog('warn', 'Pipeline is already executing. Trigger ignored.');
    return;
  }

  isPipelineRunning = true;
  clearPipelineLogs();
  
  addPipelineLog('info', '🚀 Launching AI Document Extraction Workers...');

  const inputDir = 'doc_pipeline/input';
  const rawOutputDir = 'doc_pipeline/raw_output';
  const collectionsDir = 'doc_pipeline/collections';

  try {
    // Ensure dirs exist
    fs.mkdirSync(inputDir, { recursive: true });
    fs.mkdirSync(rawOutputDir, { recursive: true });
    fs.mkdirSync(collectionsDir, { recursive: true });

    // Read input files
    const files = fs.readdirSync(inputDir).filter(f => !f.startsWith('.'));
    if (files.length === 0) {
      addPipelineLog('warn', '⚠️ No input files detected in doc_pipeline/input/. Copying workspace samples...');
      
      // Write some default sample names to input
      fs.writeFileSync(path.join(inputDir, 'research_thesis.pdf'), 'Highly complex physics dissertation on unified theories.', 'utf-8');
      fs.writeFileSync(path.join(inputDir, 'operation_handbook.docx'), 'Corporate procedures and operational class codes.', 'utf-8');
      
      // Refresh list
      files.push('research_thesis.pdf', 'operation_handbook.docx');
    }

    addPipelineLog('info', `Found ${files.length} document(s) in queue.`);

    const arangoDb = getArangoDBSimulator();

    // Setup Gemini if key is provided
    let ai = null;
    if (aiKey) {
      try {
        ai = new GoogleGenAI({
          apiKey: aiKey,
          httpOptions: { headers: { 'User-Agent': 'aistudio-build' } }
        });
        addPipelineLog('info', '🤖 Secure server-side Gemini layout model initialized.');
      } catch (err) {
        addPipelineLog('warn', `Gemini client failed to boot (${err.message}). Defaulting to layout template simulation.`);
      }
    }

    for (const filename of files) {
      const ext = path.extname(filename).toLowerCase().replace('.', '') || 'txt';
      const filenameNoExt = path.basename(filename, path.extname(filename));
      
      addPipelineLog('info', `Processing file: "${filename}" (Format: ${ext.toUpperCase()})`);

      // Determine parser route
      const isPdf = ext === 'pdf';
      const engineName = isPdf ? 'MinerU' : 'Docling';

      addPipelineLog('info', `🔥 Routing ${filename} to ${engineName} engine...`);

      // Create raw output container subdirectory
      const targetSubDir = path.join(rawOutputDir, filename);
      fs.mkdirSync(targetSubDir, { recursive: true });

      let parsedLayoutJSON = null;

      // Real or mocked parser content
      const fileContentPath = path.join(inputDir, filename);
      const isRealFile = fs.existsSync(fileContentPath);
      const contentExcerpt = isRealFile 
        ? fs.readFileSync(fileContentPath, 'utf-8').slice(0, 1500)
        : "Standard document content for layout extraction.";

      // Attempt parsing: prefer LiteParse -> structure Markdown via system prompt -> fallback to AI layout or local templates
      parsedLayoutJSON = await performParsing(ai, filename, fileContentPath, isPdf, targetSubDir);
      addPipelineLog('info', `Parser produced output for ${filename}.`);

      // Save raw output JSON file
      const rawJsonPath = path.join(targetSubDir, `${filenameNoExt}.json`);
      fs.writeFileSync(rawJsonPath, JSON.stringify(parsedLayoutJSON, null, 2), 'utf-8');
      addPipelineLog('success', `Completed raw layouts parse for ${filename}. Output written to raw_output/`);
    }

    // Standard run of transform.js logic inside the pipeline runner
    addPipelineLog('info', '🔄 Invoking Node.js Collection Transformation Engine...');
    await delay(1000);

    // Transform raw files into database collection arrays
    const transformedDocs = transformRawToCollections(rawOutputDir);
    
    addPipelineLog('info', '📦 Std relational arrays compiled successfully.');

    // Write collections JSON onto disk matching specs
    fs.writeFileSync(path.join(collectionsDir, 'documents.json'), JSON.stringify(transformedDocs.documents, null, 2), 'utf-8');
    fs.writeFileSync(path.join(collectionsDir, 'sections.json'), JSON.stringify(transformedDocs.sections, null, 2), 'utf-8');
    fs.writeFileSync(path.join(collectionsDir, 'paragraphs.json'), JSON.stringify(transformedDocs.paragraphs, null, 2), 'utf-8');
    fs.writeFileSync(path.join(collectionsDir, 'tables.json'), JSON.stringify(transformedDocs.tables, null, 2), 'utf-8');

    // Load nodes & edges into ArangoDB Simulation
    addPipelineLog('info', '🗄️ Syncing collections into ArangoDB multi-model storage...');
    await delay(800);

    for (const doc of transformedDocs.documents) {
      // Insert into real ArangoDB when ARANGO_URL present, otherwise simulator
      if (process.env.ARANGO_URL) {
        try {
          await arangoClient.initArangoClient();
          const inserted = await arangoClient.insertDocument({
            source_file: doc.source_file,
            parser_engine: doc.parser_engine,
            title: doc.title,
            file_size: doc.file_size || '350 KB',
            upload_time: new Date().toISOString()
          });

          const docsSections = transformedDocs.sections.filter(s => s.document_id === doc.id);
          for (const sec of docsSections) {
            await arangoClient.insertSection({
              document_id: inserted._key,
              title: sec.title,
              level: sec.level
            });
          }

          const docsParagraphs = transformedDocs.paragraphs.filter(p => p.document_id === doc.id);
          for (const p of docsParagraphs) {
            await arangoClient.insertParagraph({
              document_id: inserted._key,
              section_id: p.section_id ? `sections/${p.section_id}` : null,
              content: p.content,
              is_latex: p.content.includes('\\') || p.content.includes('^') || p.content.includes('_')
            });
          }

          const docsTables = transformedDocs.tables.filter(t => t.document_id === doc.id);
          for (const t of docsTables) {
            await arangoClient.insertTable({
              document_id: inserted._key,
              section_id: t.section_id ? `sections/${t.section_id}` : null,
              matrix_data: t.matrix_data || [],
              markdown_representation: t.markdown_representation || ''
            });
          }

        } catch (err) {
          addPipelineLog('error', `ArangoDB persistence failed for ${doc.source_file}: ${err.message}`);
          throw err;
        }
      } else {
        // simulator path
        const insertedDoc = arangoDb.insertDocument({
          _key: doc.id,
          source_file: doc.source_file,
          parser_engine: doc.parser_engine,
          title: doc.title,
          file_size: doc.file_size || '350 KB',
          upload_time: new Date().toISOString()
        });

        // Filter sections belonging to this doc
        const docsSections = transformedDocs.sections.filter(s => s.document_id === doc.id);
        docsSections.forEach(sec => {
          arangoDb.insertSection({
            _key: sec.id,
            document_id: insertedDoc._key,
            title: sec.title,
            level: sec.level
          });
        });

        // Insert paragraphs
        const docsParagraphs = transformedDocs.paragraphs.filter(p => p.document_id === doc.id);
        docsParagraphs.forEach(p => {
          arangoDb.insertParagraph({
            _key: p.id,
            document_id: insertedDoc._key,
            section_id: p.section_id ? `sections/${p.section_id}` : null,
            content: p.content,
            is_latex: p.content.includes('\\') || p.content.includes('^') || p.content.includes('_')
          });
        });

        // Insert tables
        const docsTables = transformedDocs.tables.filter(t => t.document_id === doc.id);
        docsTables.forEach(t => {
          arangoDb.insertTable({
            _key: t.id,
            document_id: insertedDoc._key,
            section_id: t.section_id ? `sections/${t.section_id}` : null,
            matrix_data: t.matrix_data || [],
            markdown_representation: t.markdown_representation || ''
          });
        });
      }
    }

    addPipelineLog('success', `📦 Syncing complete! Standardized databases contains ${transformedDocs.documents.length} document roots, ${transformedDocs.sections.length} layout sections, ${transformedDocs.paragraphs.length} paragraphs/equations, and ${transformedDocs.tables.length} table matrices. All linked via edge records.`);
    addPipelineLog('success', '✅ Pipeline successfully completed!');

  } catch (err) {
    addPipelineLog('error', `Pipeline execution crashed: ${err.message}`);
  } finally {
    isPipelineRunning = false;
  }
}

// Call Gemini API to extract raw layout
async function generateAILayout(ai, filename, content, isPdf) {
  const prompt = `
You are simulating a layout extraction worker: ${isPdf ? 'MinerU' : 'Docling'}.
Analyze the document text or file context given below and return custom-structured elements corresponding to how these high-end parsing packages function.

${isPdf ? 'PDF / Academic MinerU Instructions' : 'Standard Document Docling Instructions'}:
- For PDF / MinerU: Match academic publications. Extract titles, sections, latex equations (where appropriate, like standard LaTeX mathematical blocks in raw format e.g. "E = mc^2" or integrals), tables, and body paragraphs.
- For non-PDF / Docling: Extract standard enterprise components: headings, normal paragraphs, bullet list items, and table cells.

**Output Schema Formats**:
${isPdf ? `
1. MinerU JSON format (return this structure EXACTLY as-is):
{
  "pdf_body": [
    { "type": "title", "text": "Extracted document title" },
    { "type": "heading", "text": "1. Section Heading Title" },
    { "type": "text", "text": "Underlying paragraph text content details..." },
    { "type": "equation", "latex": "\\\\int_{a}^{b} f(x) \\\\, dx = F(b) - F(a)" },
    { "type": "table", "table_cells": [["Col 1", "Col 2"], ["Val A", "Val B"]], "markdown": "| Col 1 | Col 2 |\\n|---|---|\\n| Val A | Val B |" }
  ]
}
` : `
2. Docling JSON format (return this structure EXACTLY as-is):
{
  "document": {
    "name": "Standardized name of document",
    "texts": [
      { "label": "heading_1", "text": "Section Heading Level 1" },
      { "label": "paragraph", "text": "Detailed standard body paragraph content..." },
      { "label": "list_item", "text": "- Important list bullet details..." }
    ],
    "tables": [
      { "data": [["Col X", "Col Y"], ["Value 1", "Value 2"]], "markdown": "| Col X | Col Y |\\n|---|---|\\n| Value 1 | Value 2 |" }
    ]
  }
}
`}

Return ONLY valid plain JSON. Do not include any HTML, explanatory notes, or formatting code-blocks. Start with { and end with }.

Document Name: "${filename}"
Document text content:
${content}
`;

  const result = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: prompt
  });

  const parsedText = result.text?.trim() || '{}';
  const cleanJson = parsedText.replace(/^```json/gi, '').replace(/^```/gi, '').replace(/```$/gi, '').trim();
  
  return JSON.parse(cleanJson);
}

// Attempt to run LiteParse CLI to convert source to Markdown
function attemptLiteParse(sourcePath, outMdPath) {
  try {
    // sample command: lit parse sample/Mastering\ Bitcoin\ 2nd.pdf --format markdown -o mastering_bitcoin_2nd.md
    const cmd = `lit parse "${sourcePath}" --format markdown -o "${outMdPath}"`;
    execSync(cmd, { stdio: 'ignore' });
    return fs.existsSync(outMdPath);
  } catch (err) {
    return false;
  }
}

// Remove \X escape sequences that are invalid in JSON (markdown escapes like \*, \_, \[, \(, etc.).
// Valid JSON escapes are: \" \\ \/ \b \f \n \r \t \uXXXX — everything else is illegal.
function sanitizeJsonEscapes(s) {
  return s.replace(/\\([^"\\\/bfnrtu\n\r])/g, (_, ch) => ch);
}

// Helper: attempt to extract a JSON object from noisy LLM text outputs.
// Tries progressively more aggressive fixes before giving up.
function safeParseJsonFromText(text) {
  const t = String(text || '').trim();

  // 1. direct parse
  try { return JSON.parse(t); } catch (_) {}

  // 2. strip markdown fences then try again
  let s = t.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
  try { return JSON.parse(s); } catch (_) {}

  // 3. sanitize invalid escape sequences (e.g. \* \_ from LLM markdown habits) then parse
  const sanitized = sanitizeJsonEscapes(s);
  try { return JSON.parse(sanitized); } catch (_) {}

  // 4. extract the outermost JSON object, sanitize, fix trailing commas
  const jsonBlockMatch = sanitized.match(/\{[\s\S]*\}/m);
  if (jsonBlockMatch) {
    const candidate = jsonBlockMatch[0];
    try { return JSON.parse(candidate); } catch (_) {}
    const fixed = candidate.replace(/,\s*([}\]])/g, '$1');
    try { return JSON.parse(fixed); } catch (_) {}
  }

  // 5. find a fenced ```json ... ``` block inside the text, sanitize, fix trailing commas
  const codeJson = s.match(/```json([\s\S]*?)```/i);
  if (codeJson && codeJson[1]) {
    const candidate = sanitizeJsonEscapes(codeJson[1].trim());
    try { return JSON.parse(candidate); } catch (_) {}
    const fixed = candidate.replace(/,\s*([}\]])/g, '$1');
    try { return JSON.parse(fixed); } catch (_) {}
  }

  throw new Error('Unable to extract valid JSON from LLM output');
}

// Use AI + system prompt to transform Markdown into structured JSON nodes
async function generateFromMarkdown(ai, mdContent, filename) {
  try {
    const promptTemplate = fs.readFileSync(path.join('prompts', 'ingest_document.md'), 'utf-8');
    const prompt = `${promptTemplate}\n\nDOCUMENT_MARKDOWN:\n\n${mdContent}`;
    const result = await ai.models.generateContent({ model: GEMINI_MODEL, contents: prompt });
    const parsedText = result.text?.trim() || '{}';
    const cleanJson = parsedText.replace(/^```json/gi, '').replace(/^```/gi, '').replace(/```$/gi, '').trim();
    return safeParseJsonFromText(cleanJson);
  } catch (err) {
    // Bubble up error to allow upstream fallback handling
    throw err;
  }
}

// Perform parsing: strict LiteParse-first -> structure Markdown via system prompt with retries and cache.
// No synthetic fallbacks allowed. On persistent failure, throw an error so the job can be retried/failed upstream.
async function performParsing(ai, filename, fileContentPath, isPdf, targetSubDir) {
  const filenameNoExt = path.basename(filename, path.extname(filename));
  const mdOutPath = path.join(targetSubDir, `${filenameNoExt}.md`);

  // If input is already Markdown, skip LiteParse and use it directly
  const ext = path.extname(filename).toLowerCase();
  const isMarkdown = ext === '.md' || ext === '.markdown' || fileContentPath.endsWith('.md');

  if (isMarkdown) {
    // read and chunk
    const mdContent = fs.readFileSync(fileContentPath, 'utf-8');
    return await structureMarkdownWithRetries(ai, filename, mdContent);
  }

  // Try LiteParse CLI with retries
  let attempt = 0;
  const maxAttempts = 3;
  while (attempt < maxAttempts) {
    attempt += 1;
    addPipelineLog('info', `Attempt ${attempt}/${maxAttempts}: running LiteParse for ${filename}`);
    const ok = attemptLiteParse(fileContentPath, mdOutPath);
    if (ok && fs.existsSync(mdOutPath)) {
      const mdContent = fs.readFileSync(mdOutPath, 'utf-8');
      return await structureMarkdownWithRetries(ai, filename, mdContent);
    }
    if (attempt < maxAttempts) {
      addPipelineLog('warn', `LiteParse failed for ${filename}, retrying in 30s...`);
      await delay(30000);
    }
  }

  // All attempts failed
  const err = new Error(`LiteParse failed after ${maxAttempts} attempts for ${filename}`);
  err.code = 'LITEPARSE_FAILED';
  throw err;
}

// Structure markdown using chunking + LLM with cache and retries
async function structureMarkdownWithRetries(ai, filename, mdContent) {
  if (!ai) {
    const err = new Error('No LLM client available for structuring Markdown. GEMINI_API_KEY must be set.');
    err.code = 'NO_LLM_CREDENTIAL';
    throw err;
  }

  let chunks = chunkMarkdown(mdContent, { maxChars: 12000 });
  // test override: limit number of chunks processed when OHARA_TEST_CHUNKS_LIMIT is set
  const testLimit = parseInt(process.env.OHARA_TEST_CHUNKS_LIMIT || '0', 10) || 0;
  if (testLimit > 0) {
    addPipelineLog('info', `OHARA_TEST_CHUNKS_LIMIT set: trimming to ${testLimit} chunk(s)`);
    chunks = chunks.slice(0, testLimit);
  }
  addPipelineLog('info', `Markdown split into ${chunks.length} chunk(s) for ${filename}`);

  // parallel pool
  const concurrency = parseInt(process.env.OHARA_INGEST_CONCURRENCY || '4', 10) || 4;

  // per-run diagnostics: one entry per chunk, written to doc_pipeline/diagnostics/
  const chunkDiagnostics = [];

  async function worker(chunk) {
    const diag = {
      chunk_id: chunk.id,
      heading: chunk.heading || null,
      started_at: new Date().toISOString(),
      cache_hit: false,
      attempts: 0,
      repair_attempted: false,
      repair_succeeded: false,
      raw_llm_output: null,
      repair_raw_output: null,
      parse_error: null,
      repair_error: null,
      outcome: 'unknown',
      usage: { prompt_tokens: 0, candidates_tokens: 0, total_tokens: 0, repair_prompt_tokens: 0, repair_candidates_tokens: 0 },
    };
    chunkDiagnostics.push(diag);

    const systemPrompt = fs.readFileSync(path.join('prompts', 'ingest_document.md'), 'utf-8');
    const promptNorm = systemPrompt.trim();
    const modelId = GEMINI_MODEL;
    const credFp = credFingerprint();
    const key = cacheKeyFor([promptNorm, chunk.text, modelId, credFp]);

    const cached = await readCacheAsync(key);
    if (cached && cached.parsed_json) {
      addPipelineLog('info', `Cache hit for chunk ${chunk.id}`);
      diag.cache_hit = true;
      diag.outcome = 'cache_hit';
      return cached.parsed_json;
    }

    // not cached -> call LLM with retries
    const maxAttempts = 3;
    let attempt = 0;
    while (attempt < maxAttempts) {
      attempt += 1;
      diag.attempts = attempt;
      try {
        addPipelineLog('info', `LLM structuring chunk ${chunk.id} (attempt ${attempt}/${maxAttempts})`);
        const prompt = `${promptNorm}\n\nDOCUMENT_CHUNK_HEADING:${chunk.heading || ''}\n\n${chunk.text}`;
        const resp = await ai.models.generateContent({ model: modelId, contents: prompt });
        const um = resp.usageMetadata || {};
        diag.usage.prompt_tokens     += um.promptTokenCount     || 0;
        diag.usage.candidates_tokens += um.candidatesTokenCount || 0;
        diag.usage.total_tokens      += um.totalTokenCount      || 0;
        const parsedText = resp.text?.trim() || '{}';
        diag.raw_llm_output = parsedText;
        const cleanJson = parsedText.replace(/^```json/gi, '').replace(/^```/gi, '').replace(/```$/gi, '').trim();
        let parsed;
        try {
          parsed = safeParseJsonFromText(cleanJson);
        } catch (parseErr) {
          diag.parse_error = parseErr.message;
          addPipelineLog('warn', `Failed to parse LLM output for chunk ${chunk.id}: ${parseErr.message}`);
          writeCache(key, { parsed_json: null, raw: parsedText, meta: { modelId, cached_at: new Date().toISOString(), parse_error: parseErr.message } });

          // Attempt automated repair
          diag.repair_attempted = true;
          try {
            addPipelineLog('info', `Attempting automated repair for chunk ${chunk.id}`);
            const repairPrompt = `The text below may contain a JSON object mixed with commentary or markdown fences. Extract and return ONLY the JSON object (no explanation, no markdown fences). If multiple objects exist, return the single top-level object.\n\nNOISY_OUTPUT:\n${parsedText}`;
            const repairResp = await ai.models.generateContent({ model: modelId, contents: repairPrompt });
            const rum = repairResp.usageMetadata || {};
            diag.usage.repair_prompt_tokens     += rum.promptTokenCount     || 0;
            diag.usage.repair_candidates_tokens += rum.candidatesTokenCount || 0;
            diag.usage.total_tokens             += rum.totalTokenCount      || 0;
            const repairText = repairResp.text?.trim() || '';
            diag.repair_raw_output = repairText;
            try {
              const repaired = safeParseJsonFromText(repairText);
              writeCache(key, { parsed_json: repaired, raw: parsedText, repair_raw: repairText, meta: { modelId, repaired_at: new Date().toISOString() } });
              addPipelineLog('info', `Automated repair succeeded for chunk ${chunk.id}`);
              diag.repair_succeeded = true;
              diag.outcome = 'repaired';
              return repaired;
            } catch (rpErr) {
              diag.repair_error = rpErr.message;
              addPipelineLog('warn', `Automated repair failed for chunk ${chunk.id}: ${rpErr.message}`);
            }
          } catch (repairErr) {
            diag.repair_error = repairErr.message;
            addPipelineLog('warn', `Repair LLM call failed for chunk ${chunk.id}: ${repairErr.message}`);
          }

          throw parseErr;
        }
        writeCache(key, { parsed_json: parsed, raw: parsedText, meta: { modelId, cached_at: new Date().toISOString() } });
        diag.outcome = 'success';
        return parsed;
      } catch (err) {
        addPipelineLog('warn', `LLM error on chunk ${chunk.id}: ${err.message}`);
        if (attempt < maxAttempts) {
          addPipelineLog('info', `Retrying chunk ${chunk.id} in 30s...`);
          await delay(30000);
          continue;
        }
        diag.outcome = 'failed';
        const e = new Error(`LLM structuring failed for chunk ${chunk.id} after ${maxAttempts} attempts: ${err.message}`);
        e.code = 'LLM_FAILED';
        throw e;
      }
    }
  }

  // process chunks in batches with fixed concurrency
  const resultsArr = [];
  for (let i = 0; i < chunks.length; i += concurrency) {
    const batch = chunks.slice(i, i + concurrency);
    const promises = batch.map(async (chunk) => {
      const res = await worker(chunk);
      return { chunk, res };
    });
    const batchResults = await Promise.all(promises);
    resultsArr.push(...batchResults);
  }

  // Aggregate token usage across all chunks
  const usageTotals = chunkDiagnostics.reduce((acc, d) => {
    acc.prompt_tokens            += d.usage.prompt_tokens;
    acc.candidates_tokens        += d.usage.candidates_tokens;
    acc.total_tokens             += d.usage.total_tokens;
    acc.repair_prompt_tokens     += d.usage.repair_prompt_tokens;
    acc.repair_candidates_tokens += d.usage.repair_candidates_tokens;
    return acc;
  }, { prompt_tokens: 0, candidates_tokens: 0, total_tokens: 0, repair_prompt_tokens: 0, repair_candidates_tokens: 0 });

  // write per-run diagnostics export
  try {
    const diagDir = path.join('doc_pipeline', 'diagnostics');
    fs.mkdirSync(diagDir, { recursive: true });
    const diagFile = path.join(diagDir, `${filename.replace(/[^a-z0-9_.-]/gi, '_')}_${Date.now()}.json`);
    const summary = {
      filename,
      model: GEMINI_MODEL,
      generated_at: new Date().toISOString(),
      total_chunks: chunks.length,
      cache_hits: chunkDiagnostics.filter(d => d.cache_hit).length,
      repairs_attempted: chunkDiagnostics.filter(d => d.repair_attempted).length,
      repairs_succeeded: chunkDiagnostics.filter(d => d.repair_succeeded).length,
      failures: chunkDiagnostics.filter(d => d.outcome === 'failed').length,
      llm_usage: usageTotals,
      chunks: chunkDiagnostics,
    };
    fs.writeFileSync(diagFile, JSON.stringify(summary, null, 2), 'utf-8');
    addPipelineLog('info', `Chunk diagnostics written to ${diagFile}`);
    addPipelineLog('info', `LLM usage — prompt: ${usageTotals.prompt_tokens} tokens, generated: ${usageTotals.candidates_tokens} tokens, total: ${usageTotals.total_tokens} tokens`);
  } catch (diagErr) {
    addPipelineLog('warn', `Failed to write diagnostics: ${diagErr.message}`);
  }

  // merge results preserving chunk order
  const mergedNodes = [];
  const chunkIdToIndex = new Map();
  chunks.forEach((c, i) => chunkIdToIndex.set(c.id, i));
  const ordered = resultsArr.sort((a, b) => chunkIdToIndex.get(a.chunk.id) - chunkIdToIndex.get(b.chunk.id));

  for (const entry of ordered) {
    const parsed = entry.res;
    if (!parsed) {
      const err = new Error(`Empty parsed output for chunk ${entry.chunk.id}`);
      err.code = 'EMPTY_CHUNK_PARSE';
      throw err;
    }
    // Expect parsed to be { nodes: [...] } or { document: { texts: [...] } }
    if (parsed.nodes) {
      mergedNodes.push(...parsed.nodes);
    } else if (parsed.document && Array.isArray(parsed.document.texts)) {
      parsed.document.texts.forEach(t => mergedNodes.push({ type: t.label === 'paragraph' ? 'Paragraph' : 'Paragraph', content: t.text, title: t.label && t.label.startsWith('heading') ? t.text : undefined }));
    } else {
      const err = new Error('Unexpected parsed schema from LLM; aborting ingestion');
      err.code = 'INVALID_SCHEMA';
      throw err;
    }
  }

  // Validate SUMO candidate tags for each node and promote to sumo_tags.
  // Provenance: sumo_candidate_tags (original LLM output) is preserved alongside
  // sumo_tags (validated canonicals) and sumo_resolved_map (alias mappings used).
  try {
    for (const node of mergedNodes) {
      if (node && Array.isArray(node.sumo_candidate_tags)) {
        const { valid, invalid, resolved_map } = validateTags(node.sumo_candidate_tags);
        node.sumo_tags = valid;
        // keep original candidates for audit; rename to make intent clear
        node.sumo_candidate_tags_raw = node.sumo_candidate_tags;
        delete node.sumo_candidate_tags;
        if (Object.keys(resolved_map).length > 0) {
          node.sumo_resolved_map = resolved_map;
        }
        if (invalid && invalid.length > 0) {
          addPipelineLog('warn', `Node SUMO validation dropped ${invalid.length} tag(s): ${invalid.join(', ')}`);
        }
      }
    }
  } catch (e) {
    addPipelineLog('error', `SUMO tag validation failed: ${e.message}`);
    const err = new Error('SUMO_VALIDATION_FAILED');
    err.code = 'SUMO_VALIDATION_FAILED';
    throw err;
  }

  return { nodes: mergedNodes, llm_usage: { ...usageTotals, model: GEMINI_MODEL, chunks: chunks.length, cache_hits: chunkDiagnostics.filter(d => d.cache_hit).length } };
}

// Generate realistic mock data if Gemini API is disabled
function generateLocalTemplateFallback(filename, isPdf) {
  if (isPdf) {
    // MinerU pdf output format
    return {
      "pdf_body": [
        { "type": "title", "text": filename.replace(/\.[^/.]+$/, "").replace(/_/g, " ") },
        { "type": "heading", "text": "1. Theoretical Hypothesis Principles" },
        { "type": "text", "text": "Document segment parsed via MinerU deep OCR networks. This text models topological invariants and localized states within relativistic grids." },
        { "type": "equation", "latex": "\\nabla \\times \\mathbf{B} = \\mu_0 \\left( \\mathbf{J} + \\varepsilon_0 \\frac{\\partial \\mathbf{E}}{\\partial t} \\right)" },
        { "type": "heading", "text": "2. Metric Convergence Trials" },
        { "type": "text", "text": "The metric measurements were evaluated under cryogenic guidelines. Please refer to Table A.1 below for precise state limits." },
        { 
          "type": "table", 
          "table_cells": [
            ["Trial Vector", "Temperature", "Resistance", "Superfluid Stage"],
            ["Vector A", "2.1 Kelvin", "0.041 Ohm", "Active Phase"],
            ["Vector B", "1.4 Kelvin", "0.002 Ohm", "Super-conducting"],
            ["Vector C", "0.8 Kelvin", "0.000 Ohm", "Zero Friction"]
          ], 
          "markdown": "| Trial Vector | Temperature | Resistance | Superfluid Stage |\n|---|---|---|---|\n| Vector A | 2.1 Kelvin | 0.041 Ohm | Active Phase |\n| Vector B | 1.4 Kelvin | 0.002 Ohm | Super-conducting |\n| Vector C | 0.8 Kelvin | 0.000 Ohm | Zero Friction |" 
        }
      ]
    };
  } else {
    // Docling non-pdf structural output format
    return {
      "document": {
        "name": filename,
        "texts": [
          { "label": "heading_1", "text": "Strategic Operational Directive" },
          { "label": "paragraph", "text": "This corporate briefing was parsed with Docling layout engines to classify section blocks, headers, and bullet arrays." },
          { "label": "heading_2", "text": "Core Directives and Checkpoint Vectors" },
          { "label": "list_item", "text": "1. Maintain lower transit costs using approved standard travel class tiers." },
          { "label": "list_item", "text": "2. Log ticket claims inside a 14 day administrative window." },
          { "label": "paragraph", "text": "Review expense approvals in our master operational lookup table:" },
        ],
        "tables": [
          {
            "data": [
              ["Exp Category", "Permitted Daily Cap", "Approvals Required"],
              ["Meals", "$75.00 USD", "Self-certified Receipt"],
              ["Lodging", "$250.00 USD", "Manager Pre-approval"],
              ["Rental Vehicle", "Full Sedan Standard", "Director Override"]
            ],
            "markdown": "| Exp Category | Permitted Daily Cap | Approvals Required |\n|---|---|---\n| Meals | $75.00 USD | Self-certified Receipt |\n| Lodging | $250.00 USD | Manager Pre-approval |\n| Rental Vehicle | Full Sedan Standard | Director Override |"
          }
        ]
      }
    };
  }
}

// Preflight checks: ensure credentials and tools are available before ingestion
function preflightChecks(filename) {
  const required = [];
  if (!process.env.GEMINI_API_KEY) required.push('GEMINI_API_KEY');
  if (!process.env.ARANGO_URL) required.push('ARANGO_URL');
  // If input is not markdown, ensure LiteParse CLI is available
  const ext = path.extname(filename).toLowerCase();
  if (!['.md', '.markdown'].includes(ext)) {
    try {
      execSync('which lit', { stdio: 'ignore' });
    } catch (err) {
      // if lit not found and env not provided for LITEPARSE_CLI_PATH, error
      if (!process.env.LITEPARSE_CLI_PATH) {
        required.push('lit (LiteParse CLI) on PATH or set LITEPARSE_CLI_PATH');
      }
    }
  }

  if (required.length > 0) {
    const msg = `Missing required environment or tools: ${required.join(', ')}`;
    addPipelineLog('error', msg);
    const e = new Error(msg);
    e.code = 'PREFLIGHT_FAILED';
    throw e;
  }
}

// Emulates the transform.js logic to standardized collection mappings
function transformRawToCollections(rawOutputDir) {
  const dbCollections = {
    documents: [],
    sections: [],
    paragraphs: [],
    tables: []
  };

  const documentFolders = fs.readdirSync(rawOutputDir).filter(f => !f.startsWith('.'));

  documentFolders.forEach((docFolder, idx) => {
    const fullPath = path.join(rawOutputDir, docFolder);
    if (!fs.statSync(fullPath).isDirectory()) return;

    const files = fs.readdirSync(fullPath);
    // Custom uuid-like reference keys
    const docId = `doc_trans_${idx}_${Date.now()}`;

    files.forEach(file => {
      if (!file.endsWith('.json')) return;
      const rawContent = JSON.parse(fs.readFileSync(path.join(fullPath, file), 'utf-8'));

      // Support OKF-style nodes produced by the Markdown -> system prompt flow
      const isOkfNodes = !!rawContent.nodes;
      if (isOkfNodes) {
        dbCollections.documents.push({
          id: docId,
          source_file: docFolder,
          parser_engine: "LiteParse",
          title: rawContent.title || docFolder,
          file_size: '1.0 MB'
        });

        // level stack for tracking Chapter→Section→Subsection nesting
        const sectionStack = []; // [{id, level}]
        let currentSectionId = null;

        const SECTION_TYPES = ['Chapter', 'Section', 'Subsection'];
        const LEVEL_OF = { Chapter: 1, Section: 2, Subsection: 3 };

        rawContent.nodes.forEach((node, blockIdx) => {
          const nodeId = `okf_node_${blockIdx}_${Date.now()}`;
          const ntype = node.type || (node.metadata && node.metadata.type) || 'Paragraph';

          if (SECTION_TYPES.includes(ntype)) {
            const level = node.metadata?.level || LEVEL_OF[ntype] || 2;
            // pop stack until we find a shallower ancestor
            while (sectionStack.length > 0 && sectionStack[sectionStack.length - 1].level >= level) {
              sectionStack.pop();
            }
            const parentSectionId = sectionStack.length > 0 ? sectionStack[sectionStack.length - 1].id : null;
            sectionStack.push({ id: nodeId, level });
            currentSectionId = nodeId;
            dbCollections.sections.push({
              id: nodeId,
              document_id: docId,
              parent_section_id: parentSectionId,
              node_type: ntype,
              title: node.title || node.content?.split('\n')[0] || '',
              level,
            });
          } else if (['Paragraph', 'ListItem'].includes(ntype)) {
            dbCollections.paragraphs.push({
              id: nodeId,
              document_id: docId,
              section_id: currentSectionId,
              node_type: ntype,
              content: node.content || node.text || '',
              sumo_tags: node.sumo_tags || [],
              sumo_candidate_tags_raw: node.sumo_candidate_tags_raw || [],
              sumo_resolved_map: node.sumo_resolved_map || {},
            });
          } else if (ntype === 'Figure') {
            dbCollections.paragraphs.push({
              id: nodeId,
              document_id: docId,
              section_id: currentSectionId,
              node_type: 'Figure',
              content: node.content || node.description || node.url || '',
              sumo_tags: node.sumo_tags || [],
              sumo_candidate_tags_raw: node.sumo_candidate_tags_raw || [],
              sumo_resolved_map: node.sumo_resolved_map || {},
            });
          } else if (ntype === 'Table') {
            dbCollections.tables.push({
              id: nodeId,
              document_id: docId,
              section_id: currentSectionId,
              matrix_data: node.metadata?.table_cells || node.table || [],
              markdown_representation: node.markdown || node.metadata?.markdown || '',
            });
          }
        });

        // Done processing this raw JSON file
        return;
      }

      const isMinerU = !!rawContent.pdf_body;

      if (isMinerU) {
        // MinerU Format
        dbCollections.documents.push({
          id: docId,
          source_file: docFolder,
          parser_engine: "MinerU",
          title: rawContent.pdf_body.find(b => b.type === "title")?.text || docFolder,
          file_size: '1.2 MB'
        });

        const minSectionStack = [];
        let currentSectionId = null;

        rawContent.pdf_body.forEach((block, blockIdx) => {
          const nodeId = `min_node_${blockIdx}_${Date.now()}`;
          if (block.type === "title") {
            // title already captured above
          } else if (block.type === "heading") {
            const level = block.level || 1;
            while (minSectionStack.length > 0 && minSectionStack[minSectionStack.length - 1].level >= level) {
              minSectionStack.pop();
            }
            const parentSectionId = minSectionStack.length > 0 ? minSectionStack[minSectionStack.length - 1].id : null;
            minSectionStack.push({ id: nodeId, level });
            currentSectionId = nodeId;
            dbCollections.sections.push({
              id: nodeId,
              document_id: docId,
              parent_section_id: parentSectionId,
              node_type: 'Section',
              title: block.text || "",
              level,
            });
          } else if (block.type === "text" || block.type === "equation") {
            dbCollections.paragraphs.push({
              id: nodeId,
              document_id: docId,
              section_id: currentSectionId,
              node_type: block.type === "equation" ? "Paragraph" : "Paragraph",
              content: block.text || block.latex || "",
            });
          } else if (block.type === "figure") {
            dbCollections.paragraphs.push({
              id: nodeId,
              document_id: docId,
              section_id: currentSectionId,
              node_type: 'Figure',
              content: block.description || block.url || '',
            });
          } else if (block.type === "table") {
            dbCollections.tables.push({
              id: nodeId,
              document_id: docId,
              section_id: currentSectionId,
              matrix_data: block.table_cells || [],
              markdown_representation: block.markdown || "",
            });
          }
        });

      } else {
        // Docling Format
        dbCollections.documents.push({
          id: docId,
          source_file: docFolder,
          parser_engine: "Docling",
          title: rawContent.document?.name || docFolder,
          file_size: '480 KB'
        });

        const docSectionStack = [];
        let currentSectionId = null;

        rawContent.document?.texts?.forEach((item, blockIdx) => {
          const nodeId = `doc_node_${blockIdx}_${Date.now()}`;
          if (item.label === "heading_1" || item.label === "heading_2") {
            const level = item.label === "heading_1" ? 1 : 2;
            while (docSectionStack.length > 0 && docSectionStack[docSectionStack.length - 1].level >= level) {
              docSectionStack.pop();
            }
            const parentSectionId = docSectionStack.length > 0 ? docSectionStack[docSectionStack.length - 1].id : null;
            docSectionStack.push({ id: nodeId, level });
            currentSectionId = nodeId;
            dbCollections.sections.push({
              id: nodeId,
              document_id: docId,
              parent_section_id: parentSectionId,
              node_type: level === 1 ? 'Chapter' : 'Section',
              title: item.text,
              level,
            });
          } else if (item.label === "paragraph" || item.label === "list_item") {
            dbCollections.paragraphs.push({
              id: nodeId,
              document_id: docId,
              section_id: currentSectionId,
              node_type: item.label === "list_item" ? "ListItem" : "Paragraph",
              content: item.text,
            });
          }
        });

        rawContent.document?.tables?.forEach((table, tblIdx) => {
          const nodeId = `doc_table_${tblIdx}_${Date.now()}`;
          dbCollections.tables.push({
            id: nodeId,
            document_id: docId,
            section_id: currentSectionId,
            matrix_data: table.data || [],
            markdown_representation: table.markdown || ""
          });
        });
      }
    });
  });

  return dbCollections;
}

const delay = (ms) => new Promise(res => setTimeout(res, ms));

// Single-document ingestion used by the queue worker (src/worker.js).
// Mirrors the per-file body of runPipelineExecution but reports progress via callback
// and classifies OOM / Gemini rate-limit errors so the worker can decide whether to retry.
export async function ingestSingleFile(filename, aiKey, onProgress = () => {}, options = {}) {
  // Preflight: ensure env credentials & tools
  preflightChecks(filename);

  const inputDir = 'doc_pipeline/input';
  const rawOutputDir = 'doc_pipeline/raw_output';
  const collectionsDir = 'doc_pipeline/collections';
  fs.mkdirSync(inputDir, { recursive: true });
  fs.mkdirSync(rawOutputDir, { recursive: true });
  fs.mkdirSync(collectionsDir, { recursive: true });

  const ext = path.extname(filename).toLowerCase().replace('.', '') || 'txt';
  const filenameNoExt = path.basename(filename, path.extname(filename));
  const isPdf = ext === 'pdf';
  const engineName = isPdf ? 'MinerU' : 'Docling';

  // Hash the input file and skip if already ingested (unless --force)
  const fileContentPath = path.join(inputDir, filename);
  let fileHash = null;
  if (fs.existsSync(fileContentPath)) {
    const buf = fs.readFileSync(fileContentPath);
    fileHash = crypto.createHash('sha256').update(buf).digest('hex');
    if (process.env.ARANGO_URL) {
      const existing = await arangoClient.findDocumentByHash(fileHash);
      if (existing) {
        if (!options.force) {
          const skippedError = new Error(`Document already ingested (hash ${fileHash.slice(0, 12)}…). Use --force to re-ingest.`);
          skippedError.code = 'ALREADY_INGESTED';
          skippedError.existingDoc = existing;
          throw skippedError;
        }
        addPipelineLog('warn', `--force: deleting existing document ${existing._key} before re-ingesting…`);
        await arangoClient.deleteDocumentAndNodes(existing._key);
      }
    }
  }

  onProgress(5, `Routing ${filename} to ${engineName} engine...`);

  const targetSubDir = path.join(rawOutputDir, filename);
  fs.mkdirSync(targetSubDir, { recursive: true });

  const isRealFile = fs.existsSync(fileContentPath);

  let contentExcerpt;
  try {
    contentExcerpt = isRealFile
      ? fs.readFileSync(fileContentPath, 'utf-8').slice(0, 1500)
      : '';
  } catch (err) {
    const oomError = new Error(`OOM_DURING_PARSE: failed to buffer "${filename}" for parsing (${err.message})`);
    oomError.code = 'OOM';
    throw oomError;
  }

  onProgress(20, `Parsing ${ext.toUpperCase()}...`);

  let ai = null;
  if (aiKey) {
    try {
      ai = new GoogleGenAI({
        apiKey: aiKey,
        httpOptions: { headers: { 'User-Agent': 'aistudio-build' } }
      });
    } catch {
      ai = null;
    }
  }

  // Try LiteParse + system prompt structuring first, otherwise fall back to AI/local templates
  let parsedLayoutJSON = await performParsing(ai, filename, fileContentPath, isPdf, targetSubDir);
  // If AI rate-limited error bubbled up, keep semantics for worker retries
  if (!parsedLayoutJSON && ai) {
    const rateLimitError = new Error(`RATE_LIMIT: Gemini API rate limit or parsing failed`);
    rateLimitError.code = 'RATE_LIMIT';
    throw rateLimitError;
  }

  // Extract and carry llm_usage separately; parsedLayoutJSON itself only needs the nodes
  const llmUsage = parsedLayoutJSON?.llm_usage || null;
  if (llmUsage) delete parsedLayoutJSON.llm_usage;

  onProgress(60, 'Writing raw layout output...');
  const rawJsonPath = path.join(targetSubDir, `${filenameNoExt}.json`);
  fs.writeFileSync(rawJsonPath, JSON.stringify(parsedLayoutJSON, null, 2), 'utf-8');

  onProgress(75, 'Transforming into OKF/DoCO collections...');
  const transformedDocs = transformRawToCollections(rawOutputDir);
  const docsForThisFile = transformedDocs.documents.filter(d => d.source_file === filename);

  const arangoDb = getArangoDBSimulator();
  let nodeCount = 0;
  const totalDocs = docsForThisFile.length || 1;

  for (let i = 0; i < docsForThisFile.length; i++) {
    const doc = docsForThisFile[i];
    if (process.env.ARANGO_URL) {
      // persist to real ArangoDB
      try {
        await arangoClient.initArangoClient();
        const inserted = await arangoClient.insertDocument({
          source_file: doc.source_file,
          parser_engine: doc.parser_engine,
          title: doc.title,
          file_size: doc.file_size || '350 KB',
          upload_time: new Date().toISOString(),
          file_hash: fileHash || null,
          llm_usage: llmUsage || null,
        });

        const docHandle = inserted._id || `documents/${inserted._key}`;

        // Insert sections; build internalId → ArangoDB _id map for paragraph/table linking.
        // Uses parent_section_id to wire Chapter→Section→Subsection hierarchy correctly,
        // and only creates NEXT_SIBLING edges between sections sharing the same parent.
        const sectionIdMap = new Map(); // internal transform id → ArangoDB _id
        const docsSections = transformedDocs.sections.filter(s => s.document_id === doc.id);
        // lastHandleByParent tracks the last inserted section handle per parent (for NEXT_SIBLING)
        const lastHandleByParent = new Map(); // parentInternalId|'root' → last ArangoDB _id

        for (const sec of docsSections) {
          const secRes = await arangoClient.insertSection({
            document_id: inserted._key,
            title: sec.title,
            level: sec.level,
            node_type: sec.node_type || 'Section',
            parent_section_id: sec.parent_section_id || null,
          });
          nodeCount += 1;
          const secHandle = secRes._id || `sections/${secRes._key}`;
          sectionIdMap.set(sec.id, secHandle);

          // Parent edge: either doc→section (top-level) or parentSection→section (nested)
          const parentHandle = sec.parent_section_id ? sectionIdMap.get(sec.parent_section_id) : null;
          const fromHandle = parentHandle || docHandle;
          await arangoClient.insertEdge({ _from: fromHandle, _to: secHandle, relation: 'HAS_CHILD', type: 'HAS_CHILD' }).catch(()=>{});

          // NEXT_SIBLING only between sections with the same parent
          const siblingKey = sec.parent_section_id || 'root';
          const lastSiblingHandle = lastHandleByParent.get(siblingKey);
          if (lastSiblingHandle) {
            await arangoClient.insertEdge({ _from: lastSiblingHandle, _to: secHandle, relation: 'NEXT_SIBLING', type: 'NEXT_SIBLING' }).catch(()=>{});
          }
          lastHandleByParent.set(siblingKey, secHandle);
        }

        // Insert paragraphs — link to their section (HAS_CHILD) and document (BELONGS_TO)
        const docsParagraphs = transformedDocs.paragraphs.filter(p => p.document_id === doc.id);
        for (const p of docsParagraphs) {
          const secHandle = p.section_id ? sectionIdMap.get(p.section_id) : null;
          const paraRes = await arangoClient.insertParagraph({
            document_id: inserted._key,
            section_id: secHandle || null,
            node_type: p.node_type || 'Paragraph',
            content: p.content,
            is_latex: p.content.includes('\\') || p.content.includes('^') || p.content.includes('_'),
            sumo_tags: p.sumo_tags || [],
            sumo_candidate_tags_raw: p.sumo_candidate_tags_raw || [],
            sumo_resolved_map: p.sumo_resolved_map || {},
          });
          nodeCount += 1;
          const paraHandle = paraRes._id || `paragraphs/${paraRes._key}`;
          await arangoClient.insertEdge({ _from: paraHandle, _to: docHandle, relation: 'BELONGS_TO', type: 'BELONGS_TO' }).catch(()=>{});
          if (secHandle) {
            await arangoClient.insertEdge({ _from: secHandle, _to: paraHandle, relation: 'HAS_CHILD', type: 'HAS_CHILD' }).catch(()=>{});
          }
        }

        // Insert tables — same linking pattern as paragraphs
        const docsTables = transformedDocs.tables.filter(t => t.document_id === doc.id);
        for (const t of docsTables) {
          const secHandle = t.section_id ? sectionIdMap.get(t.section_id) : null;
          const tblRes = await arangoClient.insertTable({
            document_id: inserted._key,
            section_id: secHandle || null,
            node_type: 'Table',
            matrix_data: t.matrix_data || [],
            markdown_representation: t.markdown_representation || '',
          });
          nodeCount += 1;
          const tblHandle = tblRes._id || `tables/${tblRes._key}`;
          await arangoClient.insertEdge({ _from: tblHandle, _to: docHandle, relation: 'BELONGS_TO', type: 'BELONGS_TO' }).catch(()=>{});
          if (secHandle) {
            await arangoClient.insertEdge({ _from: secHandle, _to: tblHandle, relation: 'HAS_CHILD', type: 'HAS_CHILD' }).catch(()=>{});
          }
        }

      } catch (err) {
        addPipelineLog('error', `ArangoDB persistence failed for ${doc.source_file}: ${err.message}`);
        throw err;
      }
    } else {
      const insertedDoc = arangoDb.insertDocument({ _key: doc.id, source_file: doc.source_file, parser_engine: doc.parser_engine, title: doc.title, file_size: doc.file_size || '350 KB', upload_time: new Date().toISOString() });

      const docsSections = transformedDocs.sections.filter(s => s.document_id === doc.id);
      docsSections.forEach(sec => { arangoDb.insertSection({ _key: sec.id, document_id: insertedDoc._key, title: sec.title, level: sec.level }); nodeCount += 1; });

      const docsParagraphs = transformedDocs.paragraphs.filter(p => p.document_id === doc.id);
      docsParagraphs.forEach(p => { arangoDb.insertParagraph({ _key: p.id, document_id: insertedDoc._key, section_id: p.section_id ? `sections/${p.section_id}` : null, content: p.content, is_latex: p.content.includes('\\') || p.content.includes('^') || p.content.includes('_') }); nodeCount += 1; });

      const docsTables = transformedDocs.tables.filter(t => t.document_id === doc.id);
      docsTables.forEach(t => { arangoDb.insertTable({ _key: t.id, document_id: insertedDoc._key, section_id: t.section_id ? `sections/${t.section_id}` : null, matrix_data: t.matrix_data || [], markdown_representation: t.markdown_representation || '' }); nodeCount += 1; });
    }

    onProgress(75 + Math.round(((i + 1) / totalDocs) * 20), `Extracting Nodes ${nodeCount}...`);
  }

  onProgress(100, `Completed ingestion of ${filename} (${nodeCount} nodes).`);

  return {
    filename,
    documents: docsForThisFile.length,
    nodes: nodeCount,
    llm_usage: llmUsage || null,
  };
}
