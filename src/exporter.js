import fs from 'fs';
import path from 'path';

/**
 * Doc Ohara: Quartz Exporter
 * 
 * Converts the Space-Time Graph (ArangoDB state) into a folder of interlinked 
 * Markdown files compatible with Quartz (digital garden).
 */
export class QuartzExporter {
  constructor(dbSimulator, outputDir = 'wiki') {
    this.db = dbSimulator;
    this.outputDir = outputDir;
  }

  /**
   * Run the export process
   */
  async export() {
    console.log(`[QuartzExporter] Starting export to "${this.outputDir}"...`);
    const state = await Promise.resolve(this.db.getState());

    // Clean and recreate output directory
    if (fs.existsSync(this.outputDir)) {
      fs.rmSync(this.outputDir, { recursive: true, force: true });
    }
    fs.mkdirSync(this.outputDir, { recursive: true });

    // 1. Create index.md (Home)
    this.generateHomePage(state);

    // 2. Process each document
    for (const doc of state.documents) {
      this.exportDocument(doc, state);
    }

    console.log(`[QuartzExporter] Export complete!`);
  }

  /**
   * Generate the main entry point
   */
  generateHomePage(state) {
    let content = `---\ntitle: "Doc Ohara Knowledge Base"\n---\n\n`;
    content += `# 🌌 Doc Ohara Space-Time Graph\n\n`;
    content += `Welcome to the automatically generated encyclopedia of your document knowledge base.\n\n`;
    content += `## 📁 Documents\n\n`;

    for (const doc of state.documents) {
      const docPath = `documents/${this.slugify(doc.title)}/index`;
      content += `- [[${docPath}|${doc.title}]]\n`;
    }

    fs.writeFileSync(path.join(this.outputDir, 'index.md'), content, 'utf-8');
  }

  /**
   * Export a single document and its hierarchy
   */
  exportDocument(doc, state) {
    const docSlug = this.slugify(doc.title);
    const docDir = path.join(this.outputDir, 'documents', docSlug);
    fs.mkdirSync(docDir, { recursive: true });

    // Document Landing Page
    let indexContent = `---\ntitle: "${doc.title}"\ntags: ["document"]\n---\n\n`;
    indexContent += `# ${doc.title}\n\n`;
    indexContent += `**Source File:** ${doc.source_file}\n`;
    indexContent += `**Parser Engine:** ${doc.parser_engine}\n\n`;
    indexContent += `## 📜 Table of Contents\n\n`;

    const docSections = state.sections.filter(s => s.document_id === doc._key || s.document_id === doc._id);
    
    // Sort sections by their appearance (assuming keys or titles provide some order, or just level)
    for (const sec of docSections) {
      const secSlug = this.slugify(sec.title);
      const indent = "  ".repeat((sec.level || 1) - 1);
      indexContent += `${indent}- [[documents/${docSlug}/${secSlug}|${sec.title}]]\n`;

      // Generate the section page
      this.generateSectionPage(sec, doc, docDir, state);
    }

    fs.writeFileSync(path.join(docDir, 'index.md'), indexContent, 'utf-8');
  }

  /**
   * Generate a page for a specific section
   */
  generateSectionPage(sec, doc, docDir, state) {
    const secSlug = this.slugify(sec.title);
    let content = `---\ntitle: "${sec.title}"\ntags: ["section"]\n---\n\n`;
    content += `[[documents/${this.slugify(doc.title)}/index|⬅️ Back to Document]]\n\n`;
    content += `# ${sec.title}\n\n`;

    // Find paragraphs for this section
    const sectionParagraphs = state.paragraphs.filter(p => p.section_id === sec._id || p.section_id === sec._key);
    
    for (const p of sectionParagraphs) {
      content += `${p.content}\n\n`;
    }

    // Find tables for this section
    const sectionTables = state.tables.filter(t => t.section_id === sec._id || t.section_id === sec._key);
    for (const t of sectionTables) {
      content += `### 📊 Table: ${t.title || 'Data View'}\n\n`;
      content += t.raw_html || `[Table content omitted]`;
      content += `\n\n`;
    }

    // Add Related Links (from edges)
    const relatedEdges = state.edges.filter(e => e._from === sec._id || e._to === sec._id);
    if (relatedEdges.length > 0) {
      content += `## 🔗 Related Connections\n\n`;
      for (const edge of relatedEdges) {
        const otherId = edge._from === sec._id ? edge._to : edge._from;
        const otherNode = this.findNodeById(otherId, state);
        if (otherNode && otherNode.title) {
          // This link logic is simplified; in a real app, we'd need more robust path mapping
          content += `- **${edge.type || 'Related'}**: [[${otherNode.title}]]\n`;
        }
      }
    }

    fs.writeFileSync(path.join(docDir, `${secSlug}.md`), content, 'utf-8');
  }

  /**
   * Utility to find a node by its ArangoDB _id
   */
  findNodeById(id, state) {
    if (id.startsWith('documents/')) return state.documents.find(n => n._id === id);
    if (id.startsWith('sections/')) return state.sections.find(n => n._id === id);
    if (id.startsWith('paragraphs/')) return state.paragraphs.find(n => n._id === id);
    return null;
  }

  /**
   * Simple slugify for filenames
   */
  slugify(text) {
    return text
      .toString()
      .toLowerCase()
      .trim()
      .replace(/\s+/g, '-')     // Replace spaces with -
      .replace(/[^\w-]+/g, '')  // Remove all non-word chars
      .replace(/--+/g, '-');    // Replace multiple - with single -
  }
}
