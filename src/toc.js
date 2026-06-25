/**
 * Doc Ohara: Pseudo-TOC Generation Logic (DocsRay Implementation)
 *
 * Implements Algorithm 1 from the DocsRay paper:
 * 1. Initial Segmentation (LLM Boundary Detection)
 * 2. Size-constrained Merging (Embedding Similarity)
 * 3. Title Generation (LLM Summarization)
 */

export class PseudoTOCGenerator {
	constructor(llmClient, embeddingClient, db) {
		this.llm = llmClient;
		this.embeddings = embeddingClient;
		this.db = db;
		this.chunkSize = 5; // Default: 5 pages per initial chunk
		this.minPages = 3;  // Minimum pages per section before merging
	}

	/**
	 * Main entry point for Pseudo-TOC generation.
	 * @param {Array<{text: string}>} pages - Array of page/chunk objects with a .text property
	 */
	async generate(pages) {
		console.log(`[PseudoTOC] Starting generation for ${pages.length} pages...`);

		const boundaries = await this.detectBoundaries(pages);
		let sections = await this.mergeSmallSections(pages, boundaries);

		for (const section of sections) {
			section.title = await this.generateTitle(section.content);
		}

		return sections;
	}

	/**
	 * Phase 1: Boundary Detection using LLM
	 */
	async detectBoundaries(pages) {
		const boundaries = [0];
		const pageChunks = this.splitIntoChunks(pages, this.chunkSize);

		for (let i = 0; i < pageChunks.length - 1; i++) {
			const chunkText = (chunk) => chunk.map(p => p.text ?? p).join('\n');
			const excerptA = chunkText(pageChunks[i]).slice(-500);
			const excerptB = chunkText(pageChunks[i + 1]).slice(0, 500);

			const isNewTopic = await this.llm.checkBoundary(excerptA, excerptB);
			if (isNewTopic) {
				boundaries.push((i + 1) * this.chunkSize);
			}
		}

		return boundaries;
	}

	/**
	 * Phase 2: Merge sections that are too small
	 */
	async mergeSmallSections(pages, boundaries) {
		let initialSections = this.createSectionsFromBoundaries(pages, boundaries);
		const mergedSections = [];

		for (let i = 0; i < initialSections.length; i++) {
			const current = initialSections[i];

			if (current.pages.length < this.minPages) {
				const prev = i > 0 ? initialSections[i - 1] : null;
				const next = i < initialSections.length - 1 ? initialSections[i + 1] : null;

				if (!prev && next) {
					this.merge(next, current, 'start');
				} else if (prev && !next) {
					this.merge(prev, current, 'end');
				} else if (prev && next) {
					const simPrev = await this.computeSimilarity(current.content, prev.content);
					const simNext = await this.computeSimilarity(current.content, next.content);
					if (simPrev > simNext) {
						this.merge(prev, current, 'end');
					} else {
						this.merge(next, current, 'start');
					}
				} else {
					mergedSections.push(current);
				}
			} else {
				mergedSections.push(current);
			}
		}

		return mergedSections.filter(s => s.pages.length > 0);
	}

	/**
	 * Phase 3: Generate titles for final sections
	 */
	async generateTitle(content) {
		const sample = content.slice(0, 2000);
		return this.llm.generateTitle(sample);
	}

	// ── Helper implementations ──────────────────────────────────────────────────

	splitIntoChunks(pages, size) {
		const result = [];
		for (let i = 0; i < pages.length; i += size) {
			result.push(pages.slice(i, i + size));
		}
		return result;
	}

	createSectionsFromBoundaries(pages, boundaries) {
		const sections = [];
		for (let i = 0; i < boundaries.length; i++) {
			const start = boundaries[i];
			const end = boundaries[i + 1] ?? pages.length;
			const pageSlice = pages.slice(start, end);
			sections.push({
				pages: pageSlice,
				content: pageSlice.map(p => p.text ?? p).join('\n'),
			});
		}
		return sections;
	}

	merge(target, source, position) {
		if (position === 'start') {
			target.pages.unshift(...source.pages);
			target.content = source.content + '\n' + target.content;
		} else {
			target.pages.push(...source.pages);
			target.content = target.content + '\n' + source.content;
		}
		source.pages = []; // mark as merged-away so filter removes it
	}

	async computeSimilarity(textA, textB) {
		if (!this.embeddings) return 0;
		const [vecA, vecB] = await Promise.all([this.embeddings.get(textA), this.embeddings.get(textB)]);
		return this.cosineSimilarity(vecA, vecB);
	}

	cosineSimilarity(v1, v2) {
		if (!v1?.length || !v2?.length) return 0;
		const dot = v1.reduce((s, x, i) => s + x * (v2[i] ?? 0), 0);
		const magA = Math.sqrt(v1.reduce((s, x) => s + x * x, 0));
		const magB = Math.sqrt(v2.reduce((s, x) => s + x * x, 0));
		return magA && magB ? dot / (magA * magB) : 0;
	}
}

/**
 * Adapts the Gemini `ai` client to the interface expected by PseudoTOCGenerator.
 * Handles caching of boundary and title LLM calls.
 */
export class GeminiTocLLMClient {
	constructor(ai, boundaryPrompt, titlePrompt, model, cache) {
		this.ai = ai;
		this.boundaryPrompt = boundaryPrompt;
		this.titlePrompt = titlePrompt;
		this.model = model;
		this.cache = cache; // { cacheKeyFor, writeCache, readCacheSync, credFp }
	}

	async checkBoundary(excerptA, excerptB) {
		const input = `[Segment A]\n${excerptA}\n\n[Segment B]\n${excerptB}`;
		const prompt = `${this.boundaryPrompt}\n\n${input}`;

		if (this.cache) {
			const key = this.cache.cacheKeyFor([prompt, this.model, this.cache.credFp ?? '']);
			const hit = this.cache.readCacheSync(key);
			if (hit?.result != null) return hit.result === 1;
		}

		const resp = await this.ai.models.generateContent({ model: this.model, contents: prompt, config: { serviceTier: 'flex' } });
		const digit = (resp.text ?? '').trim().charAt(0);
		const result = digit === '1' ? 1 : 0;

		if (this.cache) {
			const key = this.cache.cacheKeyFor([prompt, this.model, this.cache.credFp ?? '']);
			this.cache.writeCache(key, { result });
		}

		return result === 1;
	}

	async generateTitle(sample) {
		const prompt = `${this.titlePrompt}\n\n${sample}`;

		if (this.cache) {
			const key = this.cache.cacheKeyFor([prompt, this.model, this.cache.credFp ?? '']);
			const hit = this.cache.readCacheSync(key);
			if (hit?.title) return hit.title;
		}

		const resp = await this.ai.models.generateContent({ model: this.model, contents: prompt, config: { serviceTier: 'flex' } });
		const title = (resp.text ?? '').trim();

		if (this.cache) {
			const key = this.cache.cacheKeyFor([prompt, this.model, this.cache.credFp ?? '']);
			this.cache.writeCache(key, { title });
		}

		return title;
	}
}

/**
 * Adapts the Gemini `ai` client to provide text embeddings.
 */
export class GeminiEmbeddingClient {
	constructor(ai, model = 'gemini-embedding-2-preview') {
		this.ai = ai;
		this.model = model;
	}

	async get(text) {
		try {
			const res = await this.ai.models.embedContent({ model: this.model, contents: text });
			return res.embedding?.values ?? [];
		} catch {
			return [];
		}
	}
}
