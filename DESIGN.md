The following JavaScript script provides a schema setup for ArangoDB. It is designed to run in a Node.js environment using the official `arangojs` driver, but the schema definitions and collection options can also be adapted for internal Foxx services or Arangosh.

This schema models the **Open Knowledge Format (OKF)** and **DoCO (Document Components Ontology)** standards, incorporating:
1. **Document-level metadata vertices** (`okf_documents`).
2. **Structural, taxonomic, and semantic vertices** (`okf_nodes`) with support for hierarchical layers (chapters, sections, paragraphs), tags, alphabet indices, and embedded vectors.
3. **Bi-temporal and GeoJSON properties** nested within the vertex collections.
4. **Strongly typed edge collections** (`okf_edges`) that map structural parent-child flows, chronological next-sibling sequences, semantic links, and taxonomical indices.
5. **JSON Schema validation rules** and **multi-model indexes** (geo, array-based tags, temporal, and persistent).

```javascript
/**
 * Doc_Ohara: ArangoDB Multi-Model Schema Definition (OKF + DoCO)
 * File: setup_okf_schema.js
 * 
 * Requirements: Node.js, `arangojs` package.
 * Supported ArangoDB Version: 3.10+ (for modern JSON Schema and Vector/Search capabilities)
 */

import { Database } from 'arangojs';

// Initialize the connection (update credentials as necessary for your environment)
const db = new Database({
  url: "http://localhost:8529",
  databaseName: "doc_ohara_knowledge_base",
  auth: { username: "root", password: "password" }
});

// JSON Validation Schema for 'okf_documents'
const documentSchema = {
  rule: {
    type: "object",
    required: ["title", "owner", "temporal"],
    properties: {
      title: { type: "string", minLength: 1 },
      description: { type: "string" },
      owner: { type: "string" },
      version: { type: "string" },
      license: { type: "string" },
      metadata: { type: "object" },
      temporal: {
        type: "object",
        required: ["created_at", "updated_at"],
        properties: {
          created_at: { type: "string", format: "date-time" },
          updated_at: { type: "string", format: "date-time" }
        }
      }
    }
  },
  level: "strict",
  message: "Document metadata does not conform to the OKF specification schema."
};

// JSON Validation Schema for 'okf_nodes'
const nodeSchema = {
  rule: {
    type: "object",
    required: ["type", "doc_id", "temporal"],
    properties: {
      type: {
        type: "string",
        enum: [
          "Chapter", "Section", "Subsection", "Paragraph", "Table", "ListItem", 
          "Figure", "Concept", "Tag", "AlphabetIndexItem"
        ]
      },
      doc_id: { type: "string" }, // References the parent okf_documents key
      title: { type: "string" },
      content: { type: "string" }, // Markdown representation or extracted text
      
      // Spatial properties (Dual capability: Layout coordinate space + Geographic space)
      spatial: {
        type: "object",
        properties: {
          // Normalized layout coordinates: [page_num, [x1, y1], [x2, y2]]
          layout_box: {
            type: "object",
            required: ["page", "coordinates"],
            properties: {
              page: { type: "integer", minimum: 1 },
              coordinates: {
                type: "array",
                items: { type: "array", items: { type: "number" } }
              }
            }
          },
          // Standard GeoJSON for physical geographical tracking, if applicable
          geo_json: {
            type: "object",
            required: ["type", "coordinates"],
            properties: {
              type: { type: "string", enum: ["Point", "Polygon"] },
              coordinates: { type: "array" }
            }
          }
        }
      },

      // Bi-temporal version tracking and publication/historical validity
      temporal: {
        type: "object",
        required: ["extracted_at", "valid_from"],
        properties: {
          extracted_at: { type: "string", format: "date-time" },
          valid_from: { type: "string", format: "date-time" },
          valid_to: { type: "string", format: "date-time" } // Null if currently active
        }
      },

      // Array-based tagging directly on the node (fast retrieval)
      tags: {
        type: "array",
        items: { type: "string" }
      },

      // Dictionary/Alphabet indexing attributes (Fast index scanning)
      alphabet_index: {
        type: "object",
        properties: {
          key: { type: "string", minLength: 1, maxLength: 1 }, // e.g., "Q"
          keyword: { type: "string" } // e.g., "Qubit"
        }
      },

      // Multi-dimensional embedding array (e.g., 1536 dims for text-embedding-3-small)
      vector_embedding: {
        type: "array",
        items: { type: "number" }
      }
    }
  },
  level: "strict",
  message: "Node failed structural, spatial, or taxonomic JSON Schema validation."
};

// JSON Validation Schema for 'okf_edges'
const edgeSchema = {
  rule: {
    type: "object",
    required: ["_from", "_to", "relation"],
    properties: {
      relation: {
        type: "string",
        enum: [
          "HAS_CHILD",       // DoCO structural parent-child flow
          "NEXT_SIBLING",    // Chronological structural flow (Paragraph N -> Paragraph N+1)
          "HAS_TAG",         // Taxonomic node-to-tag grouping
          "INDEXED_UNDER",   // Taxonomic node-to-alphabet-index linking
          "REFERENCES",      // Semantic citation or cross-document linking
          "SUCCEEDS"         // Temporal sequencing of content updates/editions
        ]
      },
      confidence: { type: "number", minimum: 0, maximum: 1 }, // Used for LLM extraction confidence scores
      temporal: {
        type: "object",
        properties: {
          valid_from: { type: "string", format: "date-time" },
          valid_to: { type: "string", format: "date-time" }
        }
      }
    }
  },
  level: "strict",
  message: "Edge structure violation: missing origin, target, or invalid relation categorization."
};

async function createDatabaseInfrastructure() {
  try {
    // 1. Establish database
    const dbExists = await db.exists();
    if (!dbExists) {
      console.log(`Database does not exist. Please create: ${db.name}`);
      return;
    }
    console.log(`Connected to Database: ${db.name}`);

    // Helper to recreate or retrieve collections
    const setupCollection = async (name, type, schema) => {
      const col = db.collection(name);
      const exists = await col.exists();
      if (!exists) {
        if (type === 'document') {
          await db.createCollection(name, { schema });
        } else {
          await db.createEdgeCollection(name, { schema });
        }
        console.log(`Collection [${name}] created successfully.`);
      } else {
        console.log(`Collection [${name}] already exists. Updating schema validations...`);
        await col.properties({ schema });
      }
      return col;
    };

    // 2. Initialize Collections with Schema Validations
    const documentsCol = await setupCollection('okf_documents', 'document', documentSchema);
    const nodesCol = await setupCollection('okf_nodes', 'document', nodeSchema);
    const edgesCol = await setupCollection('okf_edges', 'edge', edgeSchema);

    // 3. Set Up Indexes for High-Performance Queries

    // Nodes Index - Document Reference (for grouping node elements)
    await nodesCol.ensureIndex({
      type: "persistent",
      fields: ["doc_id"],
      name: "idx_node_doc_ref"
    });

    // Nodes Index - Document Type (e.g., Chapter, Paragraph, Concept)
    await nodesCol.ensureIndex({
      type: "persistent",
      fields: ["type"],
      name: "idx_node_type"
    });

    // Nodes Index - Array Tag Indexing (Optimized array indexing for fast tag scans)
    await nodesCol.ensureIndex({
      type: "persistent",
      fields: ["tags[*]"],
      name: "idx_node_tags_array"
    });

    // Nodes Index - Alphabet Index Lookup
    await nodesCol.ensureIndex({
      type: "persistent",
      fields: ["alphabet_index.key", "alphabet_index.keyword"],
      name: "idx_alphabet_lookup"
    });

    // Nodes Index - Geographic Spatial Indexing (Enables geo-distance, intersection calculations)
    await nodesCol.ensureIndex({
      type: "geo",
      fields: ["spatial.geo_json"],
      name: "idx_geo_spatial"
    });

    // Nodes Index - Temporal Querying (For points in history queries)
    await nodesCol.ensureIndex({
      type: "persistent",
      fields: ["temporal.valid_from", "temporal.valid_to"],
      name: "idx_temporal_range"
    });

    // Edges Index - Edge Relation Classification
    await edgesCol.ensureIndex({
      type: "persistent",
      fields: ["relation"],
      name: "idx_edge_relation"
    });

    console.log("Indexes configured and initialized.");

    // 4. Configure ArangoSearch View (Hybrid Fulltext & Attribute Indexing)
    const viewName = "okf_search_view";
    const view = db.view(viewName);
    const viewExists = await view.exists();

    const viewProperties = {
      links: {
        "okf_nodes": {
          includeAllFields: false,
          fields: {
            "title": { analyzers: ["text_en"] },
            "content": { analyzers: ["text_en"] },
            "tags": { analyzers: ["identity"] }
          }
        }
      }
    };

    if (!viewExists) {
      await db.createView(viewName, {
        type: "arangosearch",
        ...viewProperties
      });
      console.log(`ArangoSearch View [${viewName}] created.`);
    } else {
      await view.properties(viewProperties);
      console.log(`ArangoSearch View [${viewName}] properties synchronized.`);
    }

    console.log("Database and collection infrastructure setup completed successfully.");

  } catch (error) {
    console.error("An error occurred during database setup:", error.message);
  }
}

// Execute deployment
createDatabaseInfrastructure();
```

