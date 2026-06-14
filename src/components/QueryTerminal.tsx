import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Database, 
  Terminal, 
  Play, 
  Info, 
  RefreshCw, 
  Table as TableIcon, 
  AlignLeft, 
  Hash, 
  FileText, 
  HelpCircle, 
  Search,
  ChevronRight,
  Code2,
  Braces
} from 'lucide-react';
import { 
  ArangoDocument, 
  ArangoSection, 
  ArangoParagraph, 
  ArangoTable, 
  ArangoEdge 
} from '../document_samples.js';

interface QueryTerminalProps {
  state: {
    documents: ArangoDocument[];
    sections: ArangoSection[];
    paragraphs: ArangoParagraph[];
    tables: ArangoTable[];
    edges: ArangoEdge[];
  };
  onExecuteQuery: (query: string, bindVars?: Record<string, any>) => Promise<any>;
}

const TEMPLATE_QUERIES = [
  {
    name: "📁 Fetch All Documents",
    query: "FOR doc IN documents\n  SORT doc.title\n  RETURN doc",
    desc: "Returns a high-level catalog profile list of all parsed documents."
  },
  {
    name: "🧬 Extract LaTeX Formulas (MinerU)",
    query: "FOR p IN paragraphs\n  FILTER p.is_latex == true\n  RETURN {\n    id: p._id,\n    document: p.document_id,\n    latex_formula: p.content\n  }",
    desc: "Queries the paragraphs collection, isolating blocks flagged as LaTeX mathematics equations."
  },
  {
    name: "📑 Fetch Specific Sections (Sorted)",
    query: "FOR sec IN sections\n  FILTER sec.document_id == \"quantum_paper_001\"\n  SORT sec.level ASC\n  RETURN sec",
    desc: "Returns heading structures filtered by document and ordered sequentially of heading hierarchy."
  },
  {
    name: "📊 Fetch Parsed Tables in System",
    query: "FOR t IN tables\n  RETURN {\n    document: t.document_id,\n    table_id: t._id,\n    row_count: LENGTH(t.matrix_data),\n    raw_markdown: t.markdown_representation\n  }",
    desc: "Aggregates table coordinates, size, and parsed Markdown tables representations."
  },
  {
    name: "🕸️ Graph Traversal: Outbound from Doc root",
    query: "FOR v, e IN OUTBOUND \"documents/quantum_paper_001\" has_section\n  RETURN v",
    desc: "AQL multi-model graph traversal. Fetches all section heading vertices linked outbound from the document parent."
  },
  {
    name: "🕸️ Graph Traversal: Section leaf paragraphs",
    query: "FOR v, e IN OUTBOUND \"sections/quantum_sec_4\" contains_paragraph\n  RETURN v",
    desc: "Graph traversal tracing sections outbounds to resolve attached text components."
  }
];

