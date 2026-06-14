import fs from 'fs';
import path from 'path';
import { 
  ArangoDocument, 
  ArangoSection, 
  ArangoParagraph, 
  ArangoTable, 
  ArangoEdge,
  sampleDocuments,
  sampleSections,
  sampleParagraphs,
  sampleTables,
  buildSampleEdges
} from './document_samples.js';

const STATE_FILE_PATH = 'doc_pipeline/collections/arangodb_state.json';

export interface ArangoDBState {
  documents: ArangoDocument[];
  sections: ArangoSection[];
  paragraphs: ArangoParagraph[];
  tables: ArangoTable[];
  edges: ArangoEdge[];
}

export class ArangoDBSimulator {
  private state: ArangoDBState = {
    documents: [],
    sections: [],
    paragraphs: [],
    tables: [],
    edges: []
  };

  constructor() {
    this.loadState();
  }

  // Load database state from disk or seed initially
  private loadState() {
    try {
      if (fs.existsSync(STATE_FILE_PATH)) {
        const raw = fs.readFileSync(STATE_FILE_PATH, 'utf-8');
        this.state = JSON.parse(raw);
        // Make sure all arrays exist
        this.state.documents = this.state.documents || [];
        this.state.sections = this.state.sections || [];
        this.state.paragraphs = this.state.paragraphs || [];
        this.state.tables = this.state.tables || [];
        this.state.edges = this.state.edges || [];
      } else {
        this.seedInitialData();
      }
    } catch (e) {
      console.error("Error reading ArangoDB simulated state. Seeding default...", e);
      this.seedInitialData();
    }
  }

  // Seeding default datasets
  public seedInitialData() {
    this.state = {
      documents: [...sampleDocuments],
      sections: [...sampleSections],
      paragraphs: [...sampleParagraphs],
      tables: [...sampleTables],
      edges: buildSampleEdges()
    };
    this.saveState();
  }

  // Save database state to disk
  private saveState() {
    try {
      const dir = path.dirname(STATE_FILE_PATH);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(STATE_FILE_PATH, JSON.stringify(this.state, null, 2), 'utf-8');
    } catch (e) {
      console.error("Failed to writing state to disk:", e);
    }
  }

  public getState(): ArangoDBState {
    return this.state;
  }

  // Database mutations
  public insertDocument(doc: Omit<ArangoDocument, '_id'> & { _id?: string }): ArangoDocument {
    const key = doc._key || `doc_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    const fullDoc: ArangoDocument = {
      ...doc,
      _key: key,
      _id: `documents/${key}`
    };
    this.state.documents.push(fullDoc);
    this.saveState();
    return fullDoc;
  }

  public insertSection(sec: Omit<ArangoSection, '_id'> & { _id?: string }): ArangoSection {
    const key = sec._key || `sec_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    const fullSec: ArangoSection = {
      ...sec,
      _key: key,
      _id: `sections/${key}`
    };
    this.state.sections.push(fullSec);
    // Auto-create edge from document to section
    this.insertEdge({
      _from: `documents/${sec.document_id}`,
      _to: `sections/${key}`,
      type: 'has_section'
    });
    // Auto-create reverse edge
    this.insertEdge({
      _from: `sections/${key}`,
      _to: `documents/${sec.document_id}`,
      type: 'belongs_to'
    });
    this.saveState();
    return fullSec;
  }

  public insertParagraph(p: Omit<ArangoParagraph, '_id'> & { _id?: string }): ArangoParagraph {
    const key = p._key || `p_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    const fullP: ArangoParagraph = {
      ...p,
      _key: key,
      _id: `paragraphs/${key}`
    };
    this.state.paragraphs.push(fullP);
    // If it has a section, link section to paragraph
    if (p.section_id) {
      this.insertEdge({
        _from: p.section_id,
        _to: `paragraphs/${key}`,
        type: 'contains_paragraph'
      });
    }
    // Link paragraph to document root
    this.insertEdge({
      _from: `paragraphs/${key}`,
      _to: `documents/${p.document_id}`,
      type: 'belongs_to'
    });
    this.saveState();
    return fullP;
  }

  public insertTable(t: Omit<ArangoTable, '_id'> & { _id?: string }): ArangoTable {
    const key = t._key || `tbl_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    const fullT: ArangoTable = {
      ...t,
      _key: key,
      _id: `tables/${key}`
    };
    this.state.tables.push(fullT);
    // If it has a section, link section to table
    if (t.section_id) {
      this.insertEdge({
        _from: t.section_id,
        _to: `tables/${key}`,
        type: 'contains_table'
      });
    }
    // Link table to document root
    this.insertEdge({
      _from: `tables/${key}`,
      _to: `documents/${t.document_id}`,
      type: 'belongs_to'
    });
    this.saveState();
    return fullT;
  }

