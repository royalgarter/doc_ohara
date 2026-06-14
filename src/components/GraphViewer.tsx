import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Network, 
  FileText, 
  Layers, 
  Hash, 
  Table as TableIcon, 
  AlignLeft, 
  Info,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  RefreshCw,
  Eye
} from 'lucide-react';
import { 
  ArangoDocument, 
  ArangoSection, 
  ArangoParagraph, 
  ArangoTable, 
  ArangoEdge 
} from '../document_samples.js';

interface GraphViewerProps {
  state: {
    documents: ArangoDocument[];
    sections: ArangoSection[];
    paragraphs: ArangoParagraph[];
    tables: ArangoTable[];
    edges: ArangoEdge[];
  };
  onSelectNodeInPlayground?: (id: string) => void;
}

export default function GraphViewer({ state }: GraphViewerProps) {
  const { documents, sections, paragraphs, tables, edges } = state;
  const [selectedDocId, setSelectedDocId] = useState<string>('all');
  const [selectedNode, setSelectedNode] = useState<{ id: string; type: string; data: any } | null>(null);
  const [zoomLevel, setZoomLevel] = useState<number>(0.95);

  // Filter vertices and edges based on selected document context
  const graphData = useMemo(() => {
    let filteredDocs = documents;
    if (selectedDocId !== 'all') {
      filteredDocs = documents.filter(d => d._id === selectedDocId);
    }

    const docIds = new Set(filteredDocs.map(d => d._id));
    const filteredSections = sections.filter(s => docIds.has(`documents/${s.document_id}`));
    const secIds = new Set(filteredSections.map(s => s._id));

    const filteredParagraphs = paragraphs.filter(p => docIds.has(`documents/${p.document_id}`));
    const filteredTables = tables.filter(t => docIds.has(`documents/${t.document_id}`));

    // Nodes definition
    const nodesList: Array<{ id: string; label: string; type: 'document' | 'section' | 'paragraph' | 'table'; docId: string; parentId?: string; originalData: any }> = [];

    filteredDocs.forEach(d => {
      nodesList.push({
        id: d._id,
        label: d.title,
        type: 'document',
        docId: d._id,
        originalData: d
      });
    });

    filteredSections.forEach(s => {
      nodesList.push({
        id: s._id,
        label: s.title,
        type: 'section',
        docId: `documents/${s.document_id}`,
        originalData: s
      });
    });

    // To prevent graph cluttering, show up to 10 paragraphs and tables visually
    // while others are readable in detail tabs
    filteredParagraphs.slice(0, 15).forEach(p => {
      nodesList.push({
        id: p._id,
        label: p.content.slice(0, 50) + (p.content.length > 50 ? '...' : ''),
        type: 'paragraph',
        docId: `documents/${p.document_id}`,
        parentId: p.section_id || undefined,
        originalData: p
      });
    });

    filteredTables.slice(0, 5).forEach(t => {
      nodesList.push({
        id: t._id,
        label: `Table (${t.matrix_data.length}x${t.matrix_data[0]?.length || 0})`,
        type: 'table',
        docId: `documents/${t.document_id}`,
        parentId: t.section_id || undefined,
        originalData: t
      });
    });

    // Filter edges linking actual visible nodes
    const visibleNodeIds = new Set(nodesList.map(n => n.id));
    const filteredEdges = edges.filter(e => visibleNodeIds.has(e._from) && visibleNodeIds.has(e._to));

    // Simple deterministic layout generation (bento radial / tree spacing)
    // To arrange nodes cleanly in SVG viewport spaces
    const positionedNodes = nodesList.map((node, index) => {
      let x = 400;
      let y = 300;

      if (node.type === 'document') {
        // Document Root nodes placed at the left center
        const docCount = filteredDocs.length;
        const offsetIdx = filteredDocs.findIndex(d => d._id === node.id);
        x = docCount > 1 ? 120 : 150;
        y = docCount > 1 ? 150 + offsetIdx * 240 : 250;
      } else if (node.type === 'section') {
        // Section branches placed in middle columns
        const siblings = filteredSections.filter(s => `documents/${s.document_id}` === node.docId);
        const idx = siblings.findIndex(s => s._id === node.id);
        const count = siblings.length || 1;
        
        x = 380;
        y = 80 + (idx / count) * 440;
      } else if (node.type === 'paragraph' || node.type === 'table') {
        // Paragraph/Table leaf nodes placed on right
        let siblings: any[] = [];
        let idx = 0;

        if (node.parentId) {
          siblings = [
            ...filteredParagraphs.filter(p => p.section_id === node.parentId),
            ...filteredTables.filter(t => t.section_id === node.parentId)
          ];
          idx = siblings.findIndex(s => s._id === node.id);
          // Position relative to parent section
          const parentNode = nodesList.find(n => n.id === node.parentId);
          const py = parentNode ? filteredSections.findIndex(s => s._id === node.parentId) : 0;
          
          x = 680;
          y = 60 + (py * 120) + (idx * 45);
        } else {
          siblings = [
            ...filteredParagraphs.filter(p => !p.section_id && `documents/${p.document_id}` === node.docId),
            ...filteredTables.filter(t => !t.section_id && `documents/${t.document_id}` === node.docId)
          ];
          idx = siblings.findIndex(s => s._id === node.id);
          x = 650;
          y = 350 + idx * 50;
        }
      }

      return {
        ...node,
        x,
        y
      };
    });

    return {
      nodes: positionedNodes,
      edges: filteredEdges,
      nodeCount: nodesList.length,
      edgeCount: filteredEdges.length
    };
  }, [documents, sections, paragraphs, tables, edges, selectedDocId]);

  return (
    <div className="flex flex-col lg:flex-row h-full rounded-xl border border-zinc-200 bg-white overflow-hidden" id="graph-stage">
      {/* Sidebar for filter & properties panel */}
      <div className="lg:w-80 w-full bg-zinc-50 border-r border-zinc-200 flex flex-col">
        {/* Filter panel */}
        <div className="p-4 border-b border-zinc-200">
          <label className="text-xs font-semibold text-zinc-500 uppercase tracking-widest block mb-2">
            Select Graph View Context
          </label>
          <div className="relative">
            <select
              value={selectedDocId}
              onChange={(e) => {
                setSelectedDocId(e.target.value);
                setSelectedNode(null);
              }}
              className="w-full h-9 rounded-lg border border-zinc-250 bg-white px-3 pr-8 text-xs font-medium text-zinc-700 shadow-sm focus:outline-none focus:ring-1 focus:ring-zinc-400"
            >
              <option value="all">🌐 Full Network Map (All Documents)</option>
              {documents.map(doc => (
                <option key={doc._id} value={doc._id}>
                  📄 {doc.parser_engine === 'MinerU' ? '🧬' : '👔'} {doc.title.slice(0, 28)}{doc.title.length > 28 ? '...' : ''}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center justify-between text-2xs text-zinc-400 mt-2 font-mono">
            <span>Graph Nodes: {graphData.nodeCount}</span>
            <span>Edges Count: {graphData.edgeCount}</span>
          </div>
        </div>

        {/* Selected element properties panel */}
        <div className="flex-1 overflow-y-auto p-4 flex flex-col justify-between">
          <div className="space-y-4 flex-1">
            <h4 className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <Info size={14} className="text-zinc-600" />
              ArangoDB Document inspector
            </h4>

            <AnimatePresence mode="wait">
              {selectedNode ? (
                <motion.div
                  key={selectedNode.id}
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -5 }}
                  className="space-y-4"
                >
                  <div className="rounded-lg border border-zinc-200 bg-white p-3.5 shadow-sm space-y-3">
                    <div className="flex items-start gap-2.5">
                      <span className={`p-1.5 rounded-lg shrink-0 mt-0.5 ${
                        selectedNode.type === 'document' ? 'bg-indigo-50 text-indigo-600 border border-indigo-100' :
                        selectedNode.type === 'section' ? 'bg-cyan-50 text-cyan-600 border border-cyan-100' :
                        selectedNode.type === 'paragraph' ? 'bg-amber-50 text-amber-600 border border-amber-100' :
                        'bg-pink-50 text-pink-600 border border-pink-100'
                      }`}>
                        {selectedNode.type === 'document' && <FileText size={16} />}
                        {selectedNode.type === 'section' && <Hash size={16} />}
                        {selectedNode.type === 'paragraph' && <AlignLeft size={16} />}
                        {selectedNode.type === 'table' && <TableIcon size={16} />}
                      </span>
                      <div className="min-w-0">
                        <div className="text-3xs font-extrabold uppercase tracking-wider text-zinc-400 mb-0.5">
                          {selectedNode.type} collection
                        </div>
                        <h5 className="text-xs font-semibold text-zinc-800 break-words leading-tight">
                          {selectedNode.type === 'document' && selectedNode.data.title}
                          {selectedNode.type === 'section' && selectedNode.data.title}
                          {selectedNode.type === 'paragraph' && 'Raw Segment Node'}
                          {selectedNode.type === 'table' && 'Structural Table Matrix'}
                        </h5>
                      </div>
                    </div>

                    <div className="h-px bg-zinc-100" />

                    {/* Meta Fields Grid */}
                    <div className="space-y-2 text-2xs font-mono">
                      <div>
                        <span className="text-zinc-400">_id (System):</span>
                        <div className="text-zinc-700 bg-zinc-50 p-1 rounded border mt-0.5 select-all overflow-x-auto whitespace-pre">
                          {selectedNode.data._id}
                        </div>
                      </div>
                      <div>
                        <span className="text-zinc-400">_key (Hash):</span>
                        <div className="text-zinc-600 bg-zinc-50 p-1 rounded border mt-0.5">
                          {selectedNode.data._key}
                        </div>
                      </div>

                      {/* Document Type Fields */}
                      {selectedNode.type === 'document' && (
                        <>
                          <div className="flex justify-between">
                            <span className="text-zinc-400 font-sans">Source File:</span>
                            <span className="text-zinc-800 break-all ml-1">{selectedNode.data.source_file}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-zinc-400 font-sans">Parser Engine:</span>
                            <span className={`px-1.5 py-0.5 rounded text-3xs font-semibold ${
                              selectedNode.data.parser_engine === 'MinerU' ? 'bg-indigo-100 text-indigo-700' : 'bg-emerald-100 text-emerald-700'
                            }`}>{selectedNode.data.parser_engine}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-zinc-400 font-sans">File Size:</span>
                            <span className="text-zinc-600">{selectedNode.data.file_size}</span>
                          </div>
                        </>
                      )}

                      {/* Section Heading Metadata */}
                      {selectedNode.type === 'section' && (
                        <>
                          <div className="flex justify-between">
                            <span className="text-zinc-400 font-sans">Document ID:</span>
                            <span className="text-zinc-600">{selectedNode.data.document_id}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-zinc-400 font-sans">Heading Level:</span>
                            <span className="font-semibold text-zinc-800">h{selectedNode.data.level}</span>
                          </div>
                        </>
                      )}

                      {/* Paragraph Content Section */}
                      {selectedNode.type === 'paragraph' && (
                        <div className="space-y-1 pt-1 font-sans text-xs">
                          <span className="text-zinc-400 font-mono text-2xs">content text:</span>
                          {selectedNode.data.is_latex ? (
                            <div className="p-3 bg-zinc-900 text-amber-300 font-mono text-xs rounded-lg border border-amber-900/40 text-center select-all my-2">
                              {/* Quick clean visual styling for math formulas */}
                              <div className="text-3xs text-amber-500 mb-1 tracking-widest font-bold uppercase">LaTeX Notation Rendered</div>
                              <span className="text-sm font-semibold">{selectedNode.data.content}</span>
                            </div>
                          ) : (
                            <div className="text-zinc-700 bg-zinc-50 border p-2 rounded-lg leading-relaxed text-xs">
                              {selectedNode.data.content}
                            </div>
                          )}
                          <div className="flex justify-between font-mono text-2xs text-zinc-400 pt-1.5 border-t mt-1.5">
                            <span>Document linked:</span>
                            <span className="text-zinc-600 overflow-hidden text-ellipsis whitespace-nowrap max-w-[120px]">{selectedNode.data.document_id}</span>
                          </div>
                        </div>
                      )}

                      {/* Structural Table Content */}
                      {selectedNode.type === 'table' && (
                        <div className="space-y-2 font-sans pt-1">
                          <span className="text-zinc-400 font-mono text-2xs">Markdown representation:</span>
                          <div className="p-2 bg-zinc-850 text-white font-mono text-2xs overflow-x-auto rounded-lg border leading-tight whitespace-pre max-h-36">
                            {selectedNode.data.markdown_representation}
                          </div>

                          <span className="text-zinc-400 font-mono text-2xs block mt-2">Parsed grid representation:</span>
                          <div className="border rounded-lg overflow-hidden overflow-x-auto bg-white shadow-3xs max-h-44">
                            <table className="w-full text-left text-3xs border-collapse">
                              <thead>
                                <tr className="bg-zinc-50 border-b">
                                  {selectedNode.data.matrix_data?.[0]?.map((colName: string, i: number) => (
                                    <th key={i} className="p-1 px-1.5 font-bold text-zinc-500 whitespace-nowrap">{colName}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {selectedNode.data.matrix_data?.slice(1).map((row: string[], rIdx: number) => (
                                  <tr key={rIdx} className="border-b hover:bg-zinc-50">
                                    {row.map((cell, cIdx) => (
                                      <td key={cIdx} className="p-1 px-1.5 text-zinc-600 whitespace-nowrap">{cell}</td>
                                    ))}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </motion.div>
              ) : (
                <div className="rounded-xl border-2 border-dashed border-zinc-200 p-6 text-center text-zinc-400 my-6 flex flex-col items-center justify-center space-y-2">
                  <Eye size={28} className="text-zinc-300 stroke-1" />
                  <p className="text-xs leading-relaxed">
                    Click on any node in the SVG Graph panel to inspect its relational attributes and AQL storage.
                  </p>
                </div>
              )}
            </AnimatePresence>
          </div>

          <div className="p-3 bg-zinc-100 rounded-lg text-3xs text-zinc-500 leading-relaxed space-y-1 mt-4">
            <div className="font-semibold text-zinc-700 flex items-center gap-1">
              <Network size={12} className="text-zinc-600 animate-pulse" />
              Interactive SVG Stage Help:
            </div>
            <p>• Root nodes (Documents) represent file metadata.</p>
            <p>• Intermediate nodes (Sections) map headers.</p>
            <p>• Leaf nodes (Paragraphs and Tables) contain layout segments.</p>
          </div>
        </div>
      </div>

      {/* SVG Canvas and Graph Stage */}
      <div className="flex-1 bg-zinc-50 relative flex flex-col min-h-[460px]">
        {/* Graph Legends / Controls floating toolbar */}
        <div className="absolute top-4 left-4 right-4 z-10 flex items-center justify-between pointer-events-none">
          <div className="flex gap-1.5 bg-white/90 backdrop-blur border border-zinc-200 shadow-sm p-1.5 rounded-lg text-3xs font-semibold text-zinc-700 pointer-events-auto">
            <span className="flex items-center gap-1 pl-1 pr-2 border-r"><FileText size={10} className="text-indigo-600" /> Documents</span>
            <span className="flex items-center gap-1 px-2 border-r"><Hash size={10} className="text-cyan-500" /> Sections</span>
            <span className="flex items-center gap-1 px-2 border-r"><AlignLeft size={10} className="text-amber-500" /> Tech/Text</span>
            <span className="flex items-center gap-1 px-2"><TableIcon size={10} className="text-pink-500" /> Tables</span>
          </div>

          <div className="flex gap-1 bg-white/90 backdrop-blur border border-zinc-200 shadow-sm p-1 rounded-lg pointer-events-auto">
            <button
              onClick={() => setZoomLevel(prev => Math.min(prev + 0.1, 1.4))}
              title="Zoom In"
              className="p-1 px-1.5 rounded hover:bg-zinc-100 text-zinc-600 transition"
            >
              <ZoomIn size={12} />
            </button>
            <button
              onClick={() => setZoomLevel(prev => Math.max(prev - 0.1, 0.5))}
              title="Zoom Out"
              className="p-1 px-1.5 rounded hover:bg-zinc-100 text-zinc-600 transition"
            >
              <ZoomOut size={12} />
            </button>
            <button
              onClick={() => {
                setZoomLevel(0.95);
                setSelectedNode(null);
              }}
              title="Reset Viewport"
              className="p-1 px-1.5 rounded hover:bg-zinc-100 text-zinc-600 transition"
            >
              <RefreshCw size={12} />
            </button>
          </div>
        </div>

        {/* The SVG Container */}
        <div className="flex-1 w-full overflow-hidden relative">
          {graphData.nodes.length === 0 ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center p-8 space-y-3">
              <span className="p-3 bg-zinc-100 border rounded-full text-zinc-300">
                <Network size={36} />
              </span>
              <p className="text-sm font-semibold text-zinc-700 text-center">ArangoDB Collections empty</p>
              <p className="text-xs text-zinc-500 max-w-sm text-center">
                Stage some files on the left and trigger your Docling/MinerU Extraction Pipieline to populate the multi-model graph layout.
              </p>
            </div>
          ) : (
            <svg
              className="w-full h-full cursor-grab"
              viewBox="0 0 900 550"
              style={{
                background: 'radial-gradient(#e5e7eb 1px, transparent 1px)',
                backgroundSize: '16px 16px',
              }}
            >
              <g style={{ transform: `scale(${zoomLevel})`, transformOrigin: 'center center', transition: 'transform 0.18s cubic-bezier(0.16, 1, 0.3, 1)' }}>
                {/* 1. Arrow defs for directed graph edges */}
                <defs>
                  <marker id="arrow-has" viewBox="0 0 10 10" refX="15" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                    <path d="M 0 0 L 10 5 L 0 10 z" fill="#0ea5e9" />
                  </marker>
                  <marker id="arrow-contains" viewBox="0 0 10 10" refX="15" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                    <path d="M 0 0 L 10 5 L 0 10 z" fill="#f59e0b" />
                  </marker>
                  <marker id="arrow-belongs" viewBox="0 0 10 10" refX="15" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                    <path d="M 0 0 L 10 5 L 0 10 z" fill="#a1a1aa" />
                  </marker>
                </defs>

                {/* 2. Draw Edge Connection Lines first (behind nodes) */}
                {graphData.edges.map((edge) => {
                  const sourceNode = graphData.nodes.find(n => n.id === edge._from);
                  const targetNode = graphData.nodes.find(n => n.id === edge._to);

                  if (!sourceNode || !targetNode) return null;

                  const isBelongsTo = edge.type === 'belongs_to';
                  const isSectionLink = edge.type === 'has_section';

                  return (
                    <g key={edge._id} className="group/edge">
                      {/* Active hovering line background */}
                      <line
                        x1={sourceNode.x}
                        y1={sourceNode.y}
                        x2={targetNode.x}
                        y2={targetNode.y}
                        stroke="transparent"
                        strokeWidth={12}
                        className="cursor-pointer"
                      />
                      <line
                        x1={sourceNode.x}
                        y1={sourceNode.y}
                        x2={targetNode.x}
                        y2={targetNode.y}
                        stroke={
                          isSectionLink ? '#0ea5e9' :
                          edge.type.includes('contains') ? '#f59e0b' : 
                          isBelongsTo ? '#27272a' : '#d4d4d8'
                        }
                        strokeWidth={isBelongsTo ? 0.75 : 1.25}
                        strokeDasharray={isBelongsTo ? '3, 3' : undefined}
                        markerEnd={
                          isSectionLink ? 'url(#arrow-has)' :
                          edge.type.includes('contains') ? 'url(#arrow-contains)' : 
                          isBelongsTo ? 'url(#arrow-belongs)' : undefined
                        }
                        className={`transition-all duration-300 ${
                          isBelongsTo ? 'opacity-30' : 'opacity-70 group-hover/edge:opacity-100 group-hover/edge:stroke-width-2'
                        }`}
                      />
                      {/* Edge Label tooltip */}
                      <title>{`Edge collection: ${edge.type}\nFrom: ${edge._from}\nTo: ${edge._to}`}</title>
                    </g>
                  );
                })}

                {/* 3. Draw Vertex Nodes */}
                {graphData.nodes.map((node) => {
                  const isSelected = selectedNode?.id === node.id;
                  
                  return (
                    <g
                      key={node.id}
                      onClick={() => setSelectedNode({ id: node.id, type: node.type, data: node.originalData })}
                      className="cursor-pointer"
                    >
                      <motion.g
                        whileHover={{ scale: 1.05 }}
                        transition={{ type: 'spring', stiffness: 350, damping: 25 }}
                      >
                        {/* Rendering Document Node */}
                        {node.type === 'document' && (
                          <g>
                            <circle
                              cx={node.x}
                              cy={node.y}
                              r={38}
                              fill="#f8fafc"
                              stroke={isSelected ? '#312e81' : '#4f46e5'}
                              strokeWidth={isSelected ? 3 : 1.5}
                              className="filter drop-shadow-sm transition"
                            />
                            <rect
                              x={node.x - 14}
                              y={node.y - 14}
                              width={28}
                              height={28}
                              rx={4}
                              fill={node.originalData.parser_engine === 'MinerU' ? '#eef2ff' : '#ecfdf5'}
                              className="transition"
                            />
                            <text
                              x={node.x}
                              y={node.y + 4}
                              textAnchor="middle"
                              className={`font-sans text-4xs font-bold leading-none ${
                                node.originalData.parser_engine === 'MinerU' ? 'text-indigo-600' : 'text-emerald-600'
                              }`}
                            >
                              {node.originalData.parser_engine}
                            </text>
                            
                            {/* Text labels outside node */}
                            <text
                              x={node.x}
                              y={node.y + 54}
                              textAnchor="middle"
                              className="font-sans text-3xs font-semibold text-zinc-900 fill-zinc-900"
                            >
                              {node.label.slice(0, 15)}{node.label.length > 15 ? '...' : ''}
                            </text>
                          </g>
                        )}

                        {/* Rendering Section Node */}
                        {node.type === 'section' && (
                          <g>
                            <rect
                              x={node.x - 52}
                              y={node.y - 12}
                              width={104}
                              height={24}
                              rx={6}
                              fill="#fff"
                              stroke={isSelected ? '#0369a1' : '#0ea5e9'}
                              strokeWidth={isSelected ? 2.5 : 1}
                              className="filter drop-shadow-sm"
                            />
                            <text
                              x={node.x}
                              y={node.y + 3}
                              textAnchor="middle"
                              className="font-sans text-4xs font-medium fill-zinc-700"
                            >
                              {node.label.slice(0, 18)}{node.label.length > 18 ? '...' : ''}
                            </text>
                          </g>
                        )}

                        {/* Rendering Paragraph Content Node */}
                        {node.type === 'paragraph' && (
                          <g>
                            <rect
                              x={node.x - 65}
                              y={node.y - 12}
                              width={130}
                              height={24}
                              rx={4}
                              fill="#fff"
                              stroke={isSelected ? '#b45309' : '#f59e0b'}
                              strokeWidth={isSelected ? 2 : 1}
                              className="filter drop-shadow-sm"
                            />
                            {/* Highlight if latex equation icon */}
                            {node.originalData.is_latex ? (
                              <rect
                                x={node.x - 61}
                                y={node.y - 8}
                                width={14}
                                height={16}
                                rx={2}
                                fill="#fef3c7"
                              />
                            ) : null}
                            <text
                              x={node.x - 54}
                              y={node.y + 4}
                              className="font-mono text-5xs fill-amber-700 font-bold"
                            >
                              {node.originalData.is_latex ? 'f(x)' : 'TXT'}
                            </text>
                            <text
                              x={node.x - 22}
                              y={node.y + 3}
                              className="font-sans text-5xs fill-zinc-500 font-normal"
                            >
                              {node.label.slice(0, 22)}{node.label.length > 22 ? '...' : ''}
                            </text>
                          </g>
                        )}

                        {/* Rendering Table Node */}
                        {node.type === 'table' && (
                          <g>
                            <rect
                              x={node.x - 45}
                              y={node.y - 12}
                              width={90}
                              height={24}
                              rx={4}
                              fill="#fff"
                              stroke={isSelected ? '#be185d' : '#ec4899'}
                              strokeWidth={isSelected ? 2.5 : 1}
                              className="filter drop-shadow-sm"
                            />
                            <text
                              x={node.x}
                              y={node.y + 3}
                              textAnchor="middle"
                              className="font-sans text-5xs font-semibold fill-pink-700"
                            >
                              📊 {node.label}
                            </text>
                          </g>
                        )}
                      </motion.g>
                    </g>
                  );
                })}
              </g>
            </svg>
          )}
        </div>
      </div>
    </div>
  );
}
