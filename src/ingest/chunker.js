import fs from 'node:fs';
import path from 'node:path';

// Simple markdown chunker: split by top-level headings (# and ##). Fallback to size-based splits.
// Also counts LiteParse page-break markers (-----) to provide authoritative page numbers.
// For pure Markdown files with no page markers, virtual page numbers are derived from char offset.
export function chunkMarkdown(mdText, opts = {}) {
	const maxChars = opts.maxChars || 12000; // approx token budget
	const lines = mdText.split(/\r?\n/);

	const chunks = [];
	let currentPage = 1;
	let pageBreaksSeen = 0;
	let current = { heading: null, headingLevel: null, startPage: 1, text: '' };

	const pushCurrent = () => {
		if (current.text.trim()) {
			chunks.push({
				heading: current.heading || null,
				headingLevel: current.headingLevel,
				startPage: current.startPage,
				endPage: currentPage,
				text: current.text,
			});
		}
		current = { heading: null, headingLevel: null, startPage: currentPage, text: '' };
	};

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];

		// LiteParse page-break marker: five or more dashes on a line by itself
		if (/^-{5,}\s*$/.test(line)) {
			current.text += line + '\n';
			currentPage++;
			pageBreaksSeen++;
			continue;
		}

		const headingMatch = line.match(/^\s{0,3}(#{1,3})\s+(.*)/);
		if (headingMatch && current.text.length > 0 && current.text.length > maxChars / 4) {
			// start new chunk at heading if current chunk already has enough content
			pushCurrent();
		}

		if (headingMatch && (!current.heading || current.text.length === 0)) {
			current.heading = headingMatch[2].trim();
			current.headingLevel = headingMatch[1].length; // 1=#, 2=##, 3=###
			current.text += line + '\n';
		} else {
			current.text += line + '\n';
			if (current.text.length >= maxChars) {
				pushCurrent();
			}
		}
	}
	pushCurrent();

	// Tag all chunks with pageSource
	const pageSource = pageBreaksSeen > 0 ? 'physical' : 'virtual';

	const result = chunks.map((c, idx) => ({
		id: `chunk_${idx}`,
		heading: c.heading,
		headingLevel: c.headingLevel,
		startPage: c.startPage,
		endPage: c.endPage,
		pageSource,
		text: c.text,
	}));

	// For pure Markdown (no ----- markers), back-fill virtual page numbers from char offset.
	if (pageBreaksSeen === 0) {
		const VIRTUAL_PAGE_SIZE = parseInt(process.env.OHARA_VIRTUAL_PAGE_SIZE || '3000', 10);
		let charOffset = 0;
		result.forEach(c => {
			c.startPage = Math.floor(charOffset / VIRTUAL_PAGE_SIZE) + 1;
			charOffset += c.text.length;
			c.endPage = Math.floor(charOffset / VIRTUAL_PAGE_SIZE) + 1;
		});
	}

	// Merge chunks that are too short into their neighbours.
	// A standalone heading or a 2-sentence section doesn't justify a full LLM call.
	const minChars = opts.minChunkChars ?? 500;
	const merged = [];
	for (const chunk of result) {
		const prev = merged[merged.length - 1];
		if (prev && chunk.text.length < minChars && prev.text.length + chunk.text.length <= maxChars) {
			// short chunk - absorb into previous sibling
			prev.text += '\n' + chunk.text;
			prev.endPage = chunk.endPage;
		} else {
			merged.push(chunk);
		}
	}

	// Forward pass leaves a tiny first chunk unmerged (no previous sibling).
	// Fix: push it into the second chunk if combined size fits.
	if (merged.length >= 2 && merged[0].text.length < minChars &&
		merged[0].text.length + merged[1].text.length <= maxChars) {
		merged[1].text = merged[0].text + '\n' + merged[1].text;
		merged[1].startPage = merged[0].startPage;
		merged[1].heading = merged[1].heading || merged[0].heading;
		merged[1].headingLevel = merged[1].headingLevel ?? merged[0].headingLevel;
		merged.shift();
	}

	// Re-index ids after merge
	merged.forEach((c, i) => { c.id = `chunk_${i}`; });

	return merged;
}

export function readMarkdownFile(mdPath) {
	return fs.readFileSync(mdPath, 'utf-8');
}