export default function QueryTerminal({ state, onExecuteQuery }: QueryTerminalProps) {
  const [activeTab, setActiveTab] = useState<'playground' | 'explorer'>('playground');
  const [aqlQuery, setAqlQuery] = useState<string>(TEMPLATE_QUERIES[0].query);
  const [queryResults, setQueryResults] = useState<any[] | null>(null);
  const [queryStats, setQueryStats] = useState<{ executionTimeMs: number; fullCount: number } | null>(null);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [isExecuting, setIsExecuting] = useState<boolean>(false);

  // Explorer collection selector
  const [selectedCollection, setSelectedCollection] = useState<'documents' | 'sections' | 'paragraphs' | 'tables' | 'edges'>('documents');
  const [searchText, setSearchText] = useState<string>('');

  // Handle preset selector
  const handleSelectTemplate = (queryText: string) => {
    setAqlQuery(queryText);
    setQueryError(null);
  };

  // Run AQL query
  const handleRunQuery = async () => {
    setIsExecuting(true);
    setQueryError(null);
    try {
      const res = await onExecuteQuery(aqlQuery);
      if (res.success) {
        setQueryResults(res.results);
        setQueryStats(res.stats);
      } else {
        setQueryResults(null);
        setQueryStats(null);
        setQueryError(res.error || "Query failed execution.");
      }
    } catch (err: any) {
      setQueryResults(null);
      setQueryStats(null);
      setQueryError(err.message || "Network compilation error.");
    } finally {
      setIsExecuting(false);
    }
  };

  useEffect(() => {
    // Run initial query on mount
    handleRunQuery();
  }, []);

  // Filter explorer rows based on collection and search
  const explorerRows = useMemo(() => {
    const list = state[selectedCollection] || [];
    if (!searchText) return list;
    
    const searchLower = searchText.toLowerCase();
    return list.filter((item: any) => {
      return Object.values(item).some(val => 
        String(val).toLowerCase().includes(searchLower)
      );
    });
  }, [state, selectedCollection, searchText]);

  return (
    <div className="flex flex-col h-full rounded-xl border border-zinc-200 bg-white overflow-hidden shadow-2xs">
      {/* Tab controls */}
      <div className="flex items-center justify-between px-4 bg-zinc-50 border-b border-zinc-200 h-12 shrink-0">
        <div className="flex gap-2">
          <button
            onClick={() => setActiveTab('playground')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold tracking-wide transition ${
              activeTab === 'playground'
                ? 'bg-zinc-900 text-white shadow-sm'
                : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900'
            }`}
          >
            <Terminal size={14} />
            AQL Query Playground
          </button>
          <button
            onClick={() => setActiveTab('explorer')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold tracking-wide transition ${
              activeTab === 'explorer'
                ? 'bg-zinc-900 text-white shadow-sm'
                : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900'
            }`}
          >
            <Database size={14} />
            ArangoDB Collection Explorer
          </button>
        </div>

        <div className="text-2xs text-zinc-400 font-mono hidden md:flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
          <span>Arango SIM v2.6 Online</span>
        </div>
      </div>

      <div className="flex-1 overflow-hidden min-h-[360px]">
        {activeTab === 'playground' ? (
          <div className="flex flex-col md:flex-row h-full divide-y md:divide-y-0 md:divide-x divide-zinc-200">
            {/* Editor Workspace Panel */}
            <div className="flex-1 flex flex-col p-4 bg-zinc-50 space-y-3 justify-between min-h-[220px]">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-3xs font-extrabold text-zinc-400 uppercase tracking-widest block">
                    Write or select an ArangoDB Query
                  </span>
                  <div className="relative">
                    <select
                      onChange={(e) => handleSelectTemplate(e.target.value)}
                      className="rounded-lg border border-zinc-250 bg-white px-2 py-1 text-3xs font-semibold text-zinc-600 shadow-sm focus:outline-none"
                    >
                      <option value="">⚙️ Choose Statement Template...</option>
                      {TEMPLATE_QUERIES.map((t, idx) => (
                        <option key={idx} value={t.query}>{t.name}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="rounded-lg border border-zinc-250 bg-white shadow-3xs overflow-hidden focus-within:ring-1 focus-within:ring-zinc-400">
                  <div className="flex items-center justify-between bg-zinc-50 px-3 py-1 text-3xs font-mono text-zinc-400 border-b border-zinc-100">
                    <span>AQL STATEMENT EDITOR</span>
                    <span className="text-zinc-300">UTF-8</span>
                  </div>
                  <textarea
                    value={aqlQuery}
                    onChange={(e) => setAqlQuery(e.target.value)}
                    rows={8}
                    className="w-full font-mono text-xs text-zinc-800 bg-white p-3 focus:outline-none resize-none leading-relaxed"
                    placeholder="FOR doc IN documents RETURN doc"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-zinc-200">
                <div className="text-3xs text-zinc-500 max-w-[260px] leading-relaxed hidden sm:block">
                  <span className="font-semibold">DBMS Tip:</span> Write native traversals using `FOR v, e IN OUTBOUND "doc_id" edge_type` vectors and click <span className="font-semibold text-indigo-600">Execute</span>.
                </div>
                <button
                  onClick={handleRunQuery}
                  disabled={isExecuting}
                  className="flex items-center gap-1.5 bg-zinc-900 hover:bg-indigo-600 text-white font-semibold text-xs px-4 py-2 rounded-lg shadow-md transition disabled:bg-zinc-300"
                >
                  {isExecuting ? <RefreshCw size={14} className="animate-spin" /> : <Play size={14} fill="currentColor" />}
                  Execute AQL Query
                </button>
              </div>
            </div>

            {/* Results Console Output */}
            <div className="flex-1 flex flex-col bg-white min-h-[220px]">
              <div className="flex items-center justify-between border-b border-zinc-150 bg-zinc-50 px-4 py-2 h-9 shrink-0">
                <span className="text-3xs font-extrabold text-zinc-500 uppercase tracking-widest flex items-center gap-1">
                  <Code2 size={12} className="text-zinc-600" />
                  Execution Result Output
                </span>
                {queryStats && (
                  <span className="text-4xs font-mono text-zinc-400">
                    Time: {queryStats.executionTimeMs}ms | Scanned: {queryStats.fullCount} items
                  </span>
                )}
              </div>

              <div className="flex-1 p-4 overflow-y-auto font-mono text-xs relative bg-zinc-900 text-zinc-350 min-h-[140px] select-all">
                {queryError ? (
                  <div className="rounded-lg p-3.5 bg-red-950/40 text-red-400 border border-red-900/40 text-xs">
                    <div className="font-bold flex items-center gap-1.5 text-red-300 mb-1">
                      ⚠️ AQL Compilation Error
                    </div>
                    <p className="leading-relaxed font-mono">{queryError}</p>
                    <div className="mt-2 text-2xs text-red-500/80 leading-snug font-sans">
                      Verify collection key syntax or property mappings. Multi-model collections are documents are case-sensitive.
                    </div>
                  </div>
                ) : queryResults !== null ? (
                  queryResults.length === 0 ? (
                    <div className="text-zinc-500 py-12 text-center text-xs">
                      [ ] // Query executed successfully, returning empty array.
                    </div>
                  ) : (
                    <pre className="text-2xs text-emerald-300 leading-normal overflow-x-auto whitespace-pre">
                      {JSON.stringify(queryResults, null, 2)}
                    </pre>
                  )
                ) : (
                  <div className="text-zinc-500 py-12 text-center text-xs select-none">
                    Write AQL above and trigger compile to review output streams.
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          /* Collection Explorer Grid Viewport */
          <div className="flex flex-col h-full p-4 bg-zinc-50 space-y-3">
            <div className="flex flex-col sm:flex-row gap-3 justify-between items-start sm:items-center">
              {/* Collection selector */}
              <div className="flex flex-wrap gap-1">
                {(['documents', 'sections', 'paragraphs', 'tables', 'edges'] as const).map((coll) => (
                  <button
                    key={coll}
                    onClick={() => {
                      setSelectedCollection(coll);
                      setSearchText('');
                    }}
                    className={`px-3 py-1 rounded-lg text-xs font-semibold capitalize border tracking-wide transition ${
                      selectedCollection === coll
                        ? 'bg-zinc-900 border-zinc-900 text-white'
                        : 'bg-white border-zinc-200 text-zinc-600 hover:bg-zinc-100'
                    }`}
                  >
                    {coll}
                  </button>
                ))}
              </div>

              {/* Text filter searches */}
              <div className="relative w-full sm:w-64">
                <span className="absolute left-2.5 top-2 text-zinc-400">
                  <Search size={14} />
                </span>
                <input
                  type="text"
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  placeholder={`Search ${selectedCollection}...`}
                  className="w-full h-8 rounded-lg border border-zinc-250 bg-white pl-8 pr-3 text-xs text-zinc-700 shadow-3xs focus:outline-none focus:ring-1 focus:ring-zinc-400"
                />
              </div>
            </div>

            {/* Grid Table Workspace */}
            <div className="flex-1 border border-zinc-200 rounded-lg overflow-hidden bg-white shadow-3xs overflow-x-auto min-h-[180px]">
              {explorerRows.length === 0 ? (
                <div className="py-12 text-center text-zinc-400 text-xs">
                  No records stored or match search filter in collection "{selectedCollection}".
                </div>
              ) : (
                <table className="w-full text-left text-xs text-zinc-650 border-collapse">
                  <thead>
                    <tr className="bg-zinc-50 border-b text-zinc-500 font-semibold h-9">
                      <th className="p-2 px-3 font-mono border-r">_id (System)</th>
                      {selectedCollection === 'documents' && (
                        <>
                          <th className="p-2 px-3">Title</th>
                          <th className="p-2 px-3">File Name</th>
                          <th className="p-2 px-3">Engine</th>
                          <th className="p-2 px-3">Size</th>
                        </>
                      )}
                      {selectedCollection === 'sections' && (
                        <>
                          <th className="p-2 px-3">Level</th>
                          <th className="p-2 px-3">Heading Title</th>
                          <th className="p-2 px-3">Doc Reference</th>
                        </>
                      )}
                      {selectedCollection === 'paragraphs' && (
                        <>
                          <th className="p-2 px-3">Markup</th>
                          <th className="p-2 px-3">Segment Body Content</th>
                          <th className="p-2 px-3">Section Parent</th>
                        </>
                      )}
                      {selectedCollection === 'tables' && (
                        <>
                          <th className="p-2 px-3">Grid Size</th>
                          <th className="p-2 px-3">Formatted Markdown Markup</th>
                          <th className="p-2 px-3">Doc Reference</th>
                        </>
                      )}
                      {selectedCollection === 'edges' && (
                        <>
                          <th className="p-2 px-3">Connection Type</th>
                          <th className="p-2 px-3">_from Source Vertex</th>
                          <th className="p-2 px-3">_to Target Vertex</th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {explorerRows.map((row: any, rIdx) => (
                      <tr key={row._id || rIdx} className="border-b h-9 hover:bg-zinc-50">
                        <td className="p-2 px-3 font-mono text-zinc-400 bg-zinc-50/50 border-r text-3xs select-all">
                          {row._id}
                        </td>

                        {selectedCollection === 'documents' && (
                          <>
                            <td className="p-2 px-3 font-semibold text-zinc-800 break-words">{row.title}</td>
                            <td className="p-2 px-3 text-zinc-600 break-all">{row.source_file}</td>
                            <td className="p-2 px-3">
                              <span className={`px-1.5 py-0.5 rounded text-3xs font-semibold ${
                                row.parser_engine === 'MinerU' ? 'bg-indigo-100 text-indigo-700' : 'bg-emerald-100 text-emerald-700'
                              }`}>{row.parser_engine}</span>
                            </td>
                            <td className="p-2 px-3 text-zinc-500 font-mono text-3xs">{row.file_size}</td>
                          </>
                        )}

                        {selectedCollection === 'sections' && (
                          <>
                            <td className="p-2 px-3 font-semibold text-zinc-500 font-mono text-3xs">h{row.level}</td>
                            <td className="p-2 px-3 text-zinc-800 font-semibold break-words">{row.title}</td>
                            <td className="p-2 px-3 font-mono text-3xs text-zinc-400 select-all">{row.document_id}</td>
                          </>
                        )}

                        {selectedCollection === 'paragraphs' && (
                          <>
                            <td className="p-2 px-3">
                              <span className={`px-1 rounded text-3xs font-semibold ${
                                row.is_latex ? 'bg-amber-100 text-amber-700 border border-amber-200' : 'bg-zinc-100 text-zinc-600'
                              }`}>{row.is_latex ? 'LaTeX' : 'Para'}</span>
                            </td>
                            <td className="p-2 px-3 text-zinc-700 max-w-sm truncate" title={row.content}>{row.content}</td>
                            <td className="p-2 px-3 font-mono text-3xs text-zinc-400 select-all">{row.section_id || 'Root'}</td>
                          </>
                        )}

                        {selectedCollection === 'tables' && (
                          <>
                            <td className="p-2 px-3 text-zinc-600 font-mono text-3xs">
                              {row.matrix_data?.length || 0} x {row.matrix_data?.[0]?.length || 0}
                            </td>
                            <td className="p-2 px-3 max-w-xs text-zinc-400 font-mono text-3xs truncate select-all">{row.markdown_representation}</td>
                            <td className="p-2 px-3 font-mono text-3xs text-zinc-400 select-all">{row.document_id}</td>
                          </>
                        )}

                        {selectedCollection === 'edges' && (
                          <>
                            <td className="p-2 px-3 text-zinc-700">
                              <span className="p-1 px-1.5 rounded-md text-3xs bg-slate-150 border uppercase font-bold tracking-wider">
                                {row.type}
                              </span>
                            </td>
                            <td className="p-2 px-3 font-mono text-3xs text-zinc-700 select-all">{row._from}</td>
                            <td className="p-2 px-3 font-mono text-3xs text-zinc-700 select-all">{row._to}</td>
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
