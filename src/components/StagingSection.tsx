import React, { useState, useEffect } from 'react';
import { 
  FileText, 
  Plus, 
  Trash2, 
  Play, 
  CircleAlert, 
  AlertTriangle,
  RotateCw,
  Terminal,
  Clock,
  CheckCircle2, 
  HelpCircle,
  FolderOpen
} from 'lucide-react';

interface StagedFile {
  name: string;
  size: string;
  mtime: string;
}

interface PipelineLog {
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'success';
  message: string;
}

interface StagingSectionProps {
  files: StagedFile[];
  onUploadFile: (filename: string, content: string, format: string) => Promise<any>;
  onDeleteFile: (filename: string) => Promise<any>;
  onRunPipeline: () => Promise<any>;
  pipelineActive: boolean;
  pipelineLogs: PipelineLog[];
  onRefreshFiles: () => void;
}

const SAMPLE_PRESETS = [
  {
    title: "Quantum Gravity Notes",
    format: "pdf",
    filename: "quantum_physics_core.pdf",
    content: `Title: Multi-Loop Quantum Gravity Invariant Convergence
Sections:
- 1. Topological manifolds in Spin grids
Many unified mathematical attempts face dimension anomalies. We present spin networks mapping boundary coordinates directly into gauge partitions.

- 2. Einstein Hilbert partition metric integrals
Using cryogenic fluid measures, we formulate localized boundary states:
\int_{\mathcal{M}} \mathcal{R} \sqrt{-g} \, d^4x + \mathcal{G}_s

- 3. Superconducting phase boundary metrics
Measurements conform with traditional loop approximations. See convergence table A.`
  },
  {
    title: "Corporate Expense Policy",
    format: "docx",
    filename: "operational_claim_handbook.docx",
    content: `Title: Operational Directives for Class Ticketing & Approvals
Sections:
- Section A: Standard Traveling Codes
This document mandates flight and dinner limits. All staff must comply with expense guidelines.

- Section B: Flight Class Upgrades
Domestic travel under 6 hours requires Economy Class. Long voyages exceeding 10 hours qualify for Business Class.

- Section C: Dining Reimburse Limits
Meal limit caps at $75.00 USD daily. Receipts must be saved in the expense console.`
  }
];

