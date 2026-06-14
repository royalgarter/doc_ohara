import fs from 'fs';
import path from 'path';
import { GoogleGenAI } from '@google/genai';
import { getArangoDBSimulator } from './arangodb_sim.js';

export interface PipelineLog {
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'success';
  message: string;
}

// Global log tracking for the active pipeline run
let currentLogs: PipelineLog[] = [];
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

export function addPipelineLog(level: 'info' | 'warn' | 'error' | 'success', message: string) {
  const log: PipelineLog = {
    timestamp: new Date().toISOString(),
    level,
    message
  };
  currentLogs.push(log);
  console.log(`[Pipeline] ${level.toUpperCase()}: ${message}`);
}

// Trigger standard pipeline simulation or AI-driven extraction
export async function runPipelineExecution(aiKey?: string) {
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
    let ai: GoogleGenAI | null = null;
    if (aiKey) {
      try {
        ai = new GoogleGenAI({
          apiKey: aiKey,
          httpOptions: { headers: { 'User-Agent': 'aistudio-build' } }
        });
        addPipelineLog('info', '🤖 Secure server-side Gemini layout model initialized.');
      } catch (err: any) {
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

      let parsedLayoutJSON: any = null;

      // Real or mocked parser content
      const fileContentPath = path.join(inputDir, filename);
      const isRealFile = fs.existsSync(fileContentPath);
      const contentExcerpt = isRealFile 
        ? fs.readFileSync(fileContentPath, 'utf-8').slice(0, 1500)
        : "Standard document content for layout extraction.";

      if (ai) {
        // AI processing
        try {
          addPipelineLog('info', `Extracting structured elements using Gemini-3.5-Flash...`);
          parsedLayoutJSON = await generateAILayout(ai, filename, contentExcerpt, isPdf);
          addPipelineLog('success', `AI Extraction successful for ${filename}!`);
        } catch (err: any) {
          addPipelineLog('warn', `AI extraction returned an error: ${err.message}. Using high-fidelity local templates.`);
          parsedLayoutJSON = generateLocalTemplateFallback(filename, isPdf);
        }
      } else {
        // Fallback simulation
        await delay(1200); // realistic processing overhead
        parsedLayoutJSON = generateLocalTemplateFallback(filename, isPdf);
      }

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

    // Write collections JSON onto disk matching Step 3 specs
    fs.writeFileSync(path.join(collectionsDir, 'documents.json'), JSON.stringify(transformedDocs.documents, null, 2), 'utf-8');
    fs.writeFileSync(path.join(collectionsDir, 'sections.json'), JSON.stringify(transformedDocs.sections, null, 2), 'utf-8');
    fs.writeFileSync(path.join(collectionsDir, 'paragraphs.json'), JSON.stringify(transformedDocs.paragraphs, null, 2), 'utf-8');
    fs.writeFileSync(path.join(collectionsDir, 'tables.json'), JSON.stringify(transformedDocs.tables, null, 2), 'utf-8');

    // Load nodes & edges into ArangoDB Simulation
    addPipelineLog('info', '🗄️ Syncing collections into ArangoDB multi-model storage...');
    await delay(800);

    // clear or retain existing data? Let's retain and insert new matching records
    transformedDocs.documents.forEach(doc => {
      // Check if document exists, if so delete original references to prevent duplicates
      const state = arangoDb.getState();
      
      // Soft-insert documents
      const insertedDoc = arangoDb.insertDocument({
        _key: doc.id,
        source_file: doc.source_file,
        parser_engine: doc.parser_engine as any,
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
    });

    addPipelineLog('success', `📦 Syncing complete! Standardized databases contains ${transformedDocs.documents.length} document roots, ${transformedDocs.sections.length} layout sections, ${transformedDocs.paragraphs.length} paragraphs/equations, and ${transformedDocs.tables.length} table matrices. All linked via edge records.`);
    addPipelineLog('success', '✅ Pipeline successfully completed!');

  } catch (err: any) {
    addPipelineLog('error', `Pipeline execution crashed: ${err.message}`);
  } finally {
    isPipelineRunning = false;
  }
}

// Call Gemini API to extract raw layout
async function generateAILayout(ai: GoogleGenAI, filename: string, content: string, isPdf: boolean): Promise<any> {
  const isImage = /\.(png|jpe?g|webp|gif|bmp)$/i.test(filename);
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

// Generate realistic mock data if Gemini API is disabled
function generateLocalTemplateFallback(filename: string, isPdf: boolean): any {
  if (isPdf) {
    // MinerU pdf output format
    return {
      "pdf_body": [
        { "type": "title", "text": filename.replace(/\.[^/.]+$/, "").replace(/_/g, " ") },
        { "type": "heading", "text": "1. Theoretical Hypothesis Principles" },
        { "type": "text", "text": "Document segment parsed via MinerU deep OCR networks. This text models topological invariants and localized states within relativistic grids." },
        { "type": "equation", "latex": "\\nabla \\times \\mathbf{B} = \\mu_0 \\left( \mathbf{J} + \\varepsilon_0 \\frac{\\partial \\mathbf{E}}{\\partial t} \\right)" },
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
            "markdown": "| Exp Category | Permitted Daily Cap | Approvals Required |\n|---|---|---|\n| Meals | $75.00 USD | Self-certified Receipt |\n| Lodging | $250.00 USD | Manager Pre-approval |\n| Rental Vehicle | Full Sedan Standard | Director Override |"
          }
        ]
      }
    };
  }
}

// Emulates the transform.js logic to standardized collection mappings
function transformRawToCollections(rawOutputDir: string) {
  const dbCollections: {
    documents: any[];
    sections: any[];
    paragraphs: any[];
    tables: any[];
  } = {
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

      const isMinerU = !!rawContent.pdf_body;

      if (isMinerU) {
        // MinerU Format
        dbCollections.documents.push({
          id: docId,
          source_file: docFolder,
          parser_engine: "MinerU",
          title: rawContent.pdf_body.find((b: any) => b.type === "title")?.text || docFolder,
          file_size: '1.2 MB'
        });

        let currentSectionId: string | null = null;

        rawContent.pdf_body.forEach((block: any, blockIdx: number) => {
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

        let currentSectionId: string | null = null;

        rawContent.document?.texts?.forEach((item: any, blockIdx: number) => {
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

        rawContent.document?.tables?.forEach((table: any, tblIdx: number) => {
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

const delay = (ms: number) => new Promise(res => setTimeout(res, ms));
