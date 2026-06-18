// Doc_Ohara: Two-Step Hybrid Retrieval Engine (README Section 7)
// Phase 0: local keyword extraction, Phase 1: shallow BM25-style scoring,
// Phase 2: deep graph traversal via ArangoDBSimulator.

const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'in', 'on', 'to', 'is', 'are', 'how',
  'it', 'connects', 'show', 'me', 'with', 'for', 'this', 'that', 'be', 'as'
]);

export class RetrievalEngine {
  constructor(dbSim) {
    this.dbSim = dbSim;
  }

  // Phase 0: Input Parsing & Expansion
  preprocessInput(rawInput) {
    const keywords = (rawInput.toLowerCase().match(/[a-z0-9]+/g) || [])
      .filter(w => !STOPWORDS.has(w) && w.length > 2);
    return { keywords, raw: rawInput };
  }

  // Term-overlap scoring stand-in for BM25 (no real ArangoSearch view in the simulator)
  scoreNode(node, keywords) {
    const haystack = `${node.title || ''} ${node.content || ''}`.toLowerCase();
    if (!haystack.trim()) return 0;
    let hits = 0;
    for (const kw of keywords) {
      if (haystack.includes(kw)) hits += 1;
    }
    return hits / Math.max(keywords.length, 1);
  }

  // Phase 1: Shallow Context (breadth search across sections & paragraphs)
  getShallowContext(processedQuery, options = {}) {
    const limit = options.limit || 10;
    const state = this.dbSim.getState();
    const candidates = [...state.sections, ...state.paragraphs];

    const scored = candidates
      .map(node => ({ node, score: this.scoreNode(node, processedQuery.keywords) }))
      .filter(entry => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return scored;
  }

  // Phase 2: Deep Context (depth traversal from a target node)
  getDeepContext(targetNodeId, edgeTypes = ['has_section', 'contains_paragraph', 'belongs_to'], options = {}) {
    const depth = options.depth || 1;
    const aql = `FOR v, e IN OUTBOUND "${targetNodeId}" ${edgeTypes.join(',')} LIMIT ${depth * 10} RETURN v`;
    const result = this.dbSim.executeAQL(aql);
    return result.results || [];
  }

  // Orchestrates Phase 0 -> Phase 1 -> Phase 2
  query(rawInput, options = {}) {
    const processedQuery = this.preprocessInput(rawInput);
    const shallowResults = this.getShallowContext(processedQuery, options);

    if (shallowResults.length === 0) {
      return { processedQuery, shallowResults: [], deepResults: [] };
    }

    const topNode = shallowResults[0].node;
    const deepResults = this.getDeepContext(topNode._id, undefined, { depth: options.depth || 2 });

    return { processedQuery, shallowResults, deepResults };
  }
}