### Key Elements of This Design
* **Array-Based Multi-Index (`tags[*]`)**: Rather than standard indexing, using `tags[*]` allows ArangoDB to natively index the individual strings inside the tag array, accelerating multi-tag aggregation operations.
* **Dual Spatio-Temporal Model**: 
  * The `spatial` property is split into layout coordinates (for PDF spatial box highlighting) and standard GeoJSON (for physical geocoding on maps).
  * The `temporal` schema facilitates bitemporal tracing, allowing historical versions to maintain parent/child integrity without overriding newer document extractions.
* **Schema Validation Engine**: The script leverages ArangoDB's engine-level validation to prevent poorly structured metadata or malformed edge configurations from compromising the integrity of the graph structure.

This document details the retrieval engine design for Project `Doc_Ohara` using the schema defined in the previous phase. To process an unstructured description, extract key elements, and conduct a resource-conscious search, we implement a **Two-Step Retrieval Engine** utilizing ArangoDB's hybrid query capabilities (ArangoSearch, Vector similarity, and Graph traversal).

---

### Retrieval Architecture Overview

```
   [ User Input String ]
             │
             ▼
┌───────────────────────────────────────────┐
│     Phase 0: Input Parsing & Embedding    │
│  - Extract: Entities, Tags, Keywords     │
│  - Compute: Query Vector Embedding       │
└───────────────────────────────────────────┘
             │
             ▼
┌───────────────────────────────────────────┐
│        Phase 1: Shallow Context           │
│  - Hybrid Search (Vector + Text + Tag)    │
│  - Score calculation & Deduplication      │
│  - Expose expandable graph directions     │
└───────────────────────────────────────────┘
             │
             ▼  (User/Agent choice of direction)
┌───────────────────────────────────────────┐
│         Phase 2: Deep Context             │
│  - Target node-specific graph expansion   │
│  - High-depth traversals (Up/Down/Sibs)    │
│  - Geo-spatial bounding box filtering     │
└───────────────────────────────────────────┘
```

