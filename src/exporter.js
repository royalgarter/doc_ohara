import fs from 'node:fs';
import path from 'node:path';

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

		// 3. Export entity pages (if entities exist in state)
		if (state.entities && state.entities.length > 0) {
			this.exportEntities(state);
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

		if (state.entities && state.entities.length > 0) {
			content += `\n## 🏷️ Entities\n\n`;
			content += `[[entities/index|Browse all ${state.entities.length} entities →]]\n`;
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
	 * Export all entity pages into entities/ subfolder.
	 * Each entity gets a Quartz-compatible markdown file with:
	 * - YAML frontmatter (title, tags, aliases)
	 * - LLM-generated description (if available)
	 * - Backlinks: every paragraph that mentions this entity
	 */
	exportEntities(state) {
		const entitiesDir = path.join(this.outputDir, 'entities');
		fs.mkdirSync(entitiesDir, { recursive: true });

		// Build a lookup: entity _id → paragraphs that mention it
		const mentionEdges = (state.edges || []).filter(e => e.relation === 'MENTIONS');
		const entityMentions = new Map(); // entity _id → [paragraph]
		for (const edge of mentionEdges) {
			const para = state.paragraphs.find(p => p._id === edge._from);
			if (!para) continue;
			const list = entityMentions.get(edge._to) || [];
			list.push({ para, context: edge.context || '' });
			entityMentions.set(edge._to, list);
		}

		// Build entity index page
		let indexContent = `---\ntitle: "Entities"\ntags: ["entities"]\n---\n\n# Entities\n\n`;
		const byType = {};
		for (const entity of state.entities) {
			(byType[entity.type] = byType[entity.type] || []).push(entity);
		}
		for (const [type, list] of Object.entries(byType).sort()) {
			indexContent += `## ${type}\n\n`;
			for (const e of list.sort((a, b) => a.name.localeCompare(b.name))) {
				indexContent += `- [[entities/${e.slug}|${e.name}]]\n`;
			}
			indexContent += '\n';
		}
		fs.writeFileSync(path.join(entitiesDir, 'index.md'), indexContent, 'utf-8');

		// One page per entity
		for (const entity of state.entities) {
			const aliases = (entity.aliases || []).filter(a => a !== entity.name);
			const frontmatter = [
				'---',
				`title: "${entity.name}"`,
				`tags: [entity, ${entity.type}]`,
				aliases.length > 0 ? `aliases: [${aliases.map(a => `"${a}"`).join(', ')}]` : null,
				'---',
			].filter(Boolean).join('\n');

			let content = `${frontmatter}\n\n`;
			content += `# ${entity.name}\n\n`;

			if (entity.description) {
				content += `${entity.description}\n\n`;
			}

			const mentions = entityMentions.get(entity._id) || [];
			if (mentions.length > 0) {
				content += `## Mentioned in\n\n`;
				for (const { para, context } of mentions) {
					const doc = state.documents.find(d => d._key === para.document_id || d._id === `documents/${para.document_id}`);
					const sec = state.sections.find(s => s._id === para.section_id || s._key === para.section_id?.replace('sections/', ''));
					const docTitle = doc?.title || 'Unknown Document';
					const secTitle = sec?.title || '';
					const snippet = (context || para.content || '').slice(0, 150).replace(/\n/g, ' ');
					const docSlug = doc ? `documents/${this.slugify(docTitle)}` : '';
					const secSlug = sec ? `/${this.slugify(secTitle)}` : '';
					content += `- [[${docSlug}${secSlug}|${docTitle}${secTitle ? ' › ' + secTitle : ''}]] - "${snippet}…"\n`;
				}
			}

			// Related entities (RELATED_TO edges)
			const relatedEdges = (state.edges || []).filter(
				e => e.relation === 'RELATED_TO' && (e._from === entity._id || e._to === entity._id)
			);
			if (relatedEdges.length > 0) {
				const relatedIds = relatedEdges.map(e => e._from === entity._id ? e._to : e._from);
				const uniqueIds = [...new Set(relatedIds)];
				const related = uniqueIds.map(id => state.entities.find(e => e._id === id)).filter(Boolean);
				if (related.length > 0) {
					content += `\n## Related Entities\n\n`;
					for (const r of related) {
						content += `- [[entities/${r.slug}|${r.name}]]\n`;
					}
				}
			}

			fs.writeFileSync(path.join(entitiesDir, `${entity.slug}.md`), content, 'utf-8');
		}

		console.log(`[QuartzExporter] Exported ${state.entities.length} entity pages.`);
	}

	/**
	 * Utility to find a node by its ArangoDB _id
	 */
	findNodeById(id, state) {
		if (id.startsWith('documents/')) return state.documents.find(n => n._id === id);
		if (id.startsWith('sections/')) return state.sections.find(n => n._id === id);
		if (id.startsWith('paragraphs/')) return state.paragraphs.find(n => n._id === id);
		if (id.startsWith('entities/')) return (state.entities || []).find(n => n._id === id);
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
