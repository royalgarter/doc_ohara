import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import crypto from 'node:crypto';
import { GoogleGenAI } from '@google/genai';
import { getArangoDBSimulator } from '../db/simulator.js';
import { cacheKeyFor, readCacheAsync, writeCache, readCacheSync, writeCacheSync, hasCache, credFingerprint, getCacheDir } from '../cache.js';
import { chunkMarkdown, readMarkdownFile } from './chunker.js';
import * as arangoClient from '../db/client.js';
import { updateEdge as updateArangoEdge } from '../db/client.js';
import { validateTags } from '../sumo.js';
import { processNodeEntities, normalizeEntity } from '../entities.js';
import { runEntityDedup } from './entity_dedup.js';
import { PseudoTOCGenerator, GeminiTocLLMClient, GeminiEmbeddingClient } from '../toc.js';
import { extractHtmlTitle, htmlToMarkdown } from '../helper.js';
import { callLLM, createGeminiCache, callLLMWithCache, onTokenUsage, clearTokenUsageHandler } from '../llm.js';

const GEMINI_MODEL = process.env.LLM_MODEL || 'gemini-2.5-flash-lite';

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
							is_latex: typeof p.content === 'string' && (p.content.includes('\\') || p.content.includes('^') || p.content.includes('_')),
							llm_pending: p.llm_pending || false,
							llm_error: p.llm_error || null,
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
						is_latex: typeof p.content === 'string' && (p.content.includes('\\') || p.content.includes('^') || p.content.includes('_')),
						llm_pending: p.llm_pending || false,
						llm_error: p.llm_error || null,
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

	const parsedText = (await callLLM(prompt, { model: GEMINI_MODEL, cache: false, serviceTier: 'flex' })) || '{}';
	const cleanJson = parsedText.replace(/^```json/gi, '').replace(/^```/gi, '').replace(/```$/gi, '').trim();
	return JSON.parse(cleanJson);
}

// Attempt to run LiteParse CLI to convert source to Markdown
function attemptLiteParse(sourcePath, outMdPath) {
	try {
		// sample command: npx -y @llamaindex/liteparse parse sample/Mastering\ Bitcoin\ 2nd.pdf --format markdown -o mastering_bitcoin_2nd.md
		const cmd = `npx -y @llamaindex/liteparse parse '${sourcePath}' --format markdown -o '${outMdPath}'`;
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
		const parsedText = (await callLLM(prompt, { model: GEMINI_MODEL, cache: false, serviceTier: 'flex' })) || '{}';
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
		const mdContent = fs.readFileSync(fileContentPath, 'utf-8');
		return await structureMarkdownWithRetries(ai, filename, mdContent);
	}

	// Reuse existing LiteParse output (.md) if the input file was deleted or parsing already done
	if (fs.existsSync(mdOutPath)) {
		addPipelineLog('info', `Reusing cached LiteParse output: ${mdOutPath}`);
		const mdContent = fs.readFileSync(mdOutPath, 'utf-8');
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

// Detect and extract TOC and Glossary sections from raw Markdown before chunking.
// Returns { cleanedMarkdown, toc, glossary } where toc and glossary have { raw, entries }.
// The cleaned markdown has those blocks removed so the LLM never sees them as regular chunks.
function preDetectSpecialSections(markdown) {
	const lines = markdown.split(/\r?\n/);
	const tocEntries = [];
	const glossaryEntries = [];
	let tocRaw = null;
	let glossaryRaw = null;

	// TOC line patterns: markdown links, dotted leaders, or numbered heading lines
	const TOC_LINE_RE = /^[-*]\s+\[.+\]\(#.+\)|^\s*(chapter|section|part|appendix)?\s*\d+[\d.]*\s+.{3,}[.\s]{4,}\d+\s*$|^\s*\d+[\d.]*\s+.{3,}[.\s]{4,}\d+\s*$/i;

	// Glossary heading pattern
	const GLOSSARY_HEADING_RE = /^#{1,4}\s+(glossary|terms\s*(&amp;|&|and)?\s*definitions?|abbreviations|key\s+terms)/i;

	let i = 0;
	const keepLines = [];

	while (i < lines.length) {
		// --- Detect TOC block ---
		// Look for a heading that signals a TOC, or a run of TOC-matching lines
		const IS_TOC_HEADING = /^#{1,4}\s+(table\s+of\s+contents?|contents?|toc)\b/i;
		if (IS_TOC_HEADING.test(lines[i])) {
			const blockStart = i;
			const blockLines = [lines[i]];
			i++;
			// consume subsequent lines until a non-TOC heading or double blank gap
			let blanks = 0;
			while (i < lines.length) {
				const l = lines[i];
				if (/^#{1,4}\s+/.test(l) && !IS_TOC_HEADING.test(l)) break; // new section
				if (l.trim() === '') { blanks++; if (blanks > 2) break; }
				else blanks = 0;
				blockLines.push(l);
				i++;
			}
			tocRaw = blockLines.join('\n');

			// Parse TOC entries from block lines.
			// Handles several LiteParse-output formats:
			//   1. Markdown links:  [Title](#anchor)  — page inline or omitted
			//   2. Numbered bold:   1. **Title. . . .**  — pages appear later as **N** bulk lines
			//   3. Dotted leaders:  Title . . . . . . 42  — page inline
			//
			// Strategy: two passes.
			//   Pass 1 — collect chapter-level entries (formats 1 & 2) in order, no pages yet.
			//   Pass 2 — extract all numeric page values from bold/plain page lines in order,
			//            then zip them onto entries that still lack a page.
			const chapterEntries = [];
			const pageCandidates = []; // integers in document order

			for (const l of blockLines) {
				// Format 1: markdown link with optional inline page
				const linkMatch = l.match(/\[(.+?)\]\(#.+?\)/);
				if (linkMatch) { chapterEntries.push({ title: linkMatch[1].trim(), level: 1, page: null }); continue; }

				// Format 2: numbered bold  "N. **Title . . .**"
				const numberedBold = l.match(/^(\d+)\.\s+\*{1,2}([^*]+?)[.*\s]+\*{0,2}\s*$/);
				if (numberedBold) { chapterEntries.push({ title: numberedBold[2].trim().replace(/\.+$/, '').trim(), level: 1, page: null }); continue; }

				// Format 3: dotted leader with inline page — treat as sub-entry, keep page
				const dottedPage = l.match(/^(.+?)\s*[.\s]{4,}\s*(\d+)\s*$/);
				if (dottedPage) {
					const title = dottedPage[1].replace(/\*+/g, '').trim();
					const page = parseInt(dottedPage[2], 10);
					if (title.length > 1) tocEntries.push({ title, level: 2, page });
					pageCandidates.push(page);
					continue;
				}

				// Bold page line: "**N**" or "**ix N**" (roman prefix + arabic) — extract rightmost integer.
				// These are chapter-start pages; plain-number lines are sub-section pages — ignore for chapter zipping.
				const boldPageLine = l.match(/^\*{1,2}[^*]*?(\d+)\s*\*{0,2}\s*$/);
				if (boldPageLine) { pageCandidates.push(parseInt(boldPageLine[1], 10)); continue; }
			}

			// Zip collected page numbers onto chapter entries in order
			let pageIdx = 0;
			for (const entry of chapterEntries) {
				while (pageIdx < pageCandidates.length && pageCandidates[pageIdx] < 1) pageIdx++;
				if (pageIdx < pageCandidates.length) {
					entry.page = pageCandidates[pageIdx++];
				}
				tocEntries.push(entry);
			}

			addPipelineLog('info', `Pre-detected TOC block (${blockLines.length} lines, ${tocEntries.length} entries) — excluded from LLM chunking`);
			continue; // don't push these lines to keepLines
		}

		// Also detect a run of ≥5 TOC-style lines without an explicit heading
		if (!tocRaw && TOC_LINE_RE.test(lines[i])) {
			let runStart = i;
			const run = [];
			while (i < lines.length && (TOC_LINE_RE.test(lines[i]) || lines[i].trim() === '')) {
				run.push(lines[i]);
				i++;
			}
			if (run.filter(l => TOC_LINE_RE.test(l)).length >= 5) {
				tocRaw = run.join('\n');
				run.filter(l => TOC_LINE_RE.test(l)).forEach(l => {
					const linkM = l.match(/\[(.+?)\]/);
					const numM  = l.match(/^\s*\d[\d.]*\s+(.+?)\s*[.\s]{4,}\s*(\d+)\s*$/);
					if (linkM) tocEntries.push({ title: linkM[1].trim(), level: 1, page: null });
					else if (numM) tocEntries.push({ title: numM[1].trim(), level: 1, page: parseInt(numM[2], 10) });
				});
				addPipelineLog('info', `Pre-detected TOC block (heuristic, ${run.length} lines, ${tocEntries.length} entries) — excluded from LLM chunking`);
				continue;
			} else {
				// Not a TOC run — keep lines
				run.forEach(l => keepLines.push(l));
				continue;
			}
		}

		// --- Detect Glossary block ---
		if (GLOSSARY_HEADING_RE.test(lines[i])) {
			const blockLines = [lines[i]];
			i++;
			// consume until next same-or-shallower heading
			const headLevel = (lines[i - 1].match(/^(#{1,4})/) || ['', ''])[1].length;
			while (i < lines.length) {
				const nextHeadMatch = lines[i].match(/^(#{1,4})\s+/);
				if (nextHeadMatch && nextHeadMatch[1].length <= headLevel) break;
				blockLines.push(lines[i]);

				// Parse definition list: `**term** — definition` or `term: definition` or `| term | def |`
				const defListMatch = lines[i].match(/^\*{1,2}(.+?)\*{1,2}\s*[—:\-]\s*(.+)/);
				const colonMatch = !defListMatch && lines[i].match(/^([^|:]{2,40})\s*:\s{1,4}(.{5,})/);
				const tableMatch = !defListMatch && !colonMatch && lines[i].match(/^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|/);
				if (defListMatch) glossaryEntries.push({ term: defListMatch[1].trim(), definition: defListMatch[2].trim() });
				else if (colonMatch) glossaryEntries.push({ term: colonMatch[1].trim(), definition: colonMatch[2].trim() });
				else if (tableMatch && !/^[\s|:-]+$/.test(lines[i])) glossaryEntries.push({ term: tableMatch[1].trim(), definition: tableMatch[2].trim() });
				i++;
			}
			glossaryRaw = blockLines.join('\n');
			addPipelineLog('info', `Pre-detected Glossary block (${blockLines.length} lines, ${glossaryEntries.length} entries) — will be stored as structured entries`);
			continue;
		}

		keepLines.push(lines[i]);
		i++;
	}

	return {
		cleanedMarkdown: keepLines.join('\n'),
		toc: tocRaw ? { raw: tocRaw, entries: tocEntries } : null,
		glossary: glossaryRaw ? { raw: glossaryRaw, entries: glossaryEntries } : null,
	};
}

// Use LLM to detect a TOC from the first N chunks of the document.
// Returns { source: "explicit"|"implicit", raw: string|null, entries: [] } or null on failure.
async function detectTocWithLLM(ai, firstChunks) {
	if (!ai || !firstChunks.length) return null;
	try {
		const extractTocPrompt = fs.readFileSync(path.join('prompts', 'extract_toc.md'), 'utf-8').trim();
		const combinedText = firstChunks.map(c => c.text).join('\n\n');
		const prompt = `${extractTocPrompt}\n\nDOCUMENT_CHUNK:\n${combinedText}`;
		const credFp = credFingerprint();
		const key = cacheKeyFor([extractTocPrompt, combinedText, GEMINI_MODEL, credFp]);

		let parsed = readCacheSync(key);
		if (!parsed) {
			const raw = ((await callLLM(prompt, { model: GEMINI_MODEL, cache: false, serviceTier: 'flex' })) ?? '').trim().replace(/^```json/i, '').replace(/^```/, '').replace(/```$/, '').trim();
			try { parsed = JSON.parse(raw); } catch { return null; }
			writeCache(key, parsed);
		}

		const tocSource = parsed.toc_source === 'explicit' ? 'explicit' : 'implicit_llm';
		const entries = (parsed.toc || []).map(e => ({ title: e.title, level: e.level ?? 1, page: e.page ?? null }));
		addPipelineLog('info', `LLM TOC detection: toc_source=${tocSource}, ${entries.length} entry/entries`);
		return { source: tocSource, raw: combinedText.slice(0, 2000), entries };
	} catch (err) {
		addPipelineLog('warn', `LLM TOC detection failed: ${err.message}`);
		return null;
	}
}