---

### Node.js Implementation: `RetrievalEngine`

This module outlines the full end-to-end logic. It includes the exact **AQL (ArangoDB Query Language)** queries for executing Phase 1 (hybrid text/vector scoring with structural look-aheads) and Phase 2 (deep-dive structural, temporal, and semantic traversal) [3].

```javascript
/**
 * Doc_Ohara: Hybrid Graph-Vector Retrieval Engine
 * File: retrieval_engine.js
 */

import { Database, aql } from 'arangojs';

// Initialize the connection to the established OKF collection database
const db = new Database({
  url: "http://localhost:8529",
  databaseName: "doc_ohara_knowledge_base",
  auth: { username: "root", password: "password" }
});

export class RetrievalEngine {
  constructor(llmClient) {
    this.llm = llmClient; // Placeholder for an LLM client (e.g., OpenAI, Anthropic, or local model)
  }

  /**
   * Phase 0: Preprocessing and Semantic Expansion
   * Uses an LLM to decompose unstructured query input into structured entities, tags, and keywords,
   * alongside its corresponding vector embedding representation.
   */
  async preprocessInput(rawInput) {
    // 1. Generate text embedding vector
    const vectorEmbedding = await this.llm.embeddings.create({
      model: "text-embedding-3-small", // 1536 dimensions
      input: rawInput,
    });

    // 2. Perform entity, tag, and keyword extraction via structured tool use
    const extraction = await this.llm.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `Deconstruct the input query into structured components for search. 
          Return a JSON object with: 
          - "tags" (Array of matching ontology categories or topics, lowercased, single words), 
          - "keywords" (Array of descriptive terms, unigrams/bigrams), 
          - "entities" (Array of critical proper nouns, technical systems, or names).`
        },
        { role: "user", content: rawInput }
      ]
    });

    const parsedExtraction = JSON.parse(extraction.choices[0].message.content);

    return {
      vector: vectorEmbedding.data[0].embedding,
      tags: parsedExtraction.tags || [],
      keywords: parsedExtraction.keywords || [],
      entities: parsedExtraction.entities || []
    };
  }

  /**
   * Phase 1: Shallow Context Retrieval
   * Combines BM25 Text Search, Vector Cosine Similarity, and Tag Intersections inside
   * an ArangoSearch execution. Returns highly relevant distinct nodes and computes 
   * "expandable directions" (structural siblings, parents, tags) for downstream navigation.
   */
  async getShallowContext(processedQuery, options = {}) {
    const limit = options.limit || 5;
    const threshold = options.threshold || 0.35;
    
    // Weights for composite scoring
    const wVector = options.wVector || 0.50;
    const wText = options.wText || 0.30;
    const wTags = options.wTags || 0.20;

    const query = aql`
      // Search matching nodes across indexed attributes in the ArangoSearch View
      FOR doc IN okf_search_view
        SEARCH 
          ANALYZER(doc.content IN TOKENS(${processedQuery.keywords.join(" ")}, "text_en"), "text_en")
          OR doc.tags ANY IN ${processedQuery.tags}
          OR doc.title IN TOKENS(${processedQuery.entities.join(" ")}, "text_en")

        // 1. Calculate Vector Proximity (Cosine Similarity)
        LET vectorScore = COSINE_SIMILARITY(doc.vector_embedding, ${processedQuery.vector})
        
        // 2. Calculate Keyword Density Score (BM25)
        LET textScore = BM25(doc)
        
        // 3. Calculate Tag Overlap Density
        LET tagScore = LENGTH(INTERSECTION(doc.tags, ${processedQuery.tags}))
        
        // 4. Compute composite scored relevance
        LET compositeScore = (vectorScore * ${wVector}) + (textScore * ${wText}) + (tagScore * ${wTags})
        
        FILTER compositeScore >= ${threshold}
        SORT compositeScore DESC
        LIMIT ${limit * 2} // Pull more for deduplication and structure gathering

        // Structural and Semantic Expandable Directions Subquery
        // Finds what relationships this node directly shares, so downstream agents know where they can expand.
        LET directions = (
          FOR v, e IN 1..1 ANY doc._id okf_edges
            RETURN {
              relation: e.relation,
              target_id: v._id,
              target_type: v.type,
              target_title: v.title
            }
        )

        // Group directions to summarize expansion pathways
        LET expandable_directions = {
          has_parent: FIRST(FOR d IN directions FILTER d.relation == "HAS_CHILD" RETURN d.target_id),
          next_sibling: FIRST(FOR d IN directions FILTER d.relation == "NEXT_SIBLING" RETURN d.target_id),
          tags: (FOR d IN directions FILTER d.relation == "HAS_TAG" RETURN d.target_title),
          semantic_references: (FOR d IN directions FILTER d.relation == "REFERENCES" RETURN { id: d.target_id, title: d.target_title }),
          temporal_updates: (FOR d IN directions FILTER d.relation == "SUCCEEDS" RETURN d.target_id)
        }

        // Return a clean representation of the nodes matching the query
        RETURN {
          node: {
            id: doc._id,
            type: doc.type,
            title: doc.title,
            content: doc.content,
            doc_id: doc.doc_id,
            tags: doc.tags,
            spatial: doc.spatial,
            temporal: doc.temporal
          },
          relevance_score: compositeScore,
          expandable_directions: expandable_directions
        }
    `;

    const cursor = await db.query(query);
    const results = await cursor.all();

    // Distinct/Deduplicate process: limit results per document to ensure topological diversity
    const seenDocs = new Set();
    const diverseResults = [];

    for (const item of results) {
      if (!seenDocs.has(item.node.doc_id) || diverseResults.length < limit / 2) {
        diverseResults.push(item);
        seenDocs.add(item.node.doc_id);
      }
      if (diverseResults.length >= limit) break;
    }

    return diverseResults;
  }

  /**
   * Phase 2: Deep Context Retrieval
   * Retrieves deeper structured context based on a selected target node and an "expandable direction".
   * This executes targeted multi-hop graph traversals or spatial constraint queries depending on input.
   */
  async getDeepContext(startNodeId, direction, options = {}) {
    const depth = options.depth || 2;
    let query;

    switch (direction) {
      case 'structural_hierarchy':
        // Traverse structural bounds (up to parents, down to sections and paragraphs)
        query = aql`
          FOR v, e, p IN 1..${depth} ANY ${startNodeId} okf_edges
            FILTER e.relation == "HAS_CHILD"
            RETURN {
              node: { id: v._id, type: v.type, title: v.title, content: v.content },
              edge: e.relation,
              depth: LENGTH(p.edges)
            }
        `;
        break;

      case 'sequential_narrative':
        // Follow the sibling chain to fetch preceding or succeeding paragraphs
        query = aql`
          FOR v, e, p IN 1..${depth} OUTBOUND ${startNodeId} okf_edges
            FILTER e.relation == "NEXT_SIBLING"
            RETURN {
              node: { id: v._id, type: v.type, title: v.title, content: v.content },
              edge: e.relation,
              depth: LENGTH(p.edges)
            }
        `;
        break;

      case 'semantic_web':
        // Follow references, citations, and metadata tagging layers
        query = aql`
          FOR v, e, p IN 1..${depth} ANY ${startNodeId} okf_edges
            FILTER e.relation IN ["REFERENCES", "HAS_TAG"]
            RETURN {
              node: { id: v._id, type: v.type, title: v.title, content: v.content },
              edge: e.relation,
              depth: LENGTH(p.edges)
            }
        `;
        break;

      case 'spatial_proximity':
        // Query elements located physically close to the target node's physical geo coordinate
        if (!options.targetGeoPoint) {
          throw new Error("Spatial queries require a targetGeoPoint coordinate option [longitude, latitude].");
        }
        const maxDistanceMeters = options.maxDistance || 10000;
        query = aql`
          FOR doc IN okf_nodes
            FILTER doc.spatial != null && doc.spatial.geo_json != null
            LET distance = DISTANCE(
              doc.spatial.geo_json.coordinates[1], 
              doc.spatial.geo_json.coordinates[0], 
              ${options.targetGeoPoint[1]}, 
              ${options.targetGeoPoint[0]}
            )
            FILTER distance <= ${maxDistanceMeters}
            SORT distance ASC
            RETURN {
              node: { id: doc._id, type: doc.type, title: doc.title, content: doc.content, spatial: doc.spatial },
              distance_meters: distance
            }
        `;
        break;

      default:
        throw new Error(`Unsupported expansion direction: ${direction}`);
    }

    const cursor = await db.query(query);
    return await cursor.all();
  }
}
```

