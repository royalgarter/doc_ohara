To implement this document parsing pipeline within Google AI Studio using Gemini, we need to adapt the architecture. Gemini 1.5 Pro and Flash have a massive context window (up to 2 million tokens) and native multimodal document processing capabilities.
Instead of hosting heavy Docker engines like Docling or MinerU on your local machine, you can upload almost any document (PDFs, Word docs, TXT) directly to the Gemini API. We then instruct Gemini to act as our structural layout engine using Structured Outputs (JSON Schema) to return database-ready collections instantly.
Here is the complete, runnable Node.js application that uses the official Google Gen AI SDK to process a directory of documents into relational JSON collections.
## 🛠️ Step 1: Install the Official Google Gen AI SDK
Ensure you install the correct, current SDK package (@google/genai) along with uuid to manage node connections:

npm install @google/genai uuid dotenv

## 🔑 Step 2: Set Up Your API Key
Get an API key from Google AI Studio. Create a .env file in your root folder:

GEMINI_API_KEY=your_actual_ai_studio_api_key_here

## 💻 Step 3: The Complete Production Application (app.js)
Save this code into a file named app.js. Ensure your package.json file contains "type": "module".
This script scans your ./input folder, uploads files using the secure Google Files API, and calls Gemini with a rigid JSON Schema. Gemini returns data broken down into Documents, Sections, Paragraphs, and Tables, mimicking the DoCO ontology.