export default function StagingSection({
  files,
  onUploadFile,
  onDeleteFile,
  onRunPipeline,
  pipelineActive,
  pipelineLogs,
  onRefreshFiles
}: StagingSectionProps) {
  // Staging Form states
  const [showCreator, setShowCreator] = useState(false);
  const [docName, setDocName] = useState('');
  const [docFormat, setDocFormat] = useState('pdf');
  const [docContent, setDocContent] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formMsg, setFormMsg] = useState<{ type: 'success' | 'err'; text: string } | null>(null);

  // Apply preset helper
  const handleApplyPreset = (preset: typeof SAMPLE_PRESETS[0]) => {
    setDocName(preset.filename);
    setDocFormat(preset.format);
    setDocContent(preset.content);
    setFormMsg({ type: 'success', text: `Preset loaded for ${preset.title}.` });
  };

  // Submit creator content
  const handleUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!docName.trim()) {
      setFormMsg({ type: 'err', text: 'Please enter a valid filename.' });
      return;
    }
    
    setIsSubmitting(true);
    setFormMsg(null);
    try {
      const res = await onUploadFile(docName, docContent, docFormat);
      if (res.success) {
        setFormMsg({ type: 'success', text: `Successfully staged file "${docName}".` });
        // Clean outputs
        setDocName('');
        setDocContent('');
        onRefreshFiles();
      } else {
        setFormMsg({ type: 'err', text: res.error || 'Failed to uploads file.' });
      }
    } catch (err: any) {
      setFormMsg({ type: 'err', text: err.message || 'Error occurred.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-4" id="staging-console">
      {/* 1. Staging Workspace Header */}
      <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-2xs">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold text-zinc-800 flex items-center gap-1.5 uppercase tracking-wider">
            <FolderOpen size={16} className="text-zinc-600" />
            1. Document Input Stage
          </h3>
          <button
            onClick={() => setShowCreator(!showCreator)}
            className="flex items-center gap-1 bg-zinc-950 hover:bg-zinc-800 text-white text-3xs font-bold uppercase tracking-wider px-2.5 py-1.5 rounded-lg shadow-sm transition"
          >
            <Plus size={12} />
            {showCreator ? 'Close Workspace' : 'Stage New File'}
          </button>
        </div>

        {/* Creator sub-form */}
        {showCreator && (
          <form onSubmit={handleUploadSubmit} className="border-t border-dashed border-zinc-200 pt-3 mt-3 space-y-3">
            <div className="bg-zinc-50 border p-3 rounded-lg">
              <span className="text-3xs font-extrabold text-zinc-400 uppercase tracking-widest block mb-2">
                Load Stave Document Preset:
              </span>
              <div className="flex flex-wrap gap-1.5">
                {SAMPLE_PRESETS.map((preset, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => handleApplyPreset(preset)}
                    className="bg-white hover:bg-zinc-100 border text-3xs font-semibold px-2 py-1 rounded"
                  >
                    🚀 {preset.title} ({preset.format.toUpperCase()})
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-3xs font-bold text-zinc-400 uppercase tracking-wider block mb-1">
                  Filename
                </label>
                <input
                  type="text"
                  required
                  value={docName}
                  onChange={(e) => setDocName(e.target.value)}
                  placeholder="manual_report.pdf"
                  className="w-full h-8 text-xs bg-white rounded-lg border border-zinc-250 px-2.5 focus:outline-none focus:ring-1 focus:ring-zinc-400"
                />
              </div>
              <div>
                <label className="text-3xs font-bold text-zinc-400 uppercase tracking-wider block mb-1">
                  Format (Parser Route)
                </label>
                <select
                  value={docFormat}
                  onChange={(e) => setDocFormat(e.target.value)}
                  className="w-full h-8 text-xs bg-white rounded-lg border border-zinc-250 px-2.5 focus:outline-none focus:ring-1 focus:ring-zinc-400"
                >
                  <option value="pdf">Academic PDF (Route to MinerU)</option>
                  <option value="docx">Word DOCX (Route to Docling)</option>
                  <option value="html">HTML Page (Route to Docling)</option>
                  <option value="epub">EPUB Book (Route to Docling)</option>
                </select>
              </div>
            </div>

            <div>
              <label className="text-3xs font-bold text-zinc-400 uppercase tracking-wider block mb-1 font-mono">
                Document Body Text / Outline
              </label>
              <textarea
                value={docContent}
                onChange={(e) => setDocContent(e.target.value)}
                rows={5}
                required
                placeholder="Write customized document headers, paragraphs, or LaTeX formulas..."
                className="w-full text-xs font-mono bg-white rounded-lg border border-zinc-250 p-2.5 focus:outline-none focus:ring-1 focus:ring-zinc-400"
              />
            </div>

            {formMsg && (
              <div className={`p-2 rounded text-3xs font-semibold ${
                formMsg.type === 'success' ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800'
              }`}>
                {formMsg.text}
              </div>
            )}

            <div className="flex justify-end gap-1.5">
              <button
                type="submit"
                disabled={isSubmitting}
                className="bg-emerald-650 hover:bg-emerald-700 text-white font-semibold text-3xs uppercase tracking-wider px-3.5 py-2 rounded-lg transition disabled:bg-zinc-300 shadow"
              >
                {isSubmitting ? 'Staging...' : 'Upload & Stage Document'}
              </button>
            </div>
          </form>
        )}

        {/* File queue viewer */}
        <div className="mt-3 border border-zinc-200 rounded-lg overflow-hidden bg-zinc-50 overflow-x-auto">
          <table className="w-full text-left text-xs text-zinc-600 border-collapse">
            <thead>
              <tr className="bg-zinc-100 font-semibold border-b text-zinc-400 h-8">
                <th className="p-1.5 px-3">Queued File</th>
                <th className="p-1.5 px-3">Size</th>
                <th className="p-1.5 px-3">Parser Engine Routing</th>
                <th className="p-1.5 px-3 text-right">Delete</th>
              </tr>
            </thead>
            <tbody>
              {files.length === 0 ? (
                <tr>
                  <td colSpan={4} className="p-4 text-center text-zinc-400 text-2xs italic">
                    Staging queue is empty. Click "Stage New File" above or trigger execution to generate default items.
                  </td>
                </tr>
              ) : (
                files.map(file => {
                  const ext = file.name.split('.').pop()?.toLowerCase();
                  const engine = ext === 'pdf' ? 'MinerU' : 'Docling';
                  return (
                    <tr key={file.name} className="border-b bg-white hover:bg-zinc-50 h-8">
                      <td className="p-1.5 px-3 font-semibold text-zinc-800 flex items-center gap-1.5 truncate max-w-[200px]">
                        <FileText size={12} className="text-zinc-400" />
                        {file.name}
                      </td>
                      <td className="p-1.5 px-3 font-mono text-3xs text-zinc-500">{file.size}</td>
                      <td className="p-1.5 px-3">
                        <span className={`px-1.5 py-0.5 rounded text-3xs font-semibold ${
                          engine === 'MinerU' ? 'bg-indigo-50 text-indigo-700 border border-indigo-100' : 'bg-emerald-50 text-emerald-700 border border-emerald-100'
                        }`}>
                          {engine}
                        </span>
                      </td>
                      <td className="p-1.5 px-3 text-right">
                        <button
                          onClick={() => onDeleteFile(file.name)}
                          className="text-zinc-400 hover:text-red-500 p-1"
                          title="Purge File"
                        >
                          <Trash2 size={12} />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 2. Orchestration trigger banner */}
      <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-2xs">
        <h3 className="text-sm font-bold text-zinc-800 flex items-center gap-1.5 uppercase tracking-wider mb-2">
          <Clock size={16} className="text-zinc-600" />
          2. Pipeline Orchestration
        </h3>
        <p className="text-2xs text-zinc-500 leading-normal mb-3">
          This triggers our visual extraction worker loop. In development, if a <span className="font-semibold text-zinc-700">GEMINI_API_KEY</span> secret is mounted, the system will use real live layout extraction model blocks to parse headings, formulas, and tabular structures! Otherwise, it will run high-fidelity localized mock structural pipelines.
        </p>

        <button
          onClick={onRunPipeline}
          disabled={pipelineActive}
          className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs uppercase tracking-widest py-2.5 rounded-xl shadow transition disabled:bg-zinc-300"
        >
          {pipelineActive ? (
            <>
              <RotateCw size={14} className="animate-spin" />
              Running Docling & MinerU Pipeline Workers...
            </>
          ) : (
            <>
              <Play size={14} fill="currentColor" />
              Run Layout Extraction Pipeline (run_pipeline.sh)
            </>
          )}
        </button>
      </div>

      {/* 3. Real-time Terminal console box */}
      <div className="rounded-xl border border-zinc-900 bg-zinc-950 p-4 shadow-sm relative overflow-hidden" id="terminal-cli">
        <div className="flex items-center justify-between text-3xs font-mono text-zinc-500 uppercase pb-2 border-b border-zinc-900 mb-3">
          <span className="flex items-center gap-1.5 text-zinc-400 font-bold">
            <Terminal size={12} />
            ORCHESTRATION CONSOLE LOG
          </span>
          <span className="text-emerald-500 h-2 w-2 rounded-full bg-emerald-500/30 border border-emerald-500/80 animate-pulse" />
        </div>

        <div className="h-60 overflow-y-auto font-mono text-2xs space-y-1.5 text-zinc-300 scrollbar-thin scrollbar-thumb-zinc-900">
          {pipelineLogs.length === 0 ? (
            <div className="text-zinc-600 italic py-12 text-center text-3xs selection:bg-zinc-800">
              [SYSTEM IDLE] Press the pipeline run button above to execute extraction scripts.
            </div>
          ) : (
            pipelineLogs.map((log, idx) => (
              <div key={idx} className="flex gap-1.5 leading-relaxed items-start selection:bg-zinc-800">
                <span className="text-zinc-650 tracking-tighter shrink-0 select-none">
                  [{log.timestamp.slice(11, 19)}]
                </span>
                <span className={`font-semibold shrink-0 select-none ${
                    log.level === 'info' ? 'text-blue-400' :
                    log.level === 'warn' ? 'text-amber-500' :
                    log.level === 'error' ? 'text-red-500' : 'text-emerald-400'
                }`}>
                  {log.level === 'info' && '• [INFO]'}
                  {log.level === 'warn' && '⚠ [WARN]'}
                  {log.level === 'error' && '☠ [CRASH]'}
                  {log.level === 'success' && '✓ [SUCC]'}
                </span>
                <span className="text-zinc-200 select-text break-words">
                  {log.message}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