---

### Execution Example

The execution of this module is demonstrated below. This shows how an agent takes raw text, parses it, extracts shallow context with navigational paths, and then executes a deep graph expansion on the user's targeted direction:

```javascript
// Example Usage Execution Block
async function runDemo() {
  const llmStub = {}; // Inject actual OpenAI API wrapper or equivalent client
  const engine = new RetrievalEngine(llmStub);

  // Raw Input
  const userInput = "Show me quantum superposition and how it connects to qubits in Dr. Jenkins' lab.";

  console.log("Analyzing and vectorizing input...");
  const processedQuery = await engine.preprocessInput(userInput);
  /* 
    Resulting object schema:
    {
       vector: [0.123, -0.456, ...],
       tags: ["quantum_computing", "physics"],
       keywords: ["superposition", "qubits"],
       entities: ["Dr. Jenkins"]
    }
  */

  console.log("Step 1: Fetching Shallow Context...");
  const shallowResults = await engine.getShallowContext(processedQuery, { limit: 3 });
  console.dir(shallowResults, { depth: null });

  /*
    Shallow Context Output contains nodes with structured directional pointers:
    [
      {
        node: { id: "okf_nodes/node_para_112", type: "Paragraph", title: "1.1 Superposition Principles", ... },
        relevance_score: 0.84,
        expandable_directions: {
          has_parent: "okf_nodes/node_sec_1_1",
          next_sibling: "okf_nodes/node_para_113",
          tags: ["quantum_mechanics", "qubits"],
          semantic_references: [{ id: "okf_nodes/concept_qubit", title: "Concept: Qubit" }]
        }
      }
    ]
  */

  if (shallowResults.length > 0) {
    const targetNodeId = shallowResults[0].node.id;
    console.log(`Step 2: Deep Context Traversal on node ${targetNodeId} following semantic paths...`);
    
    const deepResults = await engine.getDeepContext(targetNodeId, 'semantic_web', { depth: 2 });
    console.dir(deepResults, { depth: null });
  }
}
```