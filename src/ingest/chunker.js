import fs from 'fs';
import path from 'path';

// Simple markdown chunker: split by top-level headings (# and ##). Fallback to size-based splits.
export function chunkMarkdown(mdText, opts = {}) {
  const maxChars = opts.maxChars || 12000; // approx token budget
  const lines = mdText.split(/\r?\n/);

  const chunks = [];
  let current = { heading: null, headingLevel: null, text: '' };

  const pushCurrent = () => {
    if (current.text.trim()) {
      chunks.push({ heading: current.heading || null, headingLevel: current.headingLevel, text: current.text });
    }
    current = { heading: null, headingLevel: null, text: '' };
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const headingMatch = line.match(/^\s{0,3}(#{1,3})\s+(.*)/);
    if (headingMatch && current.text.length > 0 && current.text.length > maxChars / 4) {
      // start new chunk at heading if current chunk already has content
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

  // Ensure no empty chunks
  return chunks.map((c, idx) => ({ id: `chunk_${idx}`, heading: c.heading, headingLevel: c.headingLevel, text: c.text }));
}

export function readMarkdownFile(mdPath) {
  return fs.readFileSync(mdPath, 'utf-8');
}
