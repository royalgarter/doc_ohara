import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Database, 
  Terminal, 
  RotateCcw, 
  Trash2, 
  Share2,
  FileCode,
  Layers, 
  Settings,
  ShieldCheck,
  AlertCircle
} from 'lucide-react';
import StagingSection from './components/StagingSection.js';
import GraphViewer from './components/GraphViewer.js';
import QueryTerminal from './components/QueryTerminal.js';
import { 
  ArangoDocument, 
  ArangoSection, 
  ArangoParagraph, 
  ArangoTable, 
  ArangoEdge 
} from './document_samples.js';

export default function App() {
  // ArangoDB Database collections state
  const [dbState, setDbState] = useState<{
    documents: ArangoDocument[];
    sections: ArangoSection[];
    paragraphs: ArangoParagraph[];
    tables: ArangoTable[];
    edges: ArangoEdge[];
  }>({
    documents: [],
    sections: [],
    paragraphs: [],
    tables: [],
    edges: []
  });

  // Staging area files state
  const [stagedFiles, setStagedFiles] = useState<any[]>([]);

  // Pipeline execution state
  const [pipelineActive, setPipelineActive] = useState<boolean>(false);
  const [pipelineLogs, setPipelineLogs] = useState<any[]>([]);

  // Polling tracker for active pipeline execution
  const [pollingInterval, setPollingInterval] = useState<NodeJS.Timeout | null>(null);

  // Status message
  const [globalMessage, setGlobalMessage] = useState<{ type: 'success' | 'err' | 'info'; text: string } | null>(null);

  // 1. Fetch database state
  const fetchDatabaseState = useCallback(async () => {
    try {
      const res = await fetch('/api/database/state');
      const data = await res.json();
      if (data.success) {
        setDbState(data.state);
      }
    } catch (err) {
      console.error('Failed to resolve database collections state:', err);
    }
  }, []);

  // 2. Fetch input staging files
  const fetchStagedFiles = useCallback(async () => {
    try {
      const res = await fetch('/api/pipeline/input-files');
      const data = await res.json();
      if (data.success) {
        setStagedFiles(data.files || []);
      }
    } catch (err) {
      console.error('Failed to resolve input files:', err);
    }
  }, []);

  // 3. Fetch active logs and status
  const fetchPipelineStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/pipeline/status');
      const data = await res.json();
      setPipelineActive(data.active);
      setPipelineLogs(data.logs || []);

      if (!data.active && pollingInterval) {
        // Stop polling once active state is false
        clearInterval(pollingInterval);
        setPollingInterval(null);
        // Refresh database state on success completion
        fetchDatabaseState();
        showNotification('success', 'Pipeline execution finished successfully.');
      }
    } catch (err) {
      console.error('Failed to fetch pipeline status:', err);
    }
  }, [pollingInterval, fetchDatabaseState]);

  // Handle uploading staged file
  const handleStageFile = async (filename: string, content: string, format: string) => {
    try {
      const res = await fetch('/api/pipeline/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename, content, format })
      });
      return await res.json();
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  };

  // Handle deleting staged file
  const handleDeleteStagedFile = async (name: string) => {
    try {
      const res = await fetch(`/api/pipeline/input-files/${name}`, {
        method: 'DELETE'
      });
      const data = await res.json();
      if (data.success) {
        fetchStagedFiles();
        showNotification('info', `File deleted: ${name}`);
      }
      return data;
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  };

  // Trigger active pipeline run
  const handleTriggerPipeline = async () => {
    if (pipelineActive) return;
    try {
      // Clear logs first on staging UI
      setPipelineLogs([]);
      setPipelineActive(true);

      const res = await fetch('/api/pipeline/run', {
        method: 'POST'
      });
      const data = await res.json();

      if (data.success) {
        showNotification('info', 'Document layout worker thread launched.');
        // Set up polling interval to fetch progress logs every 1.2 seconds
        const interval = setInterval(() => {
          fetchPipelineStatus();
          fetchDatabaseState();
        }, 1200);
        setPollingInterval(interval);
      } else {
        setPipelineActive(false);
        showNotification('err', data.error || 'Failed to trigger pipeline execution.');
      }
    } catch (err: any) {
      setPipelineActive(false);
      showNotification('err', err.message || 'Worker network failure.');
    }
  };

  // Run custom AQL query on simulated server
  const handleExecuteAQLQuery = async (query: string, bindVars?: Record<string, any>) => {
    try {
      const res = await fetch('/api/database/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, bindVars })
      });
      return await res.json();
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  };

  // Reset database arrays to standard samples
  const handleReseedDatabase = async () => {
    try {
      const res = await fetch('/api/database/seed', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setDbState(data.state);
        showNotification('success', 'Database seeded with standard research paper templates.');
      }
    } catch (err: any) {
      showNotification('err', err.message || 'Reseeding error.');
    }
  };

  // Wipe database collections clean
  const handleClearDatabase = async () => {
    if (!window.confirm("Are you sure you want to drop all ArangoDB layout collections? This wipes all document coordinates.")) return;
    try {
      const res = await fetch('/api/database/clear', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setDbState(data.state);
        showNotification('info', 'All database collections dropped successfully.');
      }
    } catch (err: any) {
      showNotification('err', err.message || 'Database dropped error.');
    }
  };

  // Helper notification toaster
  const showNotification = (type: 'success' | 'err' | 'info', text: string) => {
    setGlobalMessage({ type, text });
    setTimeout(() => {
      setGlobalMessage(null);
    }, 4500);
  };

  // Bootstrapping initial fetches on mount
  useEffect(() => {
    fetchDatabaseState();
    fetchStagedFiles();
    fetchPipelineStatus();

    return () => {
      if (pollingInterval) clearInterval(pollingInterval);
    };
  }, []);

  return (
    <div className="min-h-screen bg-zinc-100 text-zinc-800 flex flex-col font-sans select-none antialiased">
      
      {/* 1. Global Navigation Bar */}
      <header className="sticky top-0 z-30 bg-zinc-900 text-white shadow-md border-b border-zinc-800">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="p-2 bg-indigo-600 rounded-lg text-white font-bold tracking-widest shadow-lg animate-pulse-slow">
              <Layers size={18} />
            </span>
            <div>
              <h1 className="text-sm md:text-base font-extrabold tracking-tight">
                AI DOCUMENT PARSING PIPELINE
              </h1>
              <span className="text-4xs font-mono text-zinc-400 block tracking-widest leading-none">
                LAYOUT STANDARD REPRODUCTION & ARANGODB GRAPH SEEDER
              </span>
            </div>
          </div>

          {/* Quick Stats Panel in Header */}
          <div className="hidden lg:flex gap-4 items-center pl-6 border-l border-zinc-800">
            <div className="text-3xs font-mono">
              <span className="text-zinc-500 block uppercase">Document vertices</span>
              <span className="text-xs font-semibold text-indigo-400">{dbState.documents?.length || 0} docs</span>
            </div>
            <div className="text-3xs font-mono">
              <span className="text-zinc-500 block uppercase">Layout chapters</span>
              <span className="text-xs font-semibold text-cyan-400">{dbState.sections?.length || 0} nodes</span>
            </div>
            <div className="text-3xs font-mono">
              <span className="text-zinc-500 block uppercase">Leaf Elements</span>
              <span className="text-xs font-semibold text-amber-400">
                {Number(dbState.paragraphs?.length || 0) + Number(dbState.tables?.length || 0)} chunks
              </span>
            </div>
            <div className="text-3xs font-mono">
              <span className="text-zinc-500 block uppercase">Graph edges</span>
              <span className="text-xs font-semibold text-pink-400">{dbState.edges?.length || 0} links</span>
            </div>
          </div>

          {/* Setup reset controls */}
          <div className="flex gap-1.5 items-center">
            <button
              onClick={handleReseedDatabase}
              title="Re-seed database with default rich math and corporate policy structures"
              className="flex items-center gap-1 bg-zinc-800 hover:bg-zinc-750 text-white border border-zinc-700 text-3xs font-bold uppercase px-3 py-1.5 rounded-lg tracking-wider transition"
            >
              <RotateCcw size={12} />
              Reset Seeds
            </button>
            <button
              onClick={handleClearDatabase}
              title="Drop all collections"
              className="p-1.5 bg-zinc-800 hover:bg-red-950/40 border border-zinc-700 text-zinc-400 hover:text-red-400 rounded-lg transition"
            >
              <Trash2 size={13} />
            </button>
          </div>
        </div>
      </header>

      {/* 2. Main Layout Workspace Section */}
      <main className="flex-1 max-w-7xl mx-auto w-full p-4 grid grid-cols-1 lg:grid-cols-12 gap-5 overflow-hidden">
        
        {/* Left Column - Stage & Pipeline Monitor */}
        <section className="lg:col-span-4 space-y-4 flex flex-col justify-between" id="pipeline-control-panel">
          <StagingSection
            files={stagedFiles}
            onUploadFile={handleStageFile}
            onDeleteFile={handleDeleteStagedFile}
            onRunPipeline={handleTriggerPipeline}
            pipelineActive={pipelineActive}
            pipelineLogs={pipelineLogs}
            onRefreshFiles={fetchStagedFiles}
          />
        </section>

        {/* Right Column - Tabs and Database Visual Playground */}
        <section className="lg:col-span-8 flex flex-col gap-4 overflow-hidden h-full" id="db-playground">
          
          {/* Card Module 1: Graph Visualizers */}
          <div className="flex-1 flex flex-col h-full bg-transparent">
            {/* Component Title details */}
            <div className="mb-2 flex items-center justify-between">
              <div>
                <h2 className="text-xs font-bold text-zinc-500 uppercase tracking-widest flex items-center gap-1">
                  🌐 Multi-Model Graph Topology Map
                </h2>
                <span className="text-4xs text-zinc-500 leading-none block font-mono">
                  Visual relationship representation between extracted vertices in ArangoDB
                </span>
              </div>
            </div>
            
            <div className="flex-1 h-full min-h-[460px]">
              <GraphViewer state={dbState} />
            </div>
          </div>

          {/* Card Module 2: AQL query Terminal and Collections browser */}
          <div className="h-[430px] shrink-0">
            <div className="mb-2">
              <h2 className="text-xs font-bold text-zinc-500 uppercase tracking-widest flex items-center gap-1">
                🗄️ Multi-Model Database Console (ArangoDB Simulator)
              </h2>
              <span className="text-4xs text-zinc-500 leading-none block font-mono">
                Execute database queries, compile edge traversals, or explore staged rows
              </span>
            </div>
            <div className="h-[390px]">
              <QueryTerminal state={dbState} onExecuteQuery={handleExecuteAQLQuery} />
            </div>
          </div>

        </section>
      </main>

      {/* 3. Global Toast Notifications */}
      <AnimatePresence>
        {globalMessage && (
          <motion.div
            initial={{ opacity: 0, y: 50, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            className={`fixed bottom-4 right-4 z-50 flex items-center gap-2 p-3.5 px-4 rounded-xl border shadow-lg ${
              globalMessage.type === 'success' ? 'bg-emerald-950 border-emerald-900 text-emerald-200' :
              globalMessage.type === 'err' ? 'bg-red-950 border-red-900 text-red-200' :
              'bg-zinc-900 border-zinc-800 text-indigo-200'
            }`}
          >
            <ShieldCheck size={16} className={globalMessage.type === 'success' ? 'text-emerald-400 animate-bounce' : 'text-indigo-400'} />
            <div className="text-xs font-semibold leading-normal">{globalMessage.text}</div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 4. Elegant footer */}
      <footer className="bg-zinc-900 text-zinc-500 border-t border-zinc-850 h-10 mt-auto flex items-center justify-between px-6 shrink-0 font-mono text-4xs uppercase tracking-widest">
        <span>AI Document Extraction Workspace • Local Sandbox Environment</span>
        <span>Standard Output: UTF-8 • ArangoDB v3.12 (Simulated Graph Engine)</span>
      </footer>

    </div>
  );
}