  public insertEdge(edge: Omit<ArangoEdge, '_id'>): ArangoEdge {
    const key = `${edge.type}_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    const fullEdge: ArangoEdge = {
      ...edge,
      _id: `${edge.type}/${key}`
    };
    this.state.edges.push(fullEdge);
    this.saveState();
    return fullEdge;
  }

  public clearAllData() {
    this.state = {
      documents: [],
      sections: [],
      paragraphs: [],
      tables: [],
      edges: []
    };
    this.saveState();
  }

  // Real-time AQL Compiler / Interpreter Engine
  public executeAQL(query: string, bindVars: Record<string, any> = {}): { results: any[]; stats: { executionTimeMs: number; fullCount: number }; error?: string } {
    const startTime = Date.now();
    try {
      const cleaned = query.replace(/\s+/g, ' ').trim();
      
      // Basic checks
      if (!cleaned) {
        return { results: [], stats: { executionTimeMs: 0, fullCount: 0 }, error: "Query is empty." };
      }

      // Check if it's a Graph Traversal Query
      // E.g., FOR v, e IN OUTBOUND "documents/id" has_section, contains_paragraph RETURN v
      const traversalRegex = /^FOR\s+(\w+)\s*,\s*(\w+)(?:\s*,\s*\w+)?\s+IN\s+(OUTBOUND|INBOUND)\s+(["'][^"']+["']|@\w+)\s+([\w,]+)(?:\s+FILTER\s+([^LIMITSORT]+))?(?:\s+SORT\s+([^LIMIT]+))?(?:\s+LIMIT\s+(\d+\s*,\s*\d+|\d+))?\s+RETURN\s+(\w+)$/i;
      const traversalMatch = cleaned.match(traversalRegex);

      if (traversalMatch) {
        return this.executeTraversal(traversalMatch, bindVars, startTime);
      }

      // Standard Collection Query Parser
      // E.g., FOR x IN documents FILTER x.parser_engine == 'MinerU' SORT x.title LIMIT 5 RETURN x
      const standardRegex = /^FOR\s+(\w+)\s+IN\s+(\w+)(?:\s+FILTER\s+([^LIMITSORT]+))?(?:\s+SORT\s+([^LIMIT]+))?(?:\s+LIMIT\s+(\d+\s*,\s*\d+|\d+))?\s+RETURN\s+(\w+|\{[^}]+\})$/i;
      const match = cleaned.match(standardRegex);

      if (!match) {
        // Fallback for simple "RETURN <something>"
        const returnOnlyRegex = /^RETURN\s+(.*)$/i;
        const returnOnlyMatch = cleaned.match(returnOnlyRegex);
        if (returnOnlyMatch) {
          let expr = returnOnlyMatch[1].trim();
          if (expr.startsWith('@')) {
            const varName = expr.slice(1);
            return { results: [bindVars[varName] !== undefined ? bindVars[varName] : null], stats: { executionTimeMs: Date.now() - startTime, fullCount: 1 } };
          }
          if (expr.startsWith('"') || expr.startsWith("'")) {
            return { results: [expr.slice(1, -1)], stats: { executionTimeMs: Date.now() - startTime, fullCount: 1 } };
          }
          try {
            return { results: [JSON.parse(expr)], stats: { executionTimeMs: Date.now() - startTime, fullCount: 1 } };
          } catch {
            return { results: [], stats: { executionTimeMs: Date.now() - startTime, fullCount: 0 }, error: `Could not parse return expression: ${expr}` };
          }
        }

        return { 
          results: [], 
          stats: { executionTimeMs: Date.now() - startTime, fullCount: 0 }, 
          error: "AQL Syntax Error: We support standard 'FOR doc IN documents RETURN doc' or graph traversal 'FOR v, e IN OUTBOUND id' syntaxes." 
        };
      }

      const [_whole, varName, collectionName, filterExpr, sortExpr, limitExpr, returnExpr] = match;

      // Resolve collection
      let collection: any[] = [];
      if (collectionName === 'documents') collection = this.state.documents;
      else if (collectionName === 'sections') collection = this.state.sections;
      else if (collectionName === 'paragraphs') collection = this.state.paragraphs;
      else if (collectionName === 'tables') collection = this.state.tables;
      else if (collectionName === 'edges') collection = this.state.edges;
      else if (collectionName === 'has_section' || collectionName === 'contains_paragraph' || collectionName === 'contains_table' || collectionName === 'belongs_to') {
        collection = this.state.edges.filter(e => e.type === collectionName);
      } else {
        return { 
          results: [], 
          stats: { executionTimeMs: Date.now() - startTime, fullCount: 0 }, 
          error: `Collection '${collectionName}' not found. Supported collections: documents, sections, paragraphs, tables, edges, has_section, contains_paragraph, contains_table, belongs_to.` 
        };
      }

      // Clone so we don't mutate original
      let items = JSON.parse(JSON.stringify(collection));

      // 1. FILTERing
      if (filterExpr) {
        items = this.applyFilters(items, varName, filterExpr.trim(), bindVars);
      }

      // 2. SORTing
      if (sortExpr) {
        items = this.applySorting(items, varName, sortExpr.trim());
      }

      const fullCount = items.length;

      // 3. LIMITing
      if (limitExpr) {
        items = this.applyLimit(items, limitExpr.trim());
      }

      // 4. RETURN projection
      const results = this.applyReturn(items, varName, returnExpr.trim());

      return {
        results,
        stats: {
          executionTimeMs: Date.now() - startTime,
          fullCount
        }
      };
    } catch (e: any) {
      return {
        results: [],
        stats: { executionTimeMs: Date.now() - startTime, fullCount: 0 },
        error: `AQL Interpreter Runtime Error: ${e.message}`
      };
    }
  }

  // Multi-hop Graph Traversal AQL Support
  private executeTraversal(match: RegExpMatchArray, bindVars: Record<string, any>, startTime: number): any {
    const [
      _whole, 
      vVar, 
      eVar, 
      direction, 
      startIdExpr, 
      edgeTypesStr, 
      filterExpr, 
      sortExpr, 
      limitExpr, 
      returnVar
    ] = match;

    // Resolve start ID (e.g. "documents/quantum_paper_001" or @startId)
    let startId = startIdExpr.trim();
    if (startId.startsWith('@')) {
      const key = startId.slice(1);
      startId = bindVars[key] || '';
    } else {
      // Remove quotes
      startId = startId.replace(/^["']|["']$/g, '');
    }

    if (!startId) {
      return { results: [], stats: { executionTimeMs: Date.now() - startTime, fullCount: 0 }, error: `Variable or value for traversal start ID resolved to empty: ${startIdExpr}` };
    }

    // Resolve allowed edge types
    const edgeTypes = edgeTypesStr.split(',').map(s => s.trim().toLowerCase());

    // Do traversal of depth 1 or 2
    // Resolve outbound or inbound matches
    const traversed: Array<{ v: any; e: any }> = [];
    const visited = new Set<string>();

    const edges = this.state.edges;
    const verticesMap = new Map<string, any>();
    // Pre-map vertices
    this.state.documents.forEach(d => verticesMap.set(d._id, d));
    this.state.sections.forEach(s => verticesMap.set(s._id, s));
    this.state.paragraphs.forEach(p => verticesMap.set(p._id, p));
    this.state.tables.forEach(t => verticesMap.set(t._id, t));

    const isOutbound = direction.toUpperCase() === 'OUTBOUND';

    // Helper for finding edges connected to node
    const traverseFromNode = (id: string, depth: number) => {
      if (depth > 2) return;
      edges.forEach(edge => {
        // Filter by edge types
        if (edgeTypes.length && !edgeTypes.includes(edge.type)) return;

        const fromNode = edge._from;
        const toNode = edge._to;

        if (isOutbound && fromNode === id) {
          const targetVertex = verticesMap.get(toNode);
          if (targetVertex && !visited.has(edge._id)) {
            visited.add(edge._id);
            traversed.push({ v: targetVertex, e: edge });
            traverseFromNode(toNode, depth + 1);
          }
        } else if (!isOutbound && toNode === id) {
          const sourceVertex = verticesMap.get(fromNode);
          if (sourceVertex && !visited.has(edge._id)) {
            visited.add(edge._id);
            traversed.push({ v: sourceVertex, e: edge });
            traverseFromNode(fromNode, depth + 1);
          }
        }
      });
    };

    // Begin traversal
    traverseFromNode(startId, 1);

    // Filter, sort, limit traversed graph components
    let resultsList = traversed;

    // Apply filters matching either variables (e.g., v.level, e.type)
    if (filterExpr) {
      const filters = filterExpr.trim().split(/\s+AND\s+/i);
      resultsList = resultsList.filter(item => {
        return filters.every(filt => {
          // e.g. v.level == 1
          const simpleMatch = filt.match(/(\w+)\.(\w+)\s*([=!<>]+)\s*(.*)/);
          if (!simpleMatch) return true;
          const [_, varName, property, operator, valueExpr] = simpleMatch;

          const scope = varName === vVar ? item.v : varName === eVar ? item.e : null;
          if (!scope) return true;

          const rawVal = scope[property];
          let targVal = valueExpr.trim();

          // Resolve boolean or number or strings or variables
          if (targVal.startsWith('@')) {
            targVal = bindVars[targVal.slice(1)];
          } else {
            targVal = targVal.replace(/^["']|["']$/g, '');
            if (targVal === 'true') (targVal as any) = true;
            else if (targVal === 'false') (targVal as any) = false;
            else if (targVal === 'null') (targVal as any) = null;
            else if (!isNaN(Number(targVal))) (targVal as any) = Number(targVal);
          }

          if (operator === '==' || operator === '=') return rawVal == targVal;
          if (operator === '!=') return rawVal != targVal;
          if (operator === '>') return Number(rawVal) > Number(targVal);
          if (operator === '<') return Number(rawVal) < Number(targVal);
          if (operator === '>=') return Number(rawVal) >= Number(targVal);
          if (operator === '<=') return Number(rawVal) <= Number(targVal);

          return true;
        });
      });
    }

    // Apply RETURN variable mapping
    let projected: any[] = [];
    if (returnVar === vVar) {
      projected = resultsList.map(item => item.v);
    } else if (returnVar === eVar) {
      projected = resultsList.map(item => item.e);
    } else {
      // Return combination
      projected = resultsList.map(item => ({ vertex: item.v, edge: item.e }));
    }

    // Deduplicate responses based on ID to avoid double-results
    const uniqueMap = new Map<string, any>();
    projected.forEach(item => {
      if (item && item._id) uniqueMap.set(item._id, item);
      else {
        // Non-object fallback
        uniqueMap.set(JSON.stringify(item), item);
      }
    });

    const finalResults = Array.from(uniqueMap.values());

    return {
      results: finalResults,
      stats: {
        executionTimeMs: Date.now() - startTime,
        fullCount: finalResults.length
      }
    };
  }

  // Private helpers to compile/interpret clauses
  private applyFilters(items: any[], varName: string, filterExpr: string, bindVars: Record<string, any>): any[] {
    // Split filter constraints by AND (simple support, does not handle deep OR parens)
    const constraints = filterExpr.split(/\s+AND\s+/i);

    return items.filter(item => {
      return constraints.every(clause => {
        // Supported syntax types:
        // 1. LIKE(x.content, "%text%", true)
        const likeMatch = clause.match(/LIKE\s*\(\s*(\s*\w+)\.(\w+)\s*,\s*(["'][^"']+["']|@\w+)\s*(?:,\s*(true|false))?\s*\)/i);
        if (likeMatch) {
          const [_, vName, prop, patternExpr, caseInsensitive] = likeMatch;
          if (vName !== varName) return true;
          let searchPattern = patternExpr.trim();
          if (searchPattern.startsWith('@')) {
            searchPattern = bindVars[searchPattern.slice(1)] || '';
          } else {
            searchPattern = searchPattern.replace(/^["']|["']$/g, '');
          }
          const itemVal = String(item[prop] || '');
          // convert % wildcard to regex
          const regexStr = searchPattern.replace(/%/g, '.*');
          const flags = caseInsensitive === 'false' ? '' : 'i';
          const reg = new RegExp(regexStr, flags);
          return reg.test(itemVal);
        }

        // 2. Simple comparison Operators (==, !=, >, <, >=, <=)
        const compMatch = clause.match(/(\w+)\.(\w+)\s*([=!<>]+)\s*(.*)/);
        if (compMatch) {
          const [_, vName, prop, operator, valueExpr] = compMatch;
          if (vName !== varName) return true;

          const actualValue = item[prop];
          let compareValueStr = valueExpr.trim();
          let compareValue: any = compareValueStr;

          // Resolve bind variable
          if (compareValueStr.startsWith('@')) {
            compareValue = bindVars[compareValueStr.slice(1)];
          } else {
            // strip quotes, numbers, bools
            compareValueStr = compareValueStr.replace(/^["']|["']$/g, '');
            if (compareValueStr === 'true') compareValue = true;
            else if (compareValueStr === 'false') compareValue = false;
            else if (compareValueStr === 'null') compareValue = null;
            else if (!isNaN(Number(compareValueStr))) compareValue = Number(compareValueStr);
            else compareValue = compareValueStr;
          }

          if (operator === '==' || operator === '=') return actualValue == compareValue;
          if (operator === '!=') return actualValue != compareValue;
          if (operator === '>') return Number(actualValue) > Number(compareValue);
          if (operator === '<') return Number(actualValue) < Number(compareValue);
          if (operator === '>=') return Number(actualValue) >= Number(compareValue);
          if (operator === '<=') return Number(actualValue) <= Number(compareValue);
        }

        return true;
      });
    });
  }

  private applySorting(items: any[], varName: string, sortExpr: string): any[] {
    // E.g. x.title DESC, x.level
    const criteria = sortExpr.split(',').map(s => s.trim());
    
    return items.sort((a, b) => {
      for (const crit of criteria) {
        const match = crit.match(/(\w+)\.(\w+)(?:\s+(ASC|DESC))?/i);
        if (match) {
          const [_, vName, prop, direction] = match;
          if (vName !== varName) continue;

          const isDesc = direction && direction.toUpperCase() === 'DESC';
          const valA = a[prop];
          const valB = b[prop];

          if (valA === undefined || valB === undefined) continue;

          if (valA < valB) return isDesc ? 1 : -1;
          if (valA > valB) return isDesc ? -1 : 1;
        }
      }
      return 0;
    });
  }

  private applyLimit(items: any[], limitExpr: string): any[] {
    const limits = limitExpr.split(',').map(l => parseInt(l.trim(), 10));
    if (limits.length === 2) {
      const [offset, count] = limits;
      return items.slice(offset, offset + count);
    } else if (limits.length === 1) {
      return items.slice(0, limits[0]);
    }
    return items;
  }

  private applyReturn(items: any[], varName: string, returnExpr: string): any[] {
    if (returnExpr === varName) {
      return items;
    }

    // Checking if it's an object projection: RETURN { name: x.title, file: x.source_file }
    if (returnExpr.startsWith('{') && returnExpr.endsWith('}')) {
      const keysAndVals = returnExpr.slice(1, -1).split(',').map(s => s.trim());
      return items.map(item => {
        const obj: Record<string, any> = {};
        keysAndVals.forEach(kv => {
          const [key, valPath] = kv.split(':').map(s => s.trim());
          const cleanKey = key.replace(/^["']|["']$/g, '');
          const pathMatch = valPath ? valPath.match(/(\w+)\.(\w+)/) : null;
          if (pathMatch) {
            const [_, vName, prop] = pathMatch;
            if (vName === varName) {
              obj[cleanKey] = item[prop];
            }
          } else {
            // direct shorthand
            const shorthandPath = key.match(/(\w+)\.(\w+)/);
            if (shorthandPath) {
              obj[shorthandPath[2]] = item[shorthandPath[2]];
            }
          }
        });
        return obj;
      });
    }

    // Attribute projection: RETURN x.title
    const attrMatch = returnExpr.match(/(\w+)\.(\w+)/);
    if (attrMatch) {
      const [_, vName, prop] = attrMatch;
      if (vName === varName) {
        return items.map(item => item[prop]);
      }
    }

    return items;
  }
}

// Global cached database simulated instance
let instance: ArangoDBSimulator | null = null;
export function getArangoDBSimulator(): ArangoDBSimulator {
  if (!instance) {
    instance = new ArangoDBSimulator();
  }
  return instance;
}