import { GoogleGenAI, Type } from '@google/genai';import fs from 'fs';import path from 'path';import { v4 as uuidv4 } from 'uuid';import 'dotenv/config';
// 1. Initialize the Google Gen AI clientconst ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const INPUT_DIR = './input';const OUTPUT_DIR = './collections';
// Initialize global in-memory relational collectionsconst dbCollections = {
    documents: [],
    sections: [],
    paragraphs: [],
    tables: []
};
// 2. Define the exact strict JSON Schema for the database mappingconst docoResponseSchema = {
    type: Type.OBJECT,
    properties: {
        title: { 
            type: Type.STRING, 
            description: "The official main title of the document." 
        },
        sections: {
            type: Type.ARRAY,
            items: {
                type: Type.OBJECT,
                properties: {
                    local_id: { type: Type.STRING, description: "A unique temporary slug id for tracking within this file like 'sec_1'." },
                    title: { type: Type.STRING, description: "Heading text or section name." },
                    level: { type: Type.INTEGER, description: "1 for Chapters/Major Headings, 2 for Subsections, 3 for sub-subsections." },
                    parent_local_id: { type: Type.STRING, description: "The local_id of the parent section, if applicable. Null if top-level." }
                },
                required: ["local_id", "title", "level"]
            }
        },
        paragraphs: {
            type: Type.ARRAY,
            items: {
                type: Type.OBJECT,
                properties: {
                    content: { type: Type.STRING, description: "The raw text block content of the paragraph or list item." },
                    parent_section_local_id: { type: Type.STRING, description: "The local_id of the section heading this paragraph belongs to." }
                },
                required: ["content", "parent_section_local_id"]
            }
        },
        tables: {
            type: Type.ARRAY,
            items: {
                type: Type.OBJECT,
                properties: {
                    markdown: { type: Type.STRING, description: "A clean markdown string representation of the table matrix data." },
                    parent_section_local_id: { type: Type.STRING, description: "The local_id of the section this table belongs to." }
                },
                required: ["markdown", "parent_section_local_id"]
            }
        }
    },
    required: ["title", "sections", "paragraphs", "tables"]
};
async function processPipeline() {
    try {
        if (!fs.existsSync(INPUT_DIR)) fs.mkdirSync(INPUT_DIR);
        if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR);

        const files = fs.readdirSync(INPUT_DIR);
        if (files.length === 0) {
            console.log("ℹ️ Input folder empty. Place documents (PDFs, DOCX, etc) in './input'.");
            return;
        }

        for (const filename of files) {
            const filePath = path.join(INPUT_DIR, filename);
            if (fs.statSync(filePath).isDirectory()) continue;

            console.log(`\n📤 Uploading ${filename} to Gemini File Manager API...`);
            
            // Upload file via the official Files API (ideal for massive files and PDFs)
            const uploadResult = await ai.files.upload({
                file: filePath,
                mimeType: getMimeType(filename)
            });

            console.log(`🧠 Processing structure extraction via Gemini 1.5 Pro...`);
            
            const response = await ai.models.generateContent({
                model: 'gemini-1.5-pro',
                contents: [
                    uploadResult,
                    "Analyze this document and extract its deep micro-structure. Flatten its chapters, sections, sub-sections, narrative text paragraphs, and tables completely into the specified structured JSON format following the provided structural schema properties."
                ],
                config: {
                    // Enforce structured outputs matching our database schema
                    responseMimeType: "application/json",
                    responseSchema: docoResponseSchema,
                    temperature: 0.1 // Lower temperature for analytical structure accuracy
                }
            });

            // Parse Gemini's structured response safely
            const parsedData = JSON.parse(response.text);
            normalizeToCollections(parsedData, filename);

            // Clean up files in Gemini's storage environment when done
            await ai.files.delete({ name: uploadResult.name });
            console.log(`🗑️ Cleaned up remote instance storage file: ${uploadResult.name}`);
        }

        // Save normalized database tables to file collections
        saveCollections();

    } catch (error) {
        console.error("❌ Pipeline Error Execution Failed:", error);
    }
}
// Map the relative structured response nodes to true database UUID relationsfunction normalizeToCollections(data, filename) {
    const docUuid = uuidv4();
    
    dbCollections.documents.push({
        id: docUuid,
        source_file: filename,
        title: data.title || filename
    });

    const localToGlobalSectionMap = {};

    // First Loop: Populate Sections and generate true DB Keys
    data.sections?.forEach(sec => {
        const globalSecUuid = uuidv4();
        localToGlobalSectionMap[sec.local_id] = globalSecUuid;

        dbCollections.sections.push({
            id: globalSecUuid,
            document_id: docUuid,
            title: sec.title,
            level: sec.level,
            parent_id: null, // Will map in secondary check
            _local_id: sec.local_id, // temp hold
            _parent_local_id: sec.parent_local_id // temp hold
        });
    });

    // Resolve structural parenting mapping loops
    dbCollections.sections.forEach(sec => {
        if (sec.document_id === docUuid && sec._parent_local_id) {
            sec.parent_id = localToGlobalSectionMap[sec._parent_local_id] || null;
        }
        delete sec._local_id;
        delete sec._parent_local_id;
    });

    // Populate Paragraphs with mapped Section contexts
    data.paragraphs?.forEach(para => {
        dbCollections.paragraphs.push({
            id: uuidv4(),
            document_id: docUuid,
            section_id: localToGlobalSectionMap[para.parent_section_local_id] || null,
            content: para.content
        });
    });

    // Populate Matrix Tables
    data.tables?.forEach(tbl => {
        dbCollections.tables.push({
            id: uuidv4(),
            document_id: docUuid,
            section_id: localToGlobalSectionMap[tbl.parent_section_local_id] || null,
            markdown_content: tbl.markdown
        });
    });
}
function saveCollections() {
    Object.keys(dbCollections).forEach((key) => {
        fs.writeFileSync(
            path.join(OUTPUT_DIR, `${key}.json`), 
            JSON.stringify(dbCollections[key], null, 2)
        );
        console.log(`💾 Generated collection array file: ${key}.json (${dbCollections[key].length} entries saved)`);
    });
}
function getMimeType(filename) {
    const ext = path.extname(filename).toLowerCase();
    if (ext === '.pdf') return 'application/pdf';
    if (ext === '.docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    if (ext === '.txt') return 'text/plain';
    return 'application/octet-stream';
}
// Fire execution processing engine
processPipeline();

------------------------------
## 🚀 Running the AI Studio App

   1. Create a folder named input/ and add sample files (e.g., a multi-page PDF handbook, a .docx assignment).
   2. Execute the application script via terminal:
   
   node app.js
   
   
## 📁 View the Structural Outputs
After processing completes, open the ./collections/ directory. You will find four relational collections. Check sections.json to see how Gemini automatically mapped your hierarchy using clean, structural database keys:

[
  {
    "id": "e2a6b1c8-2345-4bfa-912a-394ddda44122",
    "document_id": "01af3344-9bc0-4e3b-b2cd-9e99aaccbb11",
    "title": "Chapter 1: Neural Layer Initialization",
    "level": 1,
    "parent_id": null
  },
  {
    "id": "89b7cd5f-6789-40af-a123-556677889900",
    "document_id": "01af3344-9bc0-4e3b-b2cd-9e99aaccbb11",
    "title": "1.1 Backpropagation Mathematics",
    "level": 2,
    "parent_id": "e2a6b1c8-2345-4bfa-912a-394ddda44122"
  }
]

Would you like to extend this script to generate vector embeddings using Gemini’s text-embedding-004 model for each paragraph before saving them to disk? This will make your database fully ready for AI-powered semantic search.

---

Building a universal document ingestion and parsing engine requires a layered, decoupled system architecture. You cannot rely on a single parsing tool because PDFs, Word documents (.docx), Ebooks (.epub), and Markdown files store data in completely fundamentally different formats. [1, 2]
To convert any file into a deeply structured, queryable knowledge base containing chapters, headings, paragraphs, tables, and tag metadata, you must implement the following pipeline. [3]
------------------------------
## 🌐 System Architecture Pipeline

  📥 Any Document     ───►   📦 Ingestion Layer   ───►   🧠 Parsing Engine
 (PDF, DOCX, EPUB)          (Express / FastAPI)         (Unstructured / Apache Tika)
                                                                 │
                                                                 ▼
  🗄️ Query / Retrieval ◄───   📂 Storage Layer     ◄───   🏷️ Structural Schema
(PostgreSQL + PgVector)     (Relational + Graph)        (DoCO/SKOS/JSON Standard)

------------------------------
## 1. The Engineering Blueprint: Step-by-Step## Step 1: Standardized Ingestion [4]
Your backend api accepts multi-part form uploads. You must first extract the file extension and MIME type to dynamically route the file to its appropriate worker pipeline. [5]
## Step 2: Structural Extraction (The Core Engine)
Instead of writing native code to parse binary PDFs or zip-compressed EPUB xml layouts, deploy a highly optimized open-source extraction engine:

* Unstructured.io (Highly Recommended): The current industry standard for AI applications. It accepts almost any file format and automatically strips out structural elements, returning a clean array of elements labeled as Title, Header, NarrativeText (Paragraph), ListItem, or Table. [6, 7, 8, 9, 10]
* Apache Tika: A bulletproof, Java-based enterprise tool that detects and extracts metadata and text from over a thousand different file types. [11, 12]

## Step 3: Semantic Normalization
Map the raw engine output into a uniform structural JSON object based on the DoCO (Document Components Ontology) principles we discussed. Every document must end up inside the database looking exactly like this unified schema:

{
  "document_id": "doc_2026_9981",
  "metadata": {
    "title": "Advanced Quantum Architecture",
    "author": "Dr. Sarah Jenkins",
    "tags": ["Quantum Computing", "Physics"]
  },
  "structure": {
    "toc": [
      {"label": "Chapter 1", "target_node": "node_ch_1"},
      {"label": "Section 1.1", "target_node": "node_sec_1_1"}
    ],
    "alphabet_index": [
      {"keyword": "Qubit", "references": ["node_para_112", "node_para_115"]}
    ]
  },
  "nodes": [
    {
      "id": "node_ch_1",
      "type": "Chapter",
      "title": "Chapter 1: The Quantum Landscape",
      "parent_id": null
    },
    {
      "id": "node_sec_1_1",
      "type": "Section",
      "title": "1.1 Superposition Principles",
      "parent_id": "node_ch_1"
    },
    {
      "id": "node_para_112",
      "type": "Paragraph",
      "text": "Superposition allows a quantum system to be in multiple states simultaneously...",
      "parent_id": "node_sec_1_1",
      "vector_embedding_stored": true
    }
  ]
}

## Step 4: Storage & Indexing Strategy
To enable both precise logical filtering and AI-powered semantic search, use a hybrid storage approach: [13]

* Relational Database (PostgreSQL): Create a hierarchical self-referencing table (nodes) with columns for id, document_id, type, content, and parent_id.
* Vector Extension (pgvector): Generate and store vector embeddings for every single text node (Paragraph). This allows users to semantic-search down to the exact section or paragraph across millions of documents. [14, 15, 16, 17, 18]

------------------------------
