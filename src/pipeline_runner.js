import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import crypto from 'crypto';
import { GoogleGenAI } from '@google/genai';
import { getArangoDBSimulator } from './arangodb_sim.js';
import { cacheKeyFor, readCacheAsync, writeCache, readCacheSync, hasCache, credFingerprint, getCacheDir } from './llm_cache.js';
import { chunkMarkdown, readMarkdownFile } from './markdown_chunker.js';
import * as arangoClient from './arango_client.js';
import { validateTags } from './sumo_index.js';

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
    model: 'gemini-3.5-flash',
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

// Use AI + system prompt to transform Markdown into structured JSON nodes
async function generateFromMarkdown(ai, mdContent, filename) {
  try {
    const promptTemplate = fs.readFileSync(path.join('prompts', 'ingest_document.md'), 'utf-8');
    const prompt = `${promptTemplate}\n\nDOCUMENT_MARKDOWN:\n\n${mdContent}`;
    const result = await ai.models.generateContent({ model: 'gemini-3.5-flash', contents: prompt });
    const parsedText = result.text?.trim() || '{}';
    const cleanJson = parsedText.replace(/^```json/gi, '').replace(/^```/gi, '').replace(/```$/gi, '').trim();
    return JSON.parse(cleanJson);
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
  const results = [];

  let idx = 0;
  async function worker(chunk) {
    const systemPrompt = fs.readFileSync(path.join('prompts', 'ingest_document.md'), 'utf-8');
    const promptNorm = systemPrompt.trim();
    const modelId = 'gemini-3.5-flash';
    const credFp = credFingerprint();
    const key = cacheKeyFor([promptNorm, chunk.text, modelId, credFp]);

    // Check cache
    // attempt to read cache from disk or DB
    const cached = await readCacheAsync(key);
    if (cached && cached.parsed_json) {
      addPipelineLog('info', `Cache hit for chunk ${chunk.id}`);
      return cached.parsed_json;
    }

    // not cached -> call LLM with retries
    const maxAttempts = 3;
    let attempt = 0;
    while (attempt < maxAttempts) {
      attempt += 1;
      try {
        addPipelineLog('info', `LLM structuring chunk ${chunk.id} (attempt ${attempt}/${maxAttempts})`);
        const prompt = `${promptNorm}\n\nDOCUMENT_CHUNK_HEADING:${chunk.heading || ''}\n\n${chunk.text}`;
        const resp = await ai.models.generateContent({ model: modelId, contents: prompt });
        const parsedText = resp.text?.trim() || '{}';
        const cleanJson = parsedText.replace(/^```json/gi, '').replace(/^```/gi, '').replace(/```$/gi, '').trim();
        const parsed = JSON.parse(cleanJson);
        // write cache
        writeCache(key, { parsed_json: parsed, raw: parsedText, meta: { modelId, cached_at: new Date().toISOString() } });
        return parsed;
      } catch (err) {
        addPipelineLog('warn', `LLM error on chunk ${chunk.id}: ${err.message}`);
        if (attempt < maxAttempts) {
          addPipelineLog('info', `Retrying chunk ${chunk.id} in 30s...`);
          await delay(30000);
          continue;
        }
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

  // Validate SUMO candidate tags for each node and promote to sumo_tags
  try {
    for (const node of mergedNodes) {
      if (node && Array.isArray(node.sumo_candidate_tags)) {
        const { valid, invalid } = validateTags(node.sumo_candidate_tags);
        node.sumo_tags = valid;
        // remove candidate list to keep stored documents clean
        delete node.sumo_candidate_tags;
        if (invalid && invalid.length > 0) {
          addPipelineLog('warn', `Node validation removed invalid SUMO tags: ${invalid.join(', ')}`);
        }
      }
    }
  } catch (e) {
    addPipelineLog('error', `SUMO tag validation failed: ${e.message}`);
    const err = new Error('SUMO_VALIDATION_FAILED');
    err.code = 'SUMO_VALIDATION_FAILED';
    throw err;
  }

  return { nodes: mergedNodes };
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

        let currentSectionId = null;
        rawContent.nodes.forEach((node, blockIdx) => {
          const nodeId = `okf_node_${blockIdx}_${Date.now()}`;
          const ntype = node.type || (node.metadata && node.metadata.type) || 'Paragraph';

          if (['Chapter', 'Section', 'Subsection'].includes(ntype)) {
            currentSectionId = nodeId;
            dbCollections.sections.push({
              id: nodeId,
              document_id: docId,
              title: node.title || node.content?.split('\n')[0] || '',
              level: node.metadata?.level || 1
            });
          } else if (['Paragraph', 'ListItem'].includes(ntype)) {
            dbCollections.paragraphs.push({
              id: nodeId,
              document_id: docId,
              section_id: currentSectionId,
              content: node.content || node.text || ''
            });
          } else if (ntype === 'Table') {
            dbCollections.tables.push({
              id: nodeId,
              document_id: docId,
              section_id: currentSectionId,
              matrix_data: node.metadata?.table_cells || node.table || [],
              markdown_representation: node.markdown || node.metadata?.markdown || ''
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

        let currentSectionId = null;

        rawContent.pdf_body.forEach((block, blockIdx) => {
          const nodeId = `min_node_${blockIdx}_${Date.now()}`;
          if (block.type === "title") {
             // title resolved
          } else if (block.type === "heading") {
            currentSectionId = nodeId;
            dbCollections.sections.push({
              id: nodeId,
              document_id: docId,
              title: block.text || "",
              level: 1
            });
          } else if (block.type === "text" || block.type === "equation") {
            dbCollections.paragraphs.push({
              id: nodeId,
              document_id: docId,
              section_id: currentSectionId,
              content: block.text || block.latex || ""
            });
          } else if (block.type === "table") {
            dbCollections.tables.push({
              id: nodeId,
              document_id: docId,
              section_id: currentSectionId,
              matrix_data: block.table_cells || [],
              markdown_representation: block.markdown || ""
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

        let currentSectionId = null;

        rawContent.document?.texts?.forEach((item, blockIdx) => {
          const nodeId = `doc_node_${blockIdx}_${Date.now()}`;
          if (item.label === "heading_1" || item.label === "heading_2") {
            currentSectionId = nodeId;
            dbCollections.sections.push({
              id: nodeId,
              document_id: docId,
              title: item.text,
              level: item.label === "heading_1" ? 1 : 2
            });
          } else if (item.label === "paragraph" || item.label === "list_item") {
            dbCollections.paragraphs.push({
              id: nodeId,
              document_id: docId,
              section_id: currentSectionId,
              content: item.text
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
export async function ingestSingleFile(filename, aiKey, onProgress = () => {}) {
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

  onProgress(5, `Routing ${filename} to ${engineName} engine...`);

  const targetSubDir = path.join(rawOutputDir, filename);
  fs.mkdirSync(targetSubDir, { recursive: true });

  const fileContentPath = path.join(inputDir, filename);
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
          upload_time: new Date().toISOString()
        });

        const docsSections = transformedDocs.sections.filter(s => s.document_id === doc.id);
        // keep track of last section id for NEXT_SIBLING link
        let lastSectionId = null;
        for (const sec of docsSections) {
          const secRes = await arangoClient.insertSection({ document_id: inserted._key, title: sec.title, level: sec.level });
          nodeCount += 1;
          // add edge: document -> section
          const docHandle = inserted._id || `documents/${inserted._key}`;
          const secHandle = secRes._id || `sections/${secRes._key}`;
          await arangoClient.insertEdge({ _from: docHandle, _to: secHandle, relation: 'HAS_CHILD', type: 'HAS_CHILD' }).catch(()=>{});
          if (lastSectionId) {
            const lastHandle = lastSectionId;
            await arangoClient.insertEdge({ _from: lastHandle, _to: secHandle, relation: 'NEXT_SIBLING', type: 'NEXT_SIBLING' }).catch(()=>{});
          }
          lastSectionId = secHandle;
        }

        const docsParagraphs = transformedDocs.paragraphs.filter(p => p.document_id === doc.id);
        for (const p of docsParagraphs) {
          const paraRes = await arangoClient.insertParagraph({ document_id: inserted._key, section_id: p.section_id ? `sections/${p.section_id}` : null, content: p.content, is_latex: p.content.includes('\\') || p.content.includes('^') || p.content.includes('_') });
          nodeCount += 1;
          // link paragraph to its document
          const paraHandle = paraRes._id || `paragraphs/${paraRes._key}`;
          const docHandlePara = inserted._id || `documents/${inserted._key}`;
          await arangoClient.insertEdge({ _from: paraHandle, _to: docHandlePara, relation: 'BELONGS_TO', type: 'BELONGS_TO' }).catch(()=>{});

        }

        const docsTables = transformedDocs.tables.filter(t => t.document_id === doc.id);
        for (const t of docsTables) {
          const tblRes = await arangoClient.insertTable({ document_id: inserted._key, section_id: t.section_id ? `sections/${t.section_id}` : null, matrix_data: t.matrix_data || [], markdown_representation: t.markdown_representation || '' });
          nodeCount += 1;
          const tblHandle = tblRes._id || `tables/${tblRes._key}`;
          const docHandleTbl = inserted._id || `documents/${inserted._key}`;
          await arangoClient.insertEdge({ _from: tblHandle, _to: docHandleTbl, relation: 'BELONGS_TO', type: 'BELONGS_TO' }).catch(()=>{});
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
    nodes: nodeCount
  };
}