// Use LLM to generate a semantic relationship description between two similar documents.
// Returns { verb, tags, summary } or null on failure.
// Result is cached by content hash so re-ingesting is free.
async function enrichCrossDocEdge(ai, docA, docB, snippetsA, snippetsB, sharedEntities) {
	if (!ai) return null;
	try {
		const enrichPrompt = fs.readFileSync(path.join('prompts', 'enrich_cross_doc_edge.md'), 'utf-8').trim();
		const credFp = credFingerprint();

		const inputPayload = JSON.stringify({
			docA: { title: docA.title || docA.id, sumo_tags: (docA.sumo_tags || []).slice(0, 8), snippets: snippetsA },
			docB: { title: docB.title || docB.id, sumo_tags: (docB.sumo_tags || []).slice(0, 8), snippets: snippetsB },
			shared_entities: sharedEntities.slice(0, 10),
		});

		const key = cacheKeyFor([enrichPrompt, inputPayload, GEMINI_MODEL, credFp]);
		let parsed = readCacheSync(key);

		if (!parsed) {
			const prompt = `${enrichPrompt}\n\nINPUT:\n${inputPayload}`;
			const raw = ((await callLLM(prompt, { model: GEMINI_MODEL, cache: false, serviceTier: 'flex' })) ?? '').trim().replace(/^```json\s*/i, '').replace(/^```/, '').replace(/```$/, '').trim();
			try { parsed = JSON.parse(raw); } catch { return null; }
			writeCache(key, parsed);
		}

		if (!parsed?.verb) return null;
		return {
			verb: String(parsed.verb).slice(0, 100),
			tags: Array.isArray(parsed.tags) ? parsed.tags.slice(0, 4).map(String) : [],
			summary: typeof parsed.summary === 'string' ? parsed.summary.slice(0, 300) : '',
		};
	} catch (err) {
		addPipelineLog('warn', `Cross-doc edge enrichment failed: ${err.message}`);
		return null;
	}
}

// Generate contextual prefix for a paragraph (Anthropic Contextual Retrieval pattern).
// Format: "[Document: {title}] [Section: {section_title}] This paragraph discusses {role}."
// Improves BM25 vocabulary coverage and embedding quality.
// Controlled by OHARA_CONTEXTUAL_PREFIX=true (opt-in; adds ~1 Gemini call per 8 paras via batching).
async function generateContextualPrefixes(ai, paragraphs, docTitle, sectionTitles) {
	if (!ai || !paragraphs.length) return new Map();
	const result = new Map(); // para.id → prefix string

	// Batch paragraphs to reduce Gemini calls (8 per call)
	const BATCH = 8;
	for (let i = 0; i < paragraphs.length; i += BATCH) {
		const batch = paragraphs.slice(i, i + BATCH);
		const items = batch.map(p => ({
			id: p.id,
			section: sectionTitles.get(p.section_id) || '',
			content: (p.content || '').slice(0, 600),
		}));

		const key = cacheKeyFor(['contextual_prefix_v1', GEMINI_MODEL, docTitle, JSON.stringify(items)]);
		const cached = readCacheSync(key);
		if (cached?.prefixes) {
			for (const { id, prefix } of cached.prefixes) result.set(id, prefix);
			continue;
		}

		const prompt = `Document title: "${docTitle}"

For each passage below, write ONE sentence (≤20 words) describing what specific aspect of the document topic this passage covers.
Format: "[Document: ${docTitle}] [Section: {section}] This passage {role}."
Output ONLY a JSON array matching input order: ["sentence1", "sentence2", ...]

Passages:
${items.map((it, idx) => `${idx + 1}. [Section: ${it.section || 'unknown'}] ${it.content}`).join('\n\n')}`;

		try {
			const raw = ((await callLLM(prompt, { model: GEMINI_MODEL, cache: false, serviceTier: 'flex' })) || '')
				.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
			const prefixes = JSON.parse(raw);
			if (!Array.isArray(prefixes)) continue;
			const pairs = batch.map((p, idx) => ({ id: p.id, prefix: (prefixes[idx] || '').trim() })).filter(x => x.prefix);
			writeCache(key, { prefixes: pairs });
			for (const { id, prefix } of pairs) result.set(id, prefix);
		} catch (_) {}
	}

	return result;
}

// Generate a 2-3 sentence document context summary from the first chunk.
// Result is cached so re-ingest on the same doc is free.
async function generateDocContext(ai, firstChunkText) {
	if (!ai || !firstChunkText) return null;
	const prompt = 'Summarize this document excerpt in 2-3 sentences. Focus on: what type of document this is, who the key participants are, and what the main subject matter is. Be specific about names and roles.\n\nTEXT:\n' + firstChunkText.slice(0, 3000) + '\n\nSUMMARY:';
	const credFp = credFingerprint();
	const key = cacheKeyFor(['doc_context_v1', firstChunkText.slice(0, 3000), GEMINI_MODEL, credFp]);
	const cached = readCacheSync(key);
	if (cached && typeof cached.summary === 'string') return cached.summary;
	try {
		const summary = ((await callLLM(prompt, { model: GEMINI_MODEL, cache: false, serviceTier: 'flex' })) || '').trim();
		if (summary) writeCache(key, { summary });
		return summary || null;
	} catch (err) {
		addPipelineLog('warn', `Doc context generation failed: ${err.message}`);
		return null;
	}
}

// Structure markdown using chunking + LLM with cache and retries
async function structureMarkdownWithRetries(ai, filename, mdContent) {
	if (!ai) {
		const err = new Error('No LLM client available for structuring Markdown. GEMINI_API_KEY must be set.');
		err.code = 'NO_LLM_CREDENTIAL';
		throw err;
	}

	// Pre-detect TOC and Glossary before chunking so they are not fed to the LLM as ordinary content.
	const { cleanedMarkdown, toc: heuristicToc, glossary: detectedGlossary } = preDetectSpecialSections(mdContent);
	if (detectedGlossary) addPipelineLog('info', `Glossary detected: ${detectedGlossary.entries.length} term(s) parsed`);

	// Tag heuristic TOC as explicit (it was physically present in the raw document).
	let detectedToc = heuristicToc ? { ...heuristicToc, source: 'explicit' } : null;
	if (detectedToc) addPipelineLog('info', `TOC detected (heuristic/explicit): ${detectedToc.entries.length} entry/entries`);

	let chunks = chunkMarkdown(cleanedMarkdown, { maxChars: 12000 });
	// test override: limit number of chunks processed when OHARA_TEST_CHUNKS_LIMIT is set
	const testLimit = parseInt(process.env.OHARA_TEST_CHUNKS_LIMIT || '0', 10) || 0;
	if (testLimit > 0) {
		addPipelineLog('info', `OHARA_TEST_CHUNKS_LIMIT set: trimming to ${testLimit} chunk(s)`);
		chunks = chunks.slice(0, testLimit);
	}
	addPipelineLog('info', `Markdown split into ${chunks.length} chunk(s) for ${filename}`);

	// If heuristic found no explicit TOC, fall back to LLM TOC detection on the first 3 chunks.
	if (!detectedToc) {
		const llmToc = await detectTocWithLLM(ai, chunks.slice(0, 3));
		if (llmToc) {
			if (llmToc.source === 'explicit' && llmToc.entries.length > 0) {
				detectedToc = llmToc;
			} else {
				// LLM says no explicit TOC — run PseudoTOC as final fallback.
				try {
					addPipelineLog('info', 'No explicit TOC found — running PseudoTOC (DocsRay Algorithm 1)...');
					const boundaryPrompt = fs.readFileSync(path.join('prompts', 'boundary_detection.md'), 'utf-8').trim();
					const titlePrompt = fs.readFileSync(path.join('prompts', 'generate_section_title.md'), 'utf-8').trim();
					const credFp = credFingerprint();
					const pseudoGen = new PseudoTOCGenerator(
						new GeminiTocLLMClient(ai, boundaryPrompt, titlePrompt, GEMINI_MODEL, { cacheKeyFor, writeCache, readCacheSync, credFp }),
						new GeminiEmbeddingClient(ai),
						null,
					);
					const pseudoSections = await pseudoGen.generate(chunks.map(c => ({ text: c.text })));
					if (pseudoSections.length > 0) {
						detectedToc = {
							source: 'implicit_pseudo',
							raw: null,
							entries: pseudoSections.map((s, i) => ({ title: s.title || `Section ${i + 1}`, level: 1 })),
						};
						addPipelineLog('info', `PseudoTOC generated: ${detectedToc.entries.length} section(s)`);
					}
				} catch (pseudoErr) {
					addPipelineLog('warn', `PseudoTOC generation failed: ${pseudoErr.message}`);
				}
			}
		}
	}

	// Generate a document-level context summary only for multi-chunk documents.
	// Single-chunk docs and short texts (<8 000 chars total) already have full context in every prompt.
	const DOC_CONTEXT_MIN_CHARS = 8000;
	const totalCharsApprox = chunks.reduce((s, c) => s + c.text.length, 0);
	const needsDocContext = chunks.length > 1 && totalCharsApprox >= DOC_CONTEXT_MIN_CHARS;
	const docContextSummary = needsDocContext ? await generateDocContext(ai, chunks[0]?.text || '') : null;
	if (docContextSummary) {
		addPipelineLog('info', `Doc context summary (${chunks.length} chunks, ~${totalCharsApprox} chars): "${docContextSummary.slice(0, 120)}..."`);
	} else if (!needsDocContext) {
		addPipelineLog('info', `Doc context injection skipped (${chunks.length} chunk(s), ~${totalCharsApprox} chars — below threshold)`);
	}

	// parallel pool
	const concurrency = parseInt(process.env.OHARA_INGEST_CONCURRENCY || '4', 10) || 4;

	// Try to create a Gemini server-side cache for the system prompt (needs ~32K tokens minimum).
	// Falls back gracefully — chunks just send the full prompt if cache creation fails.
	const systemPromptContent = fs.readFileSync(path.join('prompts', 'ingest_document.md'), 'utf-8').trim();
	let geminiCacheName = null;
	try {
		geminiCacheName = await createGeminiCache(systemPromptContent, { model: GEMINI_MODEL, ttlSeconds: 300 });
		addPipelineLog('info', `Gemini CachedContent created: ${geminiCacheName}`);
	} catch (cacheErr) {
		addPipelineLog('info', `Gemini CachedContent skipped (${cacheErr.message}) — sending full prompt per chunk`);
	}

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

		const promptNorm = systemPromptContent;
		const modelId = GEMINI_MODEL;
		const credFp = credFingerprint();
		const key = cacheKeyFor([promptNorm, chunk.text, modelId, credFp, docContextSummary || '']);

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
				const levelHint = chunk.headingLevel ? `\nHEADING_LEVEL:${chunk.headingLevel}` : '';
				const pageHint  = chunk.startPage != null ? `\nPAGE_RANGE:${chunk.startPage}-${chunk.endPage}` : '';
				const docCtxSection = docContextSummary ? `\nDOCUMENT_CONTEXT (applies to entire document, not just this excerpt):\n${docContextSummary}` : '';
				const chunkBody = `${levelHint}${pageHint}${docCtxSection}\n\nDOCUMENT_CHUNK_HEADING:${chunk.heading || ''}\n\n${chunk.text}`;
				const parsedText = geminiCacheName
					? (await callLLMWithCache(geminiCacheName, chunkBody, { model: modelId, cache: false, serviceTier: 'flex' })) || '{}'
					: (await callLLM(`${promptNorm}${chunkBody}`, { model: modelId, cache: false, serviceTier: 'flex' })) || '{}';
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
						const repairText = (await callLLM(repairPrompt, { model: modelId, cache: false, serviceTier: 'flex' })) || '';
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
				addPipelineLog('warn', `LLM error on chunk ${chunk.id} (model=${modelId}): ${err.message}`);
				if (attempt < maxAttempts) {
					const retryDelay = 5000 * Math.pow(3, attempt - 1); // 5s, 15s, 45s
					addPipelineLog('info', `Retrying chunk ${chunk.id} in ${retryDelay / 1000}s...`);
					await delay(retryDelay);
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
			try {
				const res = await worker(chunk);
				return { chunk, res };
			} catch (err) {
				return { chunk, error: err };
			}
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
	const failedChunks = [];
	const temporalCandidates = []; // collect temporal metadata from each chunk; pick highest-confidence
	const chunkIdToIndex = new Map();
	chunks.forEach((c, i) => chunkIdToIndex.set(c.id, i));
	const ordered = resultsArr.sort((a, b) => chunkIdToIndex.get(a.chunk.id) - chunkIdToIndex.get(b.chunk.id));

	for (const entry of ordered) {
		if (entry.error) {
			failedChunks.push({ id: entry.chunk.id, error: entry.error.message });
			// Preserve raw chunk text so no content is lost — LLM can reprocess later
			if (entry.chunk.text && entry.chunk.text.trim()) {
				mergedNodes.push({
					type: 'Paragraph',
					part: 'body_matter',
					content: entry.chunk.text.trim(),
					llm_pending: true,
					llm_error: entry.error.message,
					metadata: { page: entry.chunk.startPage ?? 1 },
					_chunk_start_page: entry.chunk.startPage,
					_chunk_end_page: entry.chunk.endPage,
					_page_source: entry.chunk.pageSource,
					sumo_tags: [],
					entities: [],
				});
			}
			continue;
		}
		const parsed = entry.res;
		if (!parsed) {
			addPipelineLog('warn', `Empty parsed output for chunk ${entry.chunk.id} — skipping`);
			continue;
		}
		// Collect temporal metadata from this chunk (document-level, take highest confidence later)
		if (parsed.temporal && typeof parsed.temporal === 'object') {
			temporalCandidates.push(parsed.temporal);
		}

		// Expect parsed to be { nodes: [...] } or { document: { texts: [...] } }
		if (parsed.nodes) {
			// Tag only the FIRST node with the Markdown heading level from the source chunk.
			// The LLM is instructed to treat HEADING_LEVEL as authoritative only for the
			// leading heading node; deeper nodes use the LLM's own metadata.level.
			if (entry.chunk.headingLevel != null && parsed.nodes.length > 0) {
				parsed.nodes[0]._chunk_heading_level = entry.chunk.headingLevel;
			}
			if (entry.chunk.startPage != null) {
				parsed.nodes.forEach(n => {
					n._chunk_start_page = entry.chunk.startPage;
					n._chunk_end_page   = entry.chunk.endPage;
					n._page_source      = entry.chunk.pageSource;
				});
			}
			mergedNodes.push(...parsed.nodes);
		} else if (parsed.document && Array.isArray(parsed.document.texts)) {
			parsed.document.texts.forEach(t => mergedNodes.push({ type: t.label === 'paragraph' ? 'Paragraph' : 'Paragraph', content: t.text, title: t.label && t.label.startsWith('heading') ? t.text : undefined }));
		} else {
			addPipelineLog('warn', `Unexpected parsed schema from LLM for chunk ${entry.chunk.id} — skipping`);
			continue;
		}
	}

	// All chunks failed — raw fallback nodes were added above, so mergedNodes is non-empty.
	// Log a clear warning but do NOT throw; content is preserved with llm_pending=true.
	if (failedChunks.length > 0) {
		addPipelineLog('warn', `${failedChunks.length} chunk(s) failed LLM structuring — stored as raw llm_pending paragraphs for later reprocessing`);
	}

	// Validate SUMO candidate tags for each node and promote to sumo_tags.
	// Provenance: sumo_candidate_tags (original LLM output) is preserved alongside
	// sumo_tags (validated canonicals) and sumo_resolved_map (alias mappings used).
	try {
		const sumoDropCounts = {};
		for (const node of mergedNodes) {
			if (node && Array.isArray(node.sumo_candidate_tags)) {
				const { valid, invalid, resolved_map } = validateTags(node.sumo_candidate_tags);
				node.sumo_tags = valid;
				node.sumo_candidate_tags_raw = node.sumo_candidate_tags;
				delete node.sumo_candidate_tags;
				if (Object.keys(resolved_map).length > 0) {
					node.sumo_resolved_map = resolved_map;
				}
				for (const tag of (invalid || [])) {
					sumoDropCounts[tag] = (sumoDropCounts[tag] || 0) + 1;
				}
			}
		}
		const totalSumoDrop = Object.values(sumoDropCounts).reduce((s, n) => s + n, 0);
		if (totalSumoDrop > 0) {
			const top = Object.entries(sumoDropCounts).sort((a, b) => b[1] - a[1]).slice(0, 8)
				.map(([t, n]) => `${t}×${n}`).join(', ');
			addPipelineLog('warn', `SUMO validation dropped ${totalSumoDrop} tag(s) across ${Object.keys(sumoDropCounts).length} distinct term(s) — top: ${top}`);
		}
	} catch (e) {
		addPipelineLog('error', `SUMO tag validation failed: ${e.message}`);
		const err = new Error('SUMO_VALIDATION_FAILED');
		err.code = 'SUMO_VALIDATION_FAILED';
		throw err;
	}

	// Process candidate_entities from each node — validate types, deduplicate within node.
	let entityDropTotal = 0;
	for (const node of mergedNodes) {
		if (node && Array.isArray(node.candidate_entities) && node.candidate_entities.length > 0) {
			const { valid, invalid } = processNodeEntities(node.candidate_entities);
			node.entities = valid;
			node.candidate_entities_raw = node.candidate_entities;
			delete node.candidate_entities;
			entityDropTotal += invalid.length;
		} else {
			node.entities = [];
			delete node.candidate_entities;
		}
	}
	if (entityDropTotal > 0) {
		addPipelineLog('warn', `Entity validation dropped ${entityDropTotal} entity/entities total across all nodes`);
	}

	// Pick the temporal candidate with highest confidence (first chunk often has front matter / dates)
	let bestTemporal = null;
	if (temporalCandidates.length > 0) {
		bestTemporal = temporalCandidates.reduce((best, t) =>
			(t.temporal_confidence ?? 0) > (best.temporal_confidence ?? 0) ? t : best
		, temporalCandidates[0]);
	}

	const completedChunks = chunks.length - failedChunks.length;
	return {
		nodes: mergedNodes,
		temporal: bestTemporal,
		llm_usage: { ...usageTotals, model: GEMINI_MODEL, chunks: chunks.length, cache_hits: chunkDiagnostics.filter(d => d.cache_hit).length },
		toc: detectedToc,
		glossary: detectedGlossary,
		total_chunks: chunks.length,
		completed_chunks: completedChunks,
		chunk_errors: failedChunks,
	};
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
		tables: [],
		adjacency: [],    // {fromId, fromCollection, toId, toCollection} for ADJACENT_TO edges
		para_sequence: [], // {fromId, toId} for NEXT_PARA edges
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

				// Dedup map: "(docId, level, normalizedTitle)" → existing section id.
				// When the same section header re-appears in a later chunk we reuse the
				// existing section node instead of creating a duplicate.
				const sectionDedup = new Map(); // key → section id

				// Adjacency tracking for ADJACENT_TO and NEXT_PARA edges
				const lastContentBySec = new Map(); // sectionId → {id, collection: 'para'|'table'}
				const lastParaBySec = new Map();    // sectionId → paraId

				rawContent.nodes.forEach((node, blockIdx) => {
					const nodeId = `okf_node_${blockIdx}_${Date.now()}`;
					const ntype = node.type || (node.metadata && node.metadata.type) || 'Paragraph';

					// Resolve page number: trust LLM's value only if it falls within the chunk's known range;
					// otherwise use chunkStart (from counted ----- markers, or virtual char-offset page).
					const chunkStart  = node._chunk_start_page ?? 1;
					const chunkEnd    = node._chunk_end_page   ?? chunkStart;
					const llmPage     = node.metadata?.page;
					const resolvedPage = (Number.isInteger(llmPage) && llmPage >= chunkStart && llmPage <= chunkEnd)
						? llmPage
						: chunkStart;
					const pageSource  = node._page_source ?? 'virtual';

					if (SECTION_TYPES.includes(ntype)) {
						// Prefer the Markdown # depth recorded during chunking; fall back to LLM output then type-name map.
						const level = node._chunk_heading_level ?? node.metadata?.level ?? LEVEL_OF[ntype] ?? 2;
						const title = (node.title || node.content?.split('\n')[0] || '').trim();
						const dedupKey = `${docId}::L${level}::${title.toLowerCase()}`;

						// pop stack until we find a shallower ancestor
						while (sectionStack.length > 0 && sectionStack[sectionStack.length - 1].level >= level) {
							sectionStack.pop();
						}

						if (sectionDedup.has(dedupKey)) {
							// Reuse the existing section — just restore it as the current context.
							const existingId = sectionDedup.get(dedupKey);
							sectionStack.push({ id: existingId, level });
							currentSectionId = existingId;
						} else {
							const parentSectionId = sectionStack.length > 0 ? sectionStack[sectionStack.length - 1].id : null;
							sectionStack.push({ id: nodeId, level });
							currentSectionId = nodeId;
							sectionDedup.set(dedupKey, nodeId);
							dbCollections.sections.push({
								id: nodeId,
								document_id: docId,
								parent_section_id: parentSectionId,
								node_type: ntype,
								title,
								level,
								page: resolvedPage,
								page_source: pageSource,
								summary: typeof node.summary === 'string' && node.summary.trim() ? node.summary.trim() : null,
							});
						}
					} else if (['Paragraph', 'ListItem'].includes(ntype)) {
						// Prefer flat content string (new schema). Fall back to joining sentences[]
						// for backwards-compat with cached LLM outputs that used the old schema.
						let content = '';
						if (typeof node.content === 'string' && node.content.trim()) {
							content = node.content;
						} else if (typeof node.text === 'string' && node.text.trim()) {
							content = node.text;
						} else if (Array.isArray(node.sentences) && node.sentences.length > 0) {
							content = node.sentences.map(s => s.content || s.text || '').filter(Boolean).join(' ');
						} else if (node.content != null) {
							content = String(node.content);
						}
						// Skip nodes with no extractable text
						if (!content.trim()) return;
						dbCollections.paragraphs.push({
							id: nodeId,
							document_id: docId,
							section_id: currentSectionId,
							node_type: 'Paragraph',
							content: content.trim(),
							page: resolvedPage,
							page_source: pageSource,
							llm_pending: node.llm_pending || false,
							llm_error: node.llm_error || null,
							sumo_tags: node.sumo_tags || [],
							sumo_candidate_tags_raw: node.sumo_candidate_tags_raw || [],
							sumo_resolved_map: node.sumo_resolved_map || {},
							entities: node.entities || [],
						});
						// NEXT_PARA: record sequential order within section
						const prevParaId = lastParaBySec.get(currentSectionId);
						if (prevParaId) dbCollections.para_sequence.push({ fromId: prevParaId, toId: nodeId });
						lastParaBySec.set(currentSectionId, nodeId);
						// ADJACENT_TO: para after table in same section
						const lastC = lastContentBySec.get(currentSectionId);
						if (lastC?.collection === 'table') dbCollections.adjacency.push({ fromId: lastC.id, fromCollection: 'table', toId: nodeId, toCollection: 'para' });
						lastContentBySec.set(currentSectionId, { id: nodeId, collection: 'para' });
					} else if (ntype === 'Figure') {
						// LLM returns Figure as: caption, figure (object with description/url), label
						const figureDesc = typeof node.figure === 'object'
							? (node.figure?.description || node.figure?.url || '')
							: (typeof node.figure === 'string' ? node.figure : '');
						const content = node.caption || figureDesc || node.label || node.description || (typeof node.content === 'string' ? node.content : '') || '';
						if (!content.trim()) return;
						dbCollections.paragraphs.push({
							id: nodeId,
							document_id: docId,
							section_id: currentSectionId,
							node_type: 'Figure',
							content,
							page: resolvedPage,
							page_source: pageSource,
							sumo_tags: node.sumo_tags || [],
							sumo_candidate_tags_raw: node.sumo_candidate_tags_raw || [],
							sumo_resolved_map: node.sumo_resolved_map || {},
							entities: node.entities || [],
						});
						// ADJACENT_TO: figure adjacent to previous para or table in same section
						const lastC = lastContentBySec.get(currentSectionId);
						if (lastC) dbCollections.adjacency.push({ fromId: lastC.id, fromCollection: lastC.collection, toId: nodeId, toCollection: 'para' });
						lastContentBySec.set(currentSectionId, { id: nodeId, collection: 'para' });
					} else if (ntype === 'Table') {
						const contentData = node.table?.content_data || node.metadata?.table_cells || node.table || [];
						const hasValidData = Array.isArray(contentData) && contentData.length > 0
							&& Array.isArray(contentData[0]) && contentData[0].length > 0;
						if (hasValidData) {
							// Generate markdown from matrix_data if LLM didn't provide it
							let mdRep = node.markdown || node.metadata?.markdown || '';
							if (!mdRep) {
								const header = contentData[0].map(c => String(c ?? '')).join(' | ');
								const sep = contentData[0].map(() => '---').join(' | ');
								const rows = contentData.slice(1).map(r => r.map(c => String(c ?? '')).join(' | '));
								mdRep = [header, sep, ...rows].join('\n');
							}
							dbCollections.tables.push({
								id: nodeId,
								document_id: docId,
								section_id: currentSectionId,
								node_type: 'Table',
								caption: node.caption || node.label || null,
								matrix_data: contentData,
								markdown_representation: mdRep,
							});
							// ADJACENT_TO: table adjacent to previous para in same section
							const lastC = lastContentBySec.get(currentSectionId);
							if (lastC?.collection === 'para') dbCollections.adjacency.push({ fromId: lastC.id, fromCollection: 'para', toId: nodeId, toCollection: 'table' });
							lastContentBySec.set(currentSectionId, { id: nodeId, collection: 'table' });
						} else {
							// Table data missing or malformed — preserve as raw Paragraph so no content is lost
							const fallback = [node.caption, node.label, node.markdown, node.metadata?.markdown]
								.filter(s => typeof s === 'string' && s.trim()).join('\n').trim();
							if (fallback) {
								dbCollections.paragraphs.push({
									id: nodeId,
									document_id: docId,
									section_id: currentSectionId,
									node_type: 'Table',
									content: fallback,
									sumo_tags: node.sumo_tags || [],
									sumo_candidate_tags_raw: node.sumo_candidate_tags_raw || [],
									sumo_resolved_map: node.sumo_resolved_map || {},
									entities: node.entities || [],
								});
							}
						}
					} else if (['Title', 'Abstract', 'Preface', 'Foreword', 'Appendix', 'Glossary', 'Index'].includes(ntype)) {
						const content = node.content || node.title || '';
						if (!content.trim()) return;
						dbCollections.paragraphs.push({
							id: nodeId,
							document_id: docId,
							section_id: currentSectionId,
							node_type: ntype,
							content: content.trim(),
							sumo_tags: node.sumo_tags || [],
							sumo_candidate_tags_raw: node.sumo_candidate_tags_raw || [],
							sumo_resolved_map: node.sumo_resolved_map || {},
							entities: node.entities || [],
						});
					} else if (ntype === 'Authors') {
						const agents = node.agents_group?.agents || [];
						const content = agents.map(a => a.name).filter(Boolean).join(', ');
						if (!content.trim()) return;
						dbCollections.paragraphs.push({
							id: nodeId,
							document_id: docId,
							section_id: currentSectionId,
							node_type: 'Authors',
							content: content.trim(),
							sumo_tags: node.sumo_tags || [],
							sumo_candidate_tags_raw: node.sumo_candidate_tags_raw || [],
							sumo_resolved_map: node.sumo_resolved_map || {},
							entities: node.entities || [],
						});
					} else if (ntype === 'Bibliography') {
						const refs = node.references || [];
						const content = refs.map(r => r.citation_text).filter(Boolean).join('\n');
						if (!content.trim()) return;
						dbCollections.paragraphs.push({
							id: nodeId,
							document_id: docId,
							section_id: currentSectionId,
							node_type: 'Bibliography',
							content: content.trim(),
							sumo_tags: node.sumo_tags || [],
							sumo_candidate_tags_raw: node.sumo_candidate_tags_raw || [],
							sumo_resolved_map: node.sumo_resolved_map || {},
							entities: node.entities || [],
						});
					} else if (ntype === 'Part') {
						const level = node.metadata?.level ?? 0;
						const title = (node.title || '').trim();
						if (!title) return;
						const parentSectionId = sectionStack.length > 0 ? sectionStack[sectionStack.length - 1].id : null;
						sectionStack.push({ id: nodeId, level });
						currentSectionId = nodeId;
						sectionDedup.set(`${docId}::L${level}::${title.toLowerCase()}`, nodeId);
						dbCollections.sections.push({
							id: nodeId,
							document_id: docId,
							parent_section_id: parentSectionId,
							node_type: 'Part',
							title,
							level,
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
				const minSectionDedup = new Map();

				rawContent.pdf_body.forEach((block, blockIdx) => {
					const nodeId = `min_node_${blockIdx}_${Date.now()}`;
					if (block.type === "title") {
						// title already captured above
					} else if (block.type === "heading") {
						const level = block.level || 1;
						const title = (block.text || '').trim();
						const dedupKey = `${docId}::L${level}::${title.toLowerCase()}`;
						while (minSectionStack.length > 0 && minSectionStack[minSectionStack.length - 1].level >= level) {
							minSectionStack.pop();
						}
						if (minSectionDedup.has(dedupKey)) {
							const existingId = minSectionDedup.get(dedupKey);
							minSectionStack.push({ id: existingId, level });
							currentSectionId = existingId;
						} else {
							const parentSectionId = minSectionStack.length > 0 ? minSectionStack[minSectionStack.length - 1].id : null;
							minSectionStack.push({ id: nodeId, level });
							currentSectionId = nodeId;
							minSectionDedup.set(dedupKey, nodeId);
							dbCollections.sections.push({
								id: nodeId,
								document_id: docId,
								parent_section_id: parentSectionId,
								node_type: 'Section',
								title,
								level,
							});
						}
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
						const cells = block.table_cells || [];
						let mdRep = block.markdown || '';
						if (!mdRep && cells.length > 0 && Array.isArray(cells[0])) {
							const header = cells[0].map(c => String(c ?? '')).join(' | ');
							const sep = cells[0].map(() => '---').join(' | ');
							const rows = cells.slice(1).map(r => r.map(c => String(c ?? '')).join(' | '));
							mdRep = [header, sep, ...rows].join('\n');
						}
						dbCollections.tables.push({
							id: nodeId,
							document_id: docId,
							section_id: currentSectionId,
							matrix_data: cells,
							markdown_representation: mdRep,
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

	// ── Post-process pass 0: normalize section levels ──────────────────────
	// Clamp child section levels to parent.level + 1 to prevent LEVEL_GAP warnings
	// caused by LLM-assigned levels that skip depth (e.g. L1 → L3).
	const secById = {};
	for (const sec of dbCollections.sections) secById[sec.id] = sec;
	for (const sec of dbCollections.sections) {
		if (sec.parent_section_id && secById[sec.parent_section_id]) {
			const parent = secById[sec.parent_section_id];
			if (sec.level - parent.level > 1) {
				sec.level = parent.level + 1;
			}
		}
	}

	// ── Post-process pass 1: strip PDF/Markdown artifacts ───────────────────
	// Artifacts are nodes whose content is structural noise: separator lines,
	// LLM placeholders, TOC page-number entries, pure-symbol strings, etc.
	// We drop these entirely — they carry no semantic content.
	function isArtifact(content) {
		if (typeof content !== 'string') return false;
		const t = content.trim();
		if (!t) return true;
		// Pure separator characters: dashes, pipes, equals, hashes, spaces, underscores, asterisks
		if (/^[-=|#\s*_~`]+$/.test(t)) return true;
		// LLM placeholder brackets: [... text ...] or [...more...]
		if (/^\[\.{2,}.*\]$/.test(t)) return true;
		// PDF table-of-contents artifact: mix of heading anchors + roman/arabic page numbers
		// e.g. "--- ###### Preface | xi -----"
		if (/#{2,}/.test(t) && /[-|]{2,}/.test(t)) return true;
		// Starts with markdown heading fence inside body text (leaked from chunker boundary)
		if (/^#{3,}\s/.test(t)) return true;
		// Fewer than 3 alphabetic characters — almost certainly not real prose
		const wordChars = (t.match(/[a-zA-Z]/g) || []).length;
		if (wordChars < 3) return true;
		return false;
	}

	dbCollections.paragraphs = dbCollections.paragraphs.filter(p => !isArtifact(p.content));

	// ── Post-process pass 2: reattach Paragraph fragments to their sibling ───
	// A "fragment" is a Paragraph node that got split away from its predecessor
	// (e.g. at a chunk boundary or by LLM over-segmentation). We never break an
	// existing paragraph apart — we only APPEND a fragment to the last real
	// Paragraph that precedes it in the same section.
	//
	// Detection: a Paragraph (not ListItem/Figure/Table) is a fragment when:
	//   • its content is < FRAGMENT_CHARS, AND
	//   • it starts with a lowercase letter (clear mid-sentence continuation), OR
	//   • it is < TINY_CHARS (too short to be a standalone paragraph).
	const FRAGMENT_CHARS = 120;
	const TINY_CHARS     = 60;

	function isFragment(p) {
		if (p.node_type !== 'Paragraph') return false;
		if (typeof p.content !== 'string') return false;
		const t = p.content.trim();
		if (t.length >= FRAGMENT_CHARS) return false;
		// starts lowercase → mid-sentence continuation
		if (/^[a-z]/.test(t)) return true;
		// extremely short → almost certainly detached fragment
		if (t.length < TINY_CHARS) return true;
		return false;
	}

	const reattached = [];
	for (const p of dbCollections.paragraphs) {
		if (isFragment(p)) {
			// Find the last Paragraph in reattached that shares the same section
			let absorbed = false;
			for (let k = reattached.length - 1; k >= 0; k--) {
				const prev = reattached[k];
				if (prev.document_id === p.document_id && prev.section_id === p.section_id && prev.node_type === 'Paragraph') {
					// Determine join separator: if prev ends with a sentence-ending char, use a space;
					// otherwise (mid-sentence break) join with a single space too — content is verbatim.
					prev.content = prev.content.trimEnd() + ' ' + p.content.trimStart();
					absorbed = true;
					break;
				}
				// Stop searching if we hit a section boundary marker (different section)
				if (prev.section_id !== p.section_id) break;
			}
			if (!absorbed) reattached.push(p); // no sibling found — keep as-is
		} else {
			reattached.push(p);
		}
	}
	dbCollections.paragraphs = reattached;

	return dbCollections;
}

const delay = (ms) => new Promise(res => setTimeout(res, ms));

// Single-document ingestion used by the queue worker (src/worker.js).
// Mirrors the per-file body of runPipelineExecution but reports progress via callback
// and classifies OOM / Gemini rate-limit errors so the worker can decide whether to retry.
export async function ingestSingleFile(filename, aiKey, onProgress = () => {}, options = {}) {
	// Token usage accumulator for this ingest run
	const _tokenUsage = { prompt: 0, output: 0, cached: 0, thoughts: 0, total: 0, calls: 0 };
	onTokenUsage(u => {
		_tokenUsage.prompt   += u.prompt;
		_tokenUsage.output   += u.output;
		_tokenUsage.cached   += u.cached;
		_tokenUsage.thoughts += u.thoughts;
		_tokenUsage.total    += u.total;
		_tokenUsage.calls    += 1;
	});

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
	const mdCachePath = path.join(rawOutputDir, filename, `${path.basename(filename, path.extname(filename))}.md`);
	const fileExists = fs.existsSync(fileContentPath);
	const mdCacheExists = fs.existsSync(mdCachePath);

	if (!fileExists && !mdCacheExists) {
		throw new Error(`Input file not found and no cached LiteParse output available: ${fileContentPath}`);
	}
	if (!fileExists) {
		addPipelineLog('warn', `Input file missing (${filename}) — will use cached LiteParse output at ${mdCachePath}`);
	}

	let fileHash = null;
	if (fileExists) {
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
					if (existing.ingestion_status === 'partial') {
						addPipelineLog('warn', `--force: re-ingesting partially-ingested document ${existing._key} (${existing.completed_chunks || 0}/${existing.total_chunks || '?'} chunks completed)`);
					} else {
						addPipelineLog('warn', `--force: deleting existing document ${existing._key} before re-ingesting…`);
					}
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

	// Determine ingestion status from chunk processing results
	const totalChunks = parsedLayoutJSON?.total_chunks ?? 0;
	const completedChunks = parsedLayoutJSON?.completed_chunks ?? 0;
	const chunkErrors = parsedLayoutJSON?.chunk_errors ?? [];
	let ingestionStatus = 'complete';
	let ingestionError = null;
	if (totalChunks > 0 && completedChunks < totalChunks) {
		if (completedChunks === 0) {
			ingestionStatus = 'failed';
			ingestionError = `All ${totalChunks} chunk(s) failed: ${chunkErrors.map(e => e.error).join('; ')}`;
		} else {
			ingestionStatus = 'partial';
			ingestionError = `LLM processing failed for ${totalChunks - completedChunks} of ${totalChunks} chunk(s)`;
		}
	}

	// Extract and carry llm_usage, toc, glossary, temporal separately; parsedLayoutJSON itself only needs the nodes
	const llmUsage = parsedLayoutJSON?.llm_usage || null;
	const detectedToc = parsedLayoutJSON?.toc || null;
	const detectedGlossary = parsedLayoutJSON?.glossary || null;
	const detectedTemporal = parsedLayoutJSON?.temporal || null;
	if (llmUsage) delete parsedLayoutJSON.llm_usage;
	if (parsedLayoutJSON?.toc) delete parsedLayoutJSON.toc;
	if (parsedLayoutJSON?.glossary) delete parsedLayoutJSON.glossary;
	if (parsedLayoutJSON?.temporal) delete parsedLayoutJSON.temporal;

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
				// Derive temporal_relation mapping for SIMILAR_TO edge enrichment
				const EXTENDS_VERBS = new Set(['extends', 'builds on', 'is based on', 'expands on', 'derives from', 'elaborates on', 'continues']);
				const SUPERSEDES_VERBS = new Set(['contradicts', 'supersedes', 'corrects', 'refutes', 'disproves', 'replaces', 'overrides', 'disputes']);

				const inserted = await arangoClient.insertDocument({
					source_file: doc.source_file,
					parser_engine: doc.parser_engine,
					title: doc.title,
					file_size: doc.file_size || '350 KB',
					upload_time: new Date().toISOString(),
					file_hash: fileHash || null,
					llm_usage: llmUsage || null,
					toc_raw: detectedToc?.raw || null,
					toc_source: detectedToc?.source || null,
					toc_entries: detectedToc?.entries || [],
					glossary_entries: detectedGlossary?.entries || [],
					ingestion_status: ingestionStatus,
					ingestion_error: ingestionError,
					total_chunks: totalChunks || null,
					completed_chunks: completedChunks || null,
					// Temporal metadata (LLM-extracted, flagged for human review)
					published_date: detectedTemporal?.published_date || null,
					temporal_coverage_start: detectedTemporal?.temporal_coverage_start || null,
					temporal_coverage_end: detectedTemporal?.temporal_coverage_end || null,
					temporal_granularity: detectedTemporal?.temporal_granularity || 'year',
					temporal_confidence: detectedTemporal?.temporal_confidence ?? null,
					temporal_needs_review: detectedTemporal != null,
					decay_class: detectedTemporal?.decay_class || 'SCHOLARLY',
					effective_decay_class: detectedTemporal?.decay_class || 'SCHOLARLY',
					similar_to_indegree: 0,
				});

				const docHandle = inserted._id || `documents/${inserted._key}`;

				// Insert sections; build internalId → ArangoDB _id map for paragraph/table linking.
				// Uses parent_section_id to wire Chapter→Section→Subsection hierarchy correctly,
				// and only creates NEXT_SIBLING edges between sections sharing the same parent.
				const BATCH_SIZE = 10;
				// Helper: run an array of async task-fns in parallel batches of BATCH_SIZE
				async function runBatched(items, taskFn) {
					for (let i = 0; i < items.length; i += BATCH_SIZE) {
						await Promise.all(items.slice(i, i + BATCH_SIZE).map(taskFn));
					}
				}

				const sectionIdMap = new Map(); // internal transform id → ArangoDB _id
				const docsSections = transformedDocs.sections.filter(s => s.document_id === doc.id);
				// Group sections by level so parents are always fully inserted before children.
				// Within each level-group, process in batches of BATCH_SIZE (parent IDs already resolved).
				// NEXT_SIBLING edges must reflect document order, so we assign sibling indices first.
				const siblingPrev = new Map(); // sec.id → previous sibling's internal id (or null)
				const seenByParent = new Map();
				for (const sec of docsSections) {
					const pkey = sec.parent_section_id || 'root';
					siblingPrev.set(sec.id, seenByParent.get(pkey) || null);
					seenByParent.set(pkey, sec.id);
				}

				const levelGroups = new Map();
				for (const sec of docsSections) {
					const lv = sec.level ?? 1;
					if (!levelGroups.has(lv)) levelGroups.set(lv, []);
					levelGroups.get(lv).push(sec);
				}
				const sortedLevels = [...levelGroups.keys()].sort((a, b) => a - b);

				for (const lv of sortedLevels) {
					const group = levelGroups.get(lv);
					// Process in batches; within each batch insert nodes + HAS_CHILD in parallel,
					// then add NEXT_SIBLING edges after the batch so sibling handles are all resolved.
					for (let i = 0; i < group.length; i += BATCH_SIZE) {
						const batch = group.slice(i, i + BATCH_SIZE);
						await Promise.all(batch.map(async (sec) => {
							// Resolve parent's ArangoDB _id (always available: parents are a lower level,
							// processed in a prior iteration of sortedLevels)
							const parentHandle = sec.parent_section_id ? sectionIdMap.get(sec.parent_section_id) : null;
							const secRes = await arangoClient.insertSection({
								document_id: inserted._key,
								title: sec.title,
								level: sec.level,
								node_type: sec.node_type || 'Section',
								page: sec.page ?? null,
								page_source: sec.page_source ?? null,
								// Store the resolved ArangoDB _id so verify/queries can follow the reference
								parent_section_id: parentHandle || null,
							});
							nodeCount += 1;
							const secHandle = secRes._id || `sections/${secRes._key}`;
							sectionIdMap.set(sec.id, secHandle);

							const fromHandle = parentHandle || docHandle;
							await arangoClient.insertEdge({ _from: fromHandle, _to: secHandle, relation: 'HAS_CHILD', type: 'HAS_CHILD' }).catch(()=>{});
						}));
						// Now all handles in this batch are in sectionIdMap — add NEXT_SIBLING edges
						await Promise.all(batch.map(async (sec) => {
							const secHandle = sectionIdMap.get(sec.id);
							const prevSibId = siblingPrev.get(sec.id);
							const prevHandle = prevSibId ? sectionIdMap.get(prevSibId) : null;
							if (prevHandle) {
								await arangoClient.insertEdge({ _from: prevHandle, _to: secHandle, relation: 'NEXT_SIBLING', type: 'NEXT_SIBLING' }).catch(()=>{});
							}
						}));
					}
				}

				// Insert paragraphs in parallel batches — section IDs are all resolved by now
				const docsParagraphs = transformedDocs.paragraphs.filter(p => p.document_id === doc.id);

				// Contextual prefix (Anthropic Contextual Retrieval): prepend "[Document: X] [Section: Y] This paragraph…"
				// to improve BM25 vocabulary coverage and embedding quality. Opt-in via OHARA_CONTEXTUAL_PREFIX=true.
				const contextualPrefixMap = new Map(); // para.id → prefix string
				if (process.env.OHARA_CONTEXTUAL_PREFIX === 'true' && ai) {
					// Build section title lookup: internal section id → title
					const secTitles = new Map(transformedDocs.sections.map(s => [s.id, s.title || '']));
					const prefixable = docsParagraphs.filter(p => typeof p.content === 'string' && p.content.length >= 80);
					const prefixes = await generateContextualPrefixes(ai, prefixable, doc.title || '', secTitles);
					for (const [id, prefix] of prefixes) contextualPrefixMap.set(id, prefix);
					addPipelineLog('info', `Contextual prefixes generated for ${contextualPrefixMap.size}/${prefixable.length} paragraphs`);
				}

				// Pre-compute embeddings for all paragraphs before inserting so the vector index is satisfied at insert time.
				const embeddingMap = new Map(); // index → float[]
				if (process.env.OHARA_EMBED_PARAGRAPHS === 'true' && ai) {
					const EMBED_MODEL = 'gemini-embedding-2';
					const embedBatch = parseInt(process.env.OHARA_EMBED_BATCH_SIZE || '20', 10);
					const embeddable = docsParagraphs
						.map((p, idx) => ({ idx, text: typeof p.content === 'string' && p.content.length >= 20 ? p.content.slice(0, 8192) : null }))
						.filter(e => e.text !== null);

					// Resolve cache hits first; collect misses for API call
					const misses = [];
					let cacheHits = 0;
					for (const item of embeddable) {
						const cacheKey = cacheKeyFor(['embed_v1', EMBED_MODEL, item.text]);
						const cached = readCacheSync(cacheKey);
						if (cached?.vec) {
							embeddingMap.set(item.idx, cached.vec);
							cacheHits++;
						} else {
							misses.push({ ...item, cacheKey });
						}
					}
					if (cacheHits > 0) addPipelineLog('info', `Embedding cache: ${cacheHits} hit(s), ${misses.length} miss(es) for ${doc.id}`);

					for (let i = 0; i < misses.length; i += embedBatch) {
						const batch = misses.slice(i, i + embedBatch);
						try {
							const resp = await ai.models.embedContent({
								model: EMBED_MODEL,
								contents: batch.map(b => b.text),
								config: { taskType: 'RETRIEVAL_DOCUMENT', outputDimensionality: 768 },
							});
							const embeddings = resp.embeddings || [];
							for (let j = 0; j < batch.length; j++) {
								const vec = embeddings[j]?.values;
								if (vec) {
									embeddingMap.set(batch[j].idx, vec);
									writeCacheSync(batch[j].cacheKey, { vec });
								}
							}
						} catch (embErr) {
							addPipelineLog('warn', `Embedding batch ${i}–${i + embedBatch} failed: ${embErr.message}`);
						}
					}
					addPipelineLog('info', `Embeddings ready for ${embeddingMap.size} paragraph(s) in ${doc.id}`);
				}

				const paraHandleMap = new Map(); // internal para id → ArangoDB _id (for NEXT_PARA + ADJACENT_TO)
				for (let piBatch = 0; piBatch < docsParagraphs.length; piBatch += BATCH_SIZE) {
					await Promise.all(docsParagraphs.slice(piBatch, piBatch + BATCH_SIZE).map(async (p, batchLocal) => {
						const pIdx = piBatch + batchLocal;
					const secHandle = p.section_id ? sectionIdMap.get(p.section_id) : null;
					const embedding = embeddingMap.get(pIdx) ?? new Array(768).fill(0);
					const contextualPrefix = contextualPrefixMap.get(p.id) || null;
					const paraRes = await arangoClient.insertParagraph({
						document_id: inserted._key,
						section_id: secHandle || null,
						node_type: p.node_type || 'Paragraph',
						content: p.content,
						contextual_prefix: contextualPrefix,
						is_latex: typeof p.content === 'string' && (p.content.includes('\\') || p.content.includes('^') || p.content.includes('_')),
						page: p.page ?? null,
						page_source: p.page_source ?? null,
						sumo_tags: p.sumo_tags || [],
						sumo_candidate_tags_raw: p.sumo_candidate_tags_raw || [],
						sumo_resolved_map: p.sumo_resolved_map || {},
						entity_slugs: (p.entities || []).map(e => e.slug),
						entity_types: (p.entities || []).map(e => e.type),
						embedding,
					});
					nodeCount += 1;
					const paraHandle = paraRes._id || `paragraphs/${paraRes._key}`;
					paraHandleMap.set(p.id, paraHandle);

					const edgePromises = [
						arangoClient.insertEdge({ _from: paraHandle, _to: docHandle, relation: 'BELONGS_TO', type: 'BELONGS_TO' }).catch(()=>{}),
						secHandle
							? arangoClient.insertEdge({ _from: secHandle, _to: paraHandle, relation: 'HAS_CHILD', type: 'HAS_CHILD' }).catch(()=>{})
							: Promise.resolve(),
					];

					// Upsert entities and create MENTIONS edges
					if (p.entities && p.entities.length > 0) {
						const entityHandles = await Promise.all(p.entities.map(async (entity) => {
							const res = await arangoClient.upsertEntity({ ...entity, norm_key: normalizeEntity(entity.canonical), document_id: inserted._key }).catch(() => null);
							return res ? (res._id || `entities/${res._key}`) : null;
						}));

						const validHandles = entityHandles.filter(Boolean);
						for (const entityHandle of validHandles) {
							edgePromises.push(
								arangoClient.insertEdge({
									_from: paraHandle,
									_to: entityHandle,
									relation: 'MENTIONS',
									type: 'MENTIONS',
									context: typeof p.content === 'string' ? p.content.slice(0, 200) : '',
								}).catch(()=>{})
							);
						}

						// RELATED_TO edges between entity pairs co-occurring in this paragraph
						for (let i = 0; i < validHandles.length; i++) {
							for (let j = i + 1; j < validHandles.length; j++) {
								edgePromises.push(
									arangoClient.insertEdge({ _from: validHandles[i], _to: validHandles[j], relation: 'RELATED_TO', type: 'RELATED_TO' }).catch(()=>{})
								);
							}
						}
					}

					await Promise.all(edgePromises);
				})); }

				// Roll up entity_slugs and sumo_tags onto the document record for O(docs) pre-filtering
				{
					const entitySlugSet = new Set();
					const sumoTagFreq = new Map();
					for (const p of docsParagraphs) {
						for (const e of (p.entities || [])) entitySlugSet.add(e.slug);
						for (const t of (p.sumo_tags || [])) sumoTagFreq.set(t, (sumoTagFreq.get(t) || 0) + 1);
					}
					// Sort by frequency descending so sumo_tags[0] is the dominant tag
					const sumoTags = [...sumoTagFreq.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
					const entitySlugs = [...entitySlugSet];
					// Generate a one-sentence document description from top paragraphs for cross-doc fingerprinting
					let docDescription = null;
					if (ai) {
						const snippets = docsParagraphs
							.filter(p => typeof p.content === 'string' && p.content.length > 80)
							.slice(0, 4)
							.map(p => p.content.slice(0, 400))
							.join('\n\n');
						if (snippets) {
							const descKey = cacheKeyFor(['doc_description_v1', snippets, GEMINI_MODEL]);
							const descCached = readCacheSync(descKey);
							if (descCached?.description) {
								docDescription = descCached.description;
							} else {
								try {
									const raw = await callLLM(
										`Summarize what this document is about in one sentence (≤25 words). Focus on topic, domain, and key argument. Output only the sentence.\n\n${snippets}`,
										{ model: GEMINI_MODEL, cache: false, serviceTier: 'flex' }
									);
									docDescription = (raw || '').trim().slice(0, 200) || null;
									if (docDescription) writeCacheSync(descKey, { description: docDescription });
								} catch (_) {}
							}
							if (docDescription) addPipelineLog('info', `Doc description: "${docDescription.slice(0, 80)}…"`);
						}
					}

					await arangoClient.updateDocument(inserted._key, {
						entity_slugs: entitySlugs,
						sumo_tags: sumoTags,
						entity_count: entitySlugs.length,
						...(docDescription ? { description: docDescription } : {}),
						...(_tokenUsage.calls > 0 ? { token_usage: { ..._tokenUsage, recorded_at: new Date().toISOString() } } : {}),
					}).catch(() => {});

					// Compute Jaccard similarity against all other documents and insert SIMILAR_TO edges
					const similarityThreshold = parseFloat(process.env.OHARA_SIMILARITY_THRESHOLD || '0.1');
					if (entitySlugs.length > 0 && similarityThreshold > 0) {
						const allDocs = transformedDocs.documents.filter(d => d.id !== doc.id);
						for (const otherDoc of allDocs) {
							if (!Array.isArray(otherDoc.entity_slugs) || otherDoc.entity_slugs.length === 0) continue;
							const otherSet = new Set(otherDoc.entity_slugs);
							const sharedSlugs = entitySlugs.filter(s => otherSet.has(s));
							const union = new Set([...entitySlugs, ...otherDoc.entity_slugs]).size;
							const jaccard = union > 0 ? sharedSlugs.length / union : 0;
							if (jaccard >= similarityThreshold) {
								const otherHandle = `documents/${otherDoc.id}`;
								const edgeRes = await arangoClient.insertEdge({
									_from: docHandle,
									_to: otherHandle,
									relation: 'SIMILAR_TO',
									type: 'SIMILAR_TO',
									weight: Math.round(jaccard * 1000) / 1000,
								}).catch(() => null);

								// LLM-enrich the edge with a semantic relationship description
								if (edgeRes?._id) {
									const otherParas = transformedDocs.paragraphs.filter(p => p.document_id === otherDoc.id);
									const snippetsA = docsParagraphs
										.filter(p => typeof p.content === 'string' && p.content.length > 50)
										.slice(0, 3).map(p => p.content.slice(0, 300));
									const snippetsB = otherParas
										.filter(p => typeof p.content === 'string' && p.content.length > 50)
										.slice(0, 3).map(p => p.content.slice(0, 300));
									const enrichment = await enrichCrossDocEdge(ai, doc, otherDoc, snippetsA, snippetsB, sharedSlugs);
									if (enrichment) {
										// Derive temporal_relation from the LLM-generated verb (no extra API call)
										const verbLower = (enrichment.verb || '').toLowerCase();
										let temporalRelation = 'discusses';
										if (EXTENDS_VERBS.has(verbLower) || [...EXTENDS_VERBS].some(v => verbLower.includes(v))) {
											temporalRelation = 'extends';
										} else if (SUPERSEDES_VERBS.has(verbLower) || [...SUPERSEDES_VERBS].some(v => verbLower.includes(v))) {
											temporalRelation = 'supersedes';
										}
										await updateArangoEdge(edgeRes._id, { ...enrichment, temporal_relation: temporalRelation }).catch(() => {});
										addPipelineLog('info', `Cross-doc edge enriched: "${enrichment.verb}" (${temporalRelation}) between ${doc.id} ↔ ${otherDoc.id}`);

										// E2: CONTRADICTS edge — temporal supersession OR explicit conceptual conflict
										const contradictionNote = (typeof enrichment.contradiction_note === 'string' && enrichment.contradiction_note.trim() && enrichment.contradiction_note.trim().toLowerCase() !== 'null')
											? enrichment.contradiction_note.trim()
											: null;
										if (temporalRelation === 'supersedes' || contradictionNote) {
											await arangoClient.insertEdge({
												_from: docHandle,
												_to: otherHandle,
												relation: 'CONTRADICTS',
												type: 'CONTRADICTS',
												contradiction_note: contradictionNote || enrichment.summary || null,
												source: temporalRelation === 'supersedes' ? 'temporal_supersession' : 'conceptual_conflict',
											}).catch(() => {});
											addPipelineLog('info', `CONTRADICTS edge (${temporalRelation === 'supersedes' ? 'temporal' : 'conceptual'}): ${doc.id} → ${otherDoc.id}`);
										}

										// Increment similar_to_indegree on the target document
										await arangoClient.updateDocument(otherDoc.id, {
											similar_to_indegree: (otherDoc.similar_to_indegree || 0) + 1,
										}).catch(() => {});

										// Auto-promote to EVERGREEN if in-degree crosses threshold
										const evergreenThreshold = parseInt(process.env.OHARA_SIMILAR_TO_EVERGREEN_THRESHOLD || '5', 10);
										const newIndegree = (otherDoc.similar_to_indegree || 0) + 1;
										if (newIndegree >= evergreenThreshold) {
											await arangoClient.updateDocument(otherDoc.id, { effective_decay_class: 'EVERGREEN' }).catch(() => {});
											addPipelineLog('info', `Document ${otherDoc.id} auto-promoted to EVERGREEN (similar_to_indegree=${newIndegree})`);
										}
									}
								}
							}
						}
					}
				}

				// TOC_REF edges: link document → section nodes that match toc_entries by page or title.
				// Provides a navigable path: document → (TOC_REF) → section for retrieval.
				if (detectedToc?.entries?.length) {
					const docSections = transformedDocs.sections.filter(s => s.document_id === doc.id);
					for (const entry of detectedToc.entries) {
						const match = docSections.find(s =>
							(entry.page != null && s.page === entry.page) ||
							(entry.title && s.title?.toLowerCase().trim() === entry.title.toLowerCase().trim())
						);
						if (match) {
							const secHandle = sectionIdMap.get(match.id);
							if (secHandle) {
								await arangoClient.insertEdge({
									_from: docHandle,
									_to: secHandle,
									relation: 'TOC_REF',
									type: 'TOC_REF',
									toc_title: entry.title,
									toc_page: entry.page ?? null,
									toc_level: entry.level ?? 1,
								}).catch(() => {});
							}
						}
					}
				}

				// Structural verification: check HAS_CHILD edge consistency (no orphaned sections, no level jumps >1)
				{
					const docSecs = transformedDocs.sections.filter(s => s.document_id === doc.id);
					let structureOk = true;
					const levelById = new Map(docSecs.map(s => [s.id, s.level ?? 1]));
					for (const sec of docSecs) {
						if (sec.parent_section_id) {
							const parentLevel = levelById.get(sec.parent_section_id);
							if (parentLevel != null && (sec.level ?? 1) - parentLevel > 1) {
								structureOk = false;
								addPipelineLog('warn', `Structure anomaly in ${doc.id}: section "${sec.title}" (level ${sec.level}) jumps from parent level ${parentLevel}`);
								break;
							}
						}
					}
					if (!structureOk) {
						await arangoClient.updateDocument(inserted._key, { structure_needs_review: true }).catch(() => {});
						addPipelineLog('warn', `Document ${doc.id} flagged structure_needs_review=true`);
					}
				}

				// Insert tables in parallel batches — same pattern as paragraphs
				const docsTables = transformedDocs.tables.filter(t => t.document_id === doc.id);
				const tableHandleMap = new Map(); // internal table id → ArangoDB _id (for ADJACENT_TO)
				await runBatched(docsTables, async (t) => {
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
					tableHandleMap.set(t.id, tblHandle);
					await Promise.all([
						arangoClient.insertEdge({ _from: tblHandle, _to: docHandle, relation: 'BELONGS_TO', type: 'BELONGS_TO' }).catch(()=>{}),
						secHandle
							? arangoClient.insertEdge({ _from: secHandle, _to: tblHandle, relation: 'HAS_CHILD', type: 'HAS_CHILD' }).catch(()=>{})
							: Promise.resolve(),
					]);
				});

				// E3: NEXT_PARA edges — sequential paragraph order within sections
				if (process.env.OHARA_NEXT_PARA !== 'false') {
					const paraSeq = (transformedDocs.para_sequence || []).filter(s => s.fromId && s.toId);
					await runBatched(paraSeq, async ({ fromId, toId }) => {
						const fromHandle = paraHandleMap.get(fromId);
						const toHandle = paraHandleMap.get(toId);
						if (fromHandle && toHandle) await arangoClient.insertEdge({ _from: fromHandle, _to: toHandle, relation: 'NEXT_PARA', type: 'NEXT_PARA' }).catch(() => {});
					});
					if (paraSeq.length) addPipelineLog('info', `NEXT_PARA: ${paraSeq.length} sequential paragraph edge(s)`);
				}

				// E1: ADJACENT_TO edges — bidirectional between consecutive para↔figure/table in same section
				if (process.env.OHARA_ADJACENT_TO !== 'false') {
					const adjacency = (transformedDocs.adjacency || []).filter(a => a.fromId && a.toId);
					await runBatched(adjacency, async ({ fromId, fromCollection, toId, toCollection }) => {
						const fromHandle = fromCollection === 'table' ? tableHandleMap.get(fromId) : paraHandleMap.get(fromId);
						const toHandle = toCollection === 'table' ? tableHandleMap.get(toId) : paraHandleMap.get(toId);
						if (fromHandle && toHandle) {
							await arangoClient.insertEdge({ _from: fromHandle, _to: toHandle, relation: 'ADJACENT_TO', type: 'ADJACENT_TO' }).catch(() => {});
							await arangoClient.insertEdge({ _from: toHandle, _to: fromHandle, relation: 'ADJACENT_TO', type: 'ADJACENT_TO' }).catch(() => {});
						}
					});
					if (adjacency.length) addPipelineLog('info', `ADJACENT_TO: ${adjacency.length * 2} adjacency edge(s)`);
				}

			} catch (err) {
				addPipelineLog('error', `ArangoDB persistence failed for ${doc.source_file}: ${err.message}`);
				throw err;
			}
		} else {
			const insertedDoc = arangoDb.insertDocument({ _key: doc.id, source_file: doc.source_file, parser_engine: doc.parser_engine, title: doc.title, file_size: doc.file_size || '350 KB', upload_time: new Date().toISOString(), toc_raw: detectedToc?.raw || null, toc_source: detectedToc?.source || null, toc_entries: detectedToc?.entries || [], glossary_entries: detectedGlossary?.entries || [], ingestion_status: ingestionStatus, ingestion_error: ingestionError, total_chunks: totalChunks || null, completed_chunks: completedChunks || null });

			const docsSections = transformedDocs.sections.filter(s => s.document_id === doc.id);
			docsSections.forEach(sec => { arangoDb.insertSection({ _key: sec.id, document_id: insertedDoc._key, title: sec.title, level: sec.level, page: sec.page ?? null, page_source: sec.page_source ?? null }); nodeCount += 1; });

			const docsParagraphs = transformedDocs.paragraphs.filter(p => p.document_id === doc.id);
			docsParagraphs.forEach(p => { arangoDb.insertParagraph({ _key: p.id, document_id: insertedDoc._key, section_id: p.section_id ? `sections/${p.section_id}` : null, content: p.content, is_latex: typeof p.content === 'string' && (p.content.includes('\\') || p.content.includes('^') || p.content.includes('_')), page: p.page ?? null, page_source: p.page_source ?? null }); nodeCount += 1; });

			const docsTables = transformedDocs.tables.filter(t => t.document_id === doc.id);
			docsTables.forEach(t => { arangoDb.insertTable({ _key: t.id, document_id: insertedDoc._key, section_id: t.section_id ? `sections/${t.section_id}` : null, matrix_data: t.matrix_data || [], markdown_representation: t.markdown_representation || '' }); nodeCount += 1; });

			// TOC_REF edges for in-memory simulator path
			if (detectedToc?.entries?.length) {
				const docHandle = `documents/${insertedDoc._key}`;
				for (const entry of detectedToc.entries) {
					const match = docsSections.find(s =>
						(entry.page != null && s.page === entry.page) ||
						(entry.title && s.title?.toLowerCase().trim() === entry.title.toLowerCase().trim())
					);
					if (match) {
						arangoDb.insertEdge?.({
							_from: docHandle,
							_to: `sections/${match.id}`,
							relation: 'TOC_REF',
							type: 'TOC_REF',
							toc_title: entry.title,
							toc_page: entry.page ?? null,
							toc_level: entry.level ?? 1,
						});
					}
				}
			}
		}

		onProgress(75 + Math.round(((i + 1) / totalDocs) * 20), `Extracting Nodes ${nodeCount}...`);
	}

	onProgress(100, `Completed ingestion of ${filename} (${nodeCount} nodes).`);

	clearTokenUsageHandler();
	if (_tokenUsage.calls > 0) {
		addPipelineLog('info', `[token summary] calls=${_tokenUsage.calls} prompt=${_tokenUsage.prompt} output=${_tokenUsage.output} cached=${_tokenUsage.cached} thoughts=${_tokenUsage.thoughts} total=${_tokenUsage.total}`);
	} else {
		addPipelineLog('info', '[token summary] 0 LLM calls — all chunks served from disk cache');
	}

	// Auto entity dedup after ingest
	if (process.env.OHARA_AUTO_ENTITY_DEDUP === 'true') {
		try { await runEntityDedup(); } catch (e) { addPipelineLog('warn', `Auto entity dedup failed: ${e.message}`); }
	}

	return {
		filename,
		documents: docsForThisFile.length,
		nodes: nodeCount,
		llm_usage: llmUsage || null,
		token_usage: _tokenUsage,
		ingestion_status: ingestionStatus,
		ingestion_error: ingestionError,
		total_chunks: totalChunks || null,
		completed_chunks: completedChunks || null,
	};
}

/**
 * Ingest HTML pages already stored in the `crawl` ArangoDB collection.
 * Does NOT crawl — reads only from the database.
 *
 * @param {string|null} domain - Filter by hostname (e.g. "rwatimes.io"). Null/omit = all records.
 * @param {string} aiKey - Gemini API key
 * @param {Function} onProgress - (pct, msg) progress callback
 * @param {object} opts - { force }
 */
export async function ingestCrawledDomain(domain, aiKey, onProgress = () => {}, opts = {}) {
	const db = await arangoClient.initArangoClient();
	const crawlColl = db.collection('crawl');
	if (!(await crawlColl.exists())) throw new Error(`Collection 'crawl' not found. Run the crawl command first.`);

	let cursor;
	if (domain) {
		const hostname = domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
		cursor = await db.query(
			'FOR doc IN crawl FILTER CONTAINS(doc.url, @hostname) RETURN doc',
			{ hostname }
		);
		addPipelineLog('info', `Querying crawl records for hostname: ${hostname}`);
	} else {
		cursor = await db.query('FOR doc IN crawl RETURN doc');
		addPipelineLog('info', 'Querying all crawl records');
	}

	const pages = await cursor.all();

	if (pages.length === 0) {
		addPipelineLog('warn', `No crawled pages found${domain ? ` for domain: ${domain}` : ''}`);
		return { ingested: 0, failed: 0, skipped: 0, total: 0 };
	}

	addPipelineLog('info', `Found ${pages.length} crawled page(s) to ingest`);

	const inputDir = 'doc_pipeline/input';
	fs.mkdirSync(inputDir, { recursive: true });

	// Group pages by root domain so each domain becomes ONE document with pages as sections.
	const byDomain = new Map();
	for (const page of pages) {
		let hostname;
		try { hostname = new URL(page.url).hostname; } catch { hostname = 'unknown'; }
		if (!byDomain.has(hostname)) byDomain.set(hostname, []);
		byDomain.get(hostname).push(page);
	}

	let ingested = 0, failed = 0, skipped = 0;
	const domainList = [...byDomain.entries()];

	for (let di = 0; di < domainList.length; di++) {
		const [hostname, domainPages] = domainList[di];
		onProgress(Math.round((di / domainList.length) * 100), `Bundling ${domainPages.length} page(s) for ${hostname}`);

		// Build one combined markdown: H1 = domain, H2 = each page
		const sections = domainPages.map(page => {
			const titleInfo = extractHtmlTitle(page.html) || { text: new URL(page.url).pathname || page.url };
			const md = htmlToMarkdown(page.html);
			return `## ${titleInfo.text}\n\n<!-- url: ${page.url} -->\n\n${md}`;
		});
		const combinedMd = `# ${hostname}\n\n${sections.join('\n\n---\n\n')}`;

		const slug = hostname.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
		const filename = `${slug}.md`;
		fs.writeFileSync(path.join(inputDir, filename), combinedMd, 'utf-8');
		addPipelineLog('info', `Bundled ${domainPages.length} pages → ${filename}`);

		try {
			await ingestSingleFile(filename, aiKey, () => {}, opts);
			ingested++;
			addPipelineLog('info', `[${di + 1}/${domainList.length}] Ingested domain bundle: ${hostname}`);
		} catch (err) {
			if (err.code === 'ALREADY_INGESTED') {
				skipped++;
				addPipelineLog('info', `[${di + 1}/${domainList.length}] Skipped (already ingested): ${hostname}`);
			} else {
				failed++;
				addPipelineLog('error', `[${di + 1}/${domainList.length}] Failed ${hostname}: ${err.message}`);
			}
		}
	}

	onProgress(100, `Done. ${ingested} ingested, ${skipped} skipped, ${failed} failed.`);
	return { ingested, failed, skipped, total: domainList.length };
}
