import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

const RAW_DIR = './raw_output';
const TARGET_DIR = './collections';

// Initialize global collection arrays
const dbCollections = {
    documents: [],
    sections: [],
    paragraphs: [],
    tables: []
};

// Process Docling engine JSON output
function parseDocling(rawData, docId, filename) {
    dbCollections.documents.push({
        id: docId,
        source_file: filename,
        parser_engine: "Docling",
        title: rawData.document?.name || filename
    });

    let currentSectionId = null;

    rawData.document?.texts?.forEach((item) => {
        const nodeId = uuidv4();
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

    rawData.document?.tables?.forEach((table) => {
        dbCollections.tables.push({
            id: uuidv4(),
            document_id: docId,
            section_id: currentSectionId,
            matrix_data: table.data || [],
            markdown_representation: table.markdown || ""
        });
    });
}

// Process MinerU engine JSON output
function parseMinerU(rawData, docId, filename) {
    dbCollections.documents.push({
        id: docId,
        source_file: filename,
        parser_engine: "MinerU",
        title: filename
    });

    let currentSectionId = null;

    rawData.pdf_body?.forEach((block) => {
        const nodeId = uuidv4();
        if (block.type === "title" || block.type === "heading") {
            currentSectionId = nodeId;
            dbCollections.sections.push({
                id: nodeId,
                document_id: docId,
                title: block.text || "",
                level: block.type === "title" ? 1 : 2
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
                id: uuidv4(),
                document_id: docId,
                section_id: currentSectionId,
                matrix_data: block.table_cells || [],
                markdown_representation: block.markdown || ""
            });
        }
    });
}

// Main execution scanner loop
function executeTransformationPipeline() {
    if (!fs.existsSync(RAW_DIR)) {
        console.log(`⚠️ Raw directory ${RAW_DIR} does not exist yet. Please run run_pipeline.sh first.`);
        return;
    }
    
    if (!fs.existsSync(TARGET_DIR)) {
         fs.mkdirSync(TARGET_DIR, { recursive: true });
    }

    const targets = fs.readdirSync(RAW_DIR);

    targets.forEach((targetName) => {
        const fullPath = path.join(RAW_DIR, targetName);
        if (!fs.statSync(fullPath).isDirectory()) return;

        // Locate internal engine results files
        const files = fs.readdirSync(fullPath);
        const docId = uuidv4();

        files.forEach((file) => {
            if (!file.endsWith('.json')) return;
            
            const rawContent = JSON.parse(fs.readFileSync(path.join(fullPath, file), 'utf-8'));
            
            // Differentiate parsers based on structural fingerprint attributes
            if (rawContent.pdf_body) {
                parseMinerU(rawContent, docId, targetName);
            } else {
                parseDocling(rawContent, docId, targetName);
            }
        });
    });

    // Save final standardized arrays to discrete collection files
    Object.keys(dbCollections).forEach((key) => {
        fs.writeFileSync(
            path.join(TARGET_DIR, `${key}.json`), 
            JSON.stringify(dbCollections[key], null, 2)
        );
        console.log(`📦 Generated database collection: ${key}.json (${dbCollections[key].length} rows)`);
    });
}

executeTransformationPipeline();
