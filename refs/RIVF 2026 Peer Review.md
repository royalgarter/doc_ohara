# **Technical Peer Review Report: OHARA Architecture for RIVF 2026 Submission**

## **Executive Meta-Review and Evaluation Overview**

This report provides a formal technical peer review of the manuscript titled "Efficient Visualization of Knowledge Bases via Space-Time Graphs: The OHARA Architecture"1, target-submitted for presentation at the 20th IEEE International Conference on Computing and Communication Technologies (RIVF 2026\) in Hanoi, Vietnam2.  
The paper introduces OHARA, an integrated retrieval-augmented generation (RAG) and information visualization framework designed to bridge the structural divide between dense vector retrieval engines and human visual cognitive processing1. The system structures unstructured text and domain ontologies into a unified 5-tuple Space-Time Graph substrate1. The architecture addresses two pervasive challenges in enterprise knowledge management: the loss of spatial and temporal macro-context in standard flat-chunk RAG pipelines, and high hallucination rates in generative question-answering systems operating under unanswerable or ambiguous queries1.

| Review Dimension | Evaluation Rating | Summary Assessment |
| :---- | :---- | :---- |
| **Originality & Innovation** | High / Acceptable | Strong novel synthesis of Document Components Ontology (DoCO) structural hierarchy, SUMO domain ontology, and exponential temporal decay into a 3D visual substrate1. |
| **Technical Soundness** | Sound with Caveats | Mathematical modeling is rigorous1; however, empirical retrieval evaluation exhibits tuned-on-test exposure on QASPER and baseline metric heterogeneity1. |
| **Empirical Rigor** | Moderate / Honest | Exemplary disclosure of system limitations, edge duplication bugs, and cost parameters1, though lacking statistical significance tests across baseline runs1. |
| **Clarity & Presentation** | High | Outstanding layout, precise mathematical formulations, detailed algorithmic workflows, and clear presentation of operational trade-offs1. |
| **RIVF 2026 Track Fit** | Excellent | Highly aligned with Track 1 (AI Foundations and Big Data) and Track 2 (AI Applications)3. |

## **Comprehensive Technical Summary**

The manuscript tackles the spatial and temporal disorientation caused by linear, flat-chunk RAG architectures1. Standard chunking methods segment documents into disjointed text blocks, stripping away document structural context and publication timelines1. This design forces Large Language Models (LLMs) and human analysts to inspect isolated text blocks without macro-level topological context, compounding memory degradation and context walls1.  
To overcome these structural limitations, the authors formulate the Space-Time Graph substrate as a 5-tuple mathematical model:  
![][image1]  
The components of this graph substrate are rigorously defined to maintain document integrity and cross-document relationships1:

* The vertex set ![][image2] partitions candidates into document roots, structural section nodes, content paragraphs or tables, and named entity nodes1.  
* Directed edges ![][image3] span seven explicit directed relationship types: ![][image4]1. These edges connect structural document trees, cross-cutting semantic links, and Jaccard-gated cross-document relationships1.  
* The temporal mapping function ![][image5] positions documents chronologically along a visual 3D Z-axis1.  
* The temporal decay classifier ![][image6] categorizes documents across four functional decay classes: EVERGREEN (![][image7]), SCHOLARLY (![][image8]), CURRENT (![][image9]), and EPHEMERAL (![][image10])1.  
* The ontological grounding function ![][image11] anchors structural nodes into the Standard Upper Merged Ontology (SUMO) taxonomy via a 22,700-entry validated index1.

The system executes a dual-stage operational model comprising an offline parsing and rendering pipeline and an online hybrid retrieval engine1. During offline ingestion, input documents in PDF, EPUB, or DOCX format are parsed via LiteParse and mapped into Document Components Ontology (DoCO) node hierarchies using content-hash-cached LLM processing with gemini-2.5-flash-lite1. Extracted entities are normalized, and cross-document Jaccard similarity thresholds trigger the creation of SIMILAR\_TO edges enriched with LLM-generated narrative summaries1.  
The offline graph is rendered interactively via Three.js using InstancedMesh batching1. The visual renderer separates spatial coordinates into three explicit dimensions: the Z-axis maps publication dates chronologically into bucketed visual layers; the XY polar plane distributes document root coordinates according to SUMO category classifications calculated via ![][image12]; and local radial discs unfold each document perpendicularly to the Z-axis, placing section nodes in concentric inner rings and content paragraphs along the outer perimeter1.  
The online retrieval engine processes incoming queries through an eight-phase candidate pipeline1:

> 1. **Phase 0 (Query Fingerprinting)**: Classifies query intent, extracts SUMO tags, entity hints, and temporal constraints1.  
> 2. **Phase 0b (TOC Selection)**: Executes LLM traversal over seed document tables of contents to establish structural entry points1.  
> 3. **Phase 1 (BM25 Full-Text)**: Extracts lexical match scores across content nodes1.  
> 4. **Phase 1b (SUMO Overlap)**: Filters candidates via ontology hierarchy tag expansion1.  
> 5. **Phase 1c (Multi-Hop Traversal)**: Traverses SIMILAR\_TO edges carrying narrative verbs and summaries1.  
> 6. **Phase 1d (Dense Vector Similarity)**: Evaluates candidate cosine similarity via gemini-embedding-2 (768-dimensional vectors)1.  
> 7. **Phase 2 (Entity Pivot)**: Segments and pivots across shared canonical entity nodes1.  
> 8. **Phase 3 (Structural Traversal)**: Traverses local structural tree paths up to depth 2 with corrective zero-SUMO-overlap filtering1.

In Phase 4, candidate scores are normalized and combined via weighted summation scaled by query mode multipliers1. Candidates are partitioned into functional tiers: the Principal Tier (requiring ![][image13] independent signal sources, scores above the 75th percentile, and cross-document evidence), the Integrity Tier (direct structural or cross-document neighbors attached to Principal nodes), and the Explorer Tier (metadata-only frontier nodes evaluated within a weakening weight band)1.

## **Detailed Technical Merits and Architectural Strengths**

The primary architectural innovation of OHARA lies in unifying structural hierarchy, domain ontology, and temporal decay into a single data model1. Prior graph-based RAG frameworks, such as GraphRAG, LightRAG, and HippoRAG, isolate graph extraction to entity-relation triplets or community summaries1. In doing so, they discard document-level Document Components Ontology (DoCO) trees and physical document topologies1. OHARA bridges this structural gap, demonstrating that preserving document section and paragraph hierarchies enables localized structural traversals that restore contextual continuity missing from standard vector search1.

| Architectural Feature | GraphRAG | LightRAG | HippoRAG | OHARA |
| :---- | :---- | :---- | :---- | :---- |
| **Entity/Relation Subgraph** | Full | Full | Full | Full |
| **Structural Hierarchy (DoCO)** | Absent | Absent | Absent | Full |
| **Cross-Document Similarity Edges** | Partial | Partial | Full | Full (Jaccard \+ Narrative) |
| **SUMO Ontology Grounding** | Absent | Absent | Absent | Full (22,700 Index) |
| **Temporal Decay Scoring** | Absent | Absent | Absent | Full (4-Class Decay) |
| **3D Space-Time Visualization** | Absent | Absent | Absent | Full (Three.js Tunnel) |
| **Tiered Abstention Engine** | Absent | Absent | Absent | Full (Corroboration Gated) |

A major contribution of the framework is its corroboration-gated abstention mechanism1. Standard RAG systems enforce rigid top\-![][image14] cutoffs, forcing language models to generate answers even when the retrieved context lacks relevant evidence1. OHARA addresses this by requiring candidate nodes in the Principal tier to receive corroborating evidence from more than two independent retrieval signals1.  
When evaluated on the MultiHop-RAG benchmark (comprising 500 stratified queries, including 125 null or unanswerable queries), the corroboration constraint allowed the pipeline to abstain on 45.6% (57 out of 125\) of unanswerable queries1. Standard top\-![][image14] dense retrieval filtering failed to abstain on any unanswerable queries (0.0% abstention)1. The manuscript notes that this abstention mechanism operates independently of ranking quality: removing the corroboration constraint alters Hits@10 and MRR@10 by under 0.5 points, proving that the mechanism acts as a true abstention gate rather than an aggressive rank filter1.  
The paper also demonstrates intellectual honesty in its reporting1. Rather than claiming absolute ranking superiority over vector retrieval, the author acknowledges that OHARA achieves ranking *parity* with single dense vector search while offering visual inspectability and explicit provenance1. Furthermore, the author explicitly discloses potential evaluation risks, including a tuned-on-test exposure during QASPER hyperparameter optimization, small sample sizes in Three.js rendering latency trials, and partial edge duplication bugs during non-idempotent re-ingestion passes1.

## **Technical Weaknesses, Methodological Risks, and Open Questions**

### **Coarse-to-Fine Macro-Document Localization Bottleneck**

A critical analytical finding in Section VII-A reveals that approximately 42% of corpus-wide retrieval errors on the QASPER dataset occur during initial macro-document location rather than micro-paragraph selection1. To manage computational complexity, OHARA executes a coarse-to-fine pre-filtering workflow prior to fine-grained structural descent1. In this workflow, paragraph-level entity slugs and SUMO tags are aggregated onto the document root node ![][image15] in an ![][image16] scanning pass, pruning low-scoring document roots before inspecting content chunks1.  
This design creates an unrecoverable failure cascade1. Aggregating diverse paragraph tags onto a single document root can dilute specific semantic signals1. If a document root is falsely pruned during the macro pre-filtering stage due to a diluted aggregate score, all downstream structural and vector traversals across its constituent sections and paragraphs are permanently blocked1. Once a target document root is eliminated, downstream micro-traversals (Phases 1–3) cannot recover the missing context1. The manuscript would be strengthened by evaluating whether a parallel macro-micro retrieval loop—where high-confidence micro-vector hits can rescue falsely pruned document roots—mitigates this 42% localization failure rate1.

### **Evaluation Protocol Incompatibility with Existing Graph-RAG Baselines**

To address the absence of direct empirical comparisons against established graph-RAG architectures, the authors evaluated LightRAG reconfigured with identical Gemini models on both QASPER and MultiHop-RAG corpora1. However, as disclosed in the footnotes of Tables II and III, LightRAG's context extraction was evaluated using unranked answer-string presence within an uncapped context blob rather than document-level top\-![][image14] ranking1.  
This metric mismatch limits the direct comparability of the results1. LightRAG outputs unranked context fragments directly into an LLM prompt without returning distinct document ranking IDs1. Consequently, standard ranking metrics such as Hits@10, MRR@10, and Principal-Hit rates remain undefined for the baseline1. While the report correctly notes that this comparison provides directional context on answer availability, evaluating LightRAG under a non-comparable protocol prevents definitive conclusions regarding relative context efficiency1.

### **Misalignment Between Publication Recency and Event Chronology**

The framework incorporates an exponential temporal decay function ![][image17] designed to penalize older candidates based on their publication age ![][image18]1. However, empirical findings in Section VII-B show that disabling temporal decay slightly *improves* Mean Reciprocal Rank (MRR) on temporal query slices (0.749 without decay versus 0.736 with decay)1.  
This performance drop stems from confounding document publication timestamps with narrative event timestamps1. In academic literature (QASPER) and multi-hop news analysis (MultiHop-RAG), historical documents often contain foundational definitions, baseline methodologies, or primary event descriptions that remain essential regardless of publication age1. Decaying relevance based solely on publication recency systematically penalizes foundational historical evidence1. The temporal decay formula requires an event-extraction layer capable of distinguishing document publication date from internal narrative event dates1.

### **Visual Scalability and Cognitive Overhead Constraints**

The interactive 3D visual renderer maps documents into polar coordinates and temporal Z-tunnels using Three.js InstancedMesh batching1. Headless WebGL benchmarks show that rendering latency scales sub-linearly from 1.5 seconds at 713 nodes to 2.3 seconds at 12,323 nodes1.  
However, system scalability is bound by human visual density rather than WebGL geometry generation1. As noted in Section VIII, visual clutter becomes severe beyond approximately 50 active document discs1. While Three.js handles the geometry rendering efficienty, human analysts experience cognitive fatigue when attempting to interpret overlapping radial discs, polar projections, and decay visual auras across dense corpora1. Without automated camera framing, dynamic disc occlusion, or adaptive Level-of-Detail (LOD) aggregation, the visual interface risks becoming unnavigable when scaled to large enterprise repositories1.

## **Quantitative Empirical Evaluation and Benchmark Analysis**

The empirical performance of OHARA was benchmarked across two distinct corpora: QASPER (comprising 200 academic papers, 150 answerable questions, and 229 total documents including distractors) and MultiHop-RAG (comprising 609 news articles and 500 stratified queries)1.

| Benchmark Corpus | Candidate Pipeline Configuration | Hits@4 | Hits@10 | MRR@10 | MAP | Principal Hit Rate | Null Query Abstention |
| :---- | :---- | :---- | :---- | :---- | :---- | :---- | :---- |
| **QASPER** | BM25-Only1 | 12.7% | 25.3% | 0.102 | \- | 0.0% | \- |
| **QASPER** | Vector-Only (gemini-embedding-2)1 | 26.7% | 33.3% | 0.175 | \- | 24.7% | \- |
| **QASPER** | Full Fusion (Default Weights)1 | 22.0% | 30.0% | 0.164 | \- | 22.7% | \- |
| **QASPER** | Full Fusion (Tuned Weights: 0.6 BM25, 1.0 Vector)1 | 25.3% | 33.3% | 0.179 | \- | 22.7% | \- |
| **QASPER** | LightRAG (Gemini Baseline; Context Recall)1 | \- | 34.7%\* | \- | \- | Unranked | Unranked |
| **MultiHop-RAG** | BM25-Only1 | \- | 94.4% | 0.727 | \- | 4.3% | 96.8%\* |
| **MultiHop-RAG** | Vector-Only (gemini-embedding-2)1 | \- | 98.4% | 0.811 | 0.538 | 92.5% | 13.6% |
| **MultiHop-RAG** | Full Fusion (Default Weights)1 | \- | 96.5% | 0.791 | \- | 91.5% | 45.6% |
| **MultiHop-RAG** | Full Fusion (Corroboration Gated)1 | \- | 96.8% | 0.795 | \- | 92.0% | 0.0% |
| **MultiHop-RAG** | Full Fusion (Tuned Weights)1 | \- | 98.4% | 0.812 | 0.556 | 92.0% | 31.2% |
| **MultiHop-RAG** | LightRAG (Gemini Baseline; Answer Recall)1 | \- | 68.0%\* | \- | \- | Unranked | Unranked |

\*Note: LightRAG scores reflect unranked context/answer-string recall metrics due to structural differences in retrieval output format1. BM25-only abstention on MultiHop-RAG (96.8%) reflects a near-empty Principal tier rather than selective discrimination1.  
Downstream generation checks using gemini-2.5-flash-lite yielded 54% accuracy for tuned hybrid fusion versus 57% for pure vector-only retrieval1. Diagnostic analysis revealed that context omission accounted for 41% of generation failures, confirming that generation accuracy is strictly bounded by macro-document retrieval coverage1.

## **Conference Scope Alignment and RIVF 2026 Policy Compliance**

RIVF 2026 is an established international conference co-sponsored by IEEE and hosted at VinUniversity in Hanoi, Vietnam2. Evaluating the manuscript against official RIVF 2026 submission guidelines demonstrates full compliance across layout, structural, and topical requirements3:

| Guideline Parameter | RIVF 2026 Official Requirement | Manuscript Status | Review Compliance |
| :---- | :---- | :---- | :---- |
| **Paper Length** | Up to 6 pages total3 | Exactly 5 pages plus references1 | Fully Compliant |
| **Document Formatting** | IEEE standard A4 (IEEEtran LaTeX)3 | Uses \\documentclass\[conference,a4paper\]{IEEEtran} \[cite: 1, 3\] | Fully Compliant |
| **PDF Specifications** | PDF minor version 6 (\\pdfminorversion=6)3 | Verified PDF specification1 | Fully Compliant |
| **Language & Originality** | Original research written in English3 | Original contribution in English1 | Fully Compliant |
| **Track Alignment** | Track 1 (AI Foundations) / Track 2 (AI Applications)3 | Direct fit for Knowledge Discovery and Explainable AI1 | Fully Compliant |
| **Submission Portal** | Managed via EDAS platform2 | Formatted for EDAS paper processing2 | Fully Compliant |

## **Reviewer Scoring and Actionable Revision Roadmap**

Synthesizing the evaluation across core academic criteria yields the following scoring profile:

| Review Evaluation Criteria | Numerical Score (1–5 Scale) | Summary Review Rationale |
| :---- | :---- | :---- |
| **Novelty & Architectural Design** | 5 / 5 | Exemplary integration of DoCO trees, SUMO ontology, and 3D visual space-time tunnels into a unified graph substrate1. |
| **Technical & Mathematical Rigor** | 4 / 5 | Precise mathematical formulation of graph constructs1; score penalized slightly due to the 42% macro-localization bottleneck1. |
| **Empirical Evaluation Quality** | 3 / 5 | Transparent reporting of limitations1, but impacted by tuned-on-test exposure on QASPER and protocol mismatch with LightRAG1. |
| **Clarity, Layout & Style** | 5 / 5 | Excellent structure, compliant with IEEE conference formatting1, and well-rendered figures1. |
| **Relevance to RIVF 2026** | 5 / 5 | Directly aligns with conference priorities in AI foundations, big data analytics, and interpretable AI3. |

To elevate the manuscript prior to final camera-ready submission for RIVF 20263, the authors should complete the following revision roadmap:

> 1. **Re-evaluate QASPER Fusion Weights via Cross-Validation**: To eliminate the tuned-on-test risk acknowledged in Section VII-A1, replace the single 75-query subset grid search with a 5-fold cross-validation scheme over the 150 QASPER queries1. Explicitly report train, validation, and test performance metrics across folds to demonstrate weight stability1.  
> 2. **Normalize LightRAG Baseline Metrics**: Re-evaluate the LightRAG baseline by mapping its retrieved text fragments back to parent document IDs1. This will enable true document-level Hits@10 and MRR@10 metrics, providing a direct, ranked comparison against OHARA1.  
> 3. **Mitigate Coarse Pre-Filtering Failures**: Address the \~42% macro-document selection failure rate1 by implementing a parallel micro-chunk vector search alongside the coarse document rollup pass during Phase 0/11. Allowing high-confidence micro-chunks to rescue falsely pruned document roots will prevent early elimination of target documents1.  
> 4. **Implement Adaptive Visual Level-of-Detail (LOD)**: Address visual clutter beyond 50 active document discs in the Three.js renderer1 by introducing dynamic LOD node aggregation. Document discs located outside the active camera view should automatically collapse into generalized category spheres, preserving scene readability as node counts scale1.  
> 5. **Decouple Event Chronology from Publication Recency**: Update the temporal decay function ![][image19]1 by incorporating an automated event-extraction model that calculates decay based on narrative event dates rather than raw document publication dates1.

## **Final Recommendation**

* **Final Review Decision**: **Accept with Minor Revisions**  
* **Publication Target**: IEEE Xplore / RIVF 2026 Conference Proceedings3

The manuscript presents a rigorous, original, and transparent contribution to knowledge base visualization and retrieval-augmented generation1. While empirical baseline comparisons and visual scalability require minor refinements1, the OHARA architecture establishes a strong foundation for auditable, human-navigable knowledge management systems1. The paper is recommended for acceptance at RIVF 2026, contingent upon addressing the evaluation and structural localization points outlined in this review prior to the camera-ready deadline on November 11, 20263.

#### **Works cited**

> 1. paper\_rivf2026.pdf  
> 2. RIVF 2026, [https://rivf2026.org/](https://rivf2026.org/)  
> 3. Call for Papers \- RIVF 2026, [https://rivf2026.org/call-for-papers.html](https://rivf2026.org/call-for-papers.html)  
> 4. RIVF 2026: International Conference on Computing and Comm, [https://www.myhuiban.com/conference/4479](https://www.myhuiban.com/conference/4479)  
> 5. Program \- RIVF 2026, [https://rivf2026.org/program.html](https://rivf2026.org/program.html)  
> 6. RIVF: Rencontres en Informatique Vietnam-France 2027 2026 2025, [http://www.wikicfp.com/cfp/program?id=2487\&f=Rencontres%20en%20Informatique%20Vietnam-France](http://www.wikicfp.com/cfp/program?id=2487&f=Rencontres+en+Informatique+Vietnam-France)  
> 7. Call for Papers | 2026 International Conference on Advanced, [https://atc-conf.org/call-for-papers/call-for-papers](https://atc-conf.org/call-for-papers/call-for-papers)

[image1]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAmwAAAAxCAYAAABnGvUlAAAD9UlEQVR4Xu3cS6h9UxwH8CUUUZ6FUv4IeeSRKIUkSomBKMVAGShRIo+8RpRSwkQZyCPKIwaSwuAWyWMsZfQnMhADUUphfdtn37POuud/z7nOSVd9PvXtnr32Oufse0a/fmuvXQoAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAALAb7F9zec2PNXtrzqs5veaxZs6qDqt5Y/L6qJrnJ7l1c0Yp907Gnqg5vBmfZ3z/vKzToTVv1/xRc2p3blnX1dzVDwIA7MSnNV/U7Dc5frPml5rbNmes7v5JIgXiazV/lqEgGp1U81nNcZM52zmlDNd8WhnmJw/U/NxOWoPzJ3/PqDmkPbEDB9a83A8CACwjXa+PytDxaqVI+aTm6G58FW/VHNAcp+v0d3Mc6Y4d343ty7Vl9v0nluHzn2rG1iGfmetK0bWK/JYX9YMAAIuk49UXTZGC7Zky7bitKkXP3d3YFTV/dWM3dMfbebxMu2kH1zxdhu/J527nsprrmyzqmuU3yG90T39ijsy9pkw/++oy/fyc638DAICFvqr5uh/cRpYpx+XHedlXF+qIMhQyrRSFvzfHZ5ah8FrWRs0PNTeWYbnx9Zmz851bhuKrzTkzM2al2/dBGb7r+9lTWxxbhnvd2s/+psze9/ZS8xoAYCkpKh5sjnMP2Hjj/pM1xzTnVpFibrwXbJQlwhSMuYcty5s77T7l2rOsGnfWXFxzcs2lmzNmpZhMtyudrmU3JnxZhmKzLy7nyf1049Jyruvb5txoo8zeswcAsFCWJMeNAJGCIx2nd8tyN/4va17BlsJlowydtRfK1vvoFslyaHayxtll6M49UnPW5oz5UoR+2A/OkeLu2cnrXPve6akt8r9kiXaU1x83x6ONomADAHbovppfm+N0odJ9uqAZW4cUKWM3rJXC5rkyuxmhlaXOn/rBMhRqYzE1yi7Oq5rjh2uubI5Hed+r/WAZdqy289OJG7uPWW69efI615rrSqE5OqhM/79bylAQZkNHr79mAICFUqDl2Wd5jMdNZegA5VEe69wdOmo7UKN8155+sJFirt+Y8HkZHjnyW813k+Q4S6RtkZRNAvnfehtltqs4yvf089+vebTmoTK9Py8FW64rGwpaua7ba16pObI7F+nYZekXAGDXeq/mkn5wgXS50gX8txbtGG2lYF12fq5rXI5d1h39AADAbnNhzYv94AJ5zzKP05jnhLLvXavzpAO47Pxc104eebKn5p1+EABgt1rXRob/k0XPegMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD47/wDkwWAqFlCEtQAAAAASUVORK5CYII=>

[image2]: <data:image/png;base64,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>

[image3]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAI8AAAAbCAYAAABFlNzGAAAERklEQVR4Xu2ZS6hWVRTHV2RgouULRTRKDULNV75GzrLHoBRNgkInIgqhgiK+Qh0o6MBXhUWZ0cCCFBolDkWlBw0aiRAEFUUgOCyooFw/115+233PPfe8vgvi/sEfvHufc76191p7rXWOIplMJpPJ3LdsUH1YQUeCxtptfWem6p2g2I6Xo2uwxe3y+Z2qkdE1/WBC0FG51zb20sEGbEHxHg7X/jll/mVvX1A9cvfqmpQ9PFYOnh45eJSHxDYBh6C/VSdUUyItVV1QXQ0ac+fO/sOCpgfxuzfFbIkD42HVoqAfVevF1sO6+gm/iyapPlP9q3pFNTq6BhtmBH2r2iO2n9w3nBCsL6r+koG+na/6WvVd+LsRbwb9p3o+mQM24KOgOqfaNzg2GDGGqm7kp6rfVNPSCenZvimdGCZ2iTlmSTqhLA86JP0P6DLKfEvQ/6/ank5UgUV9EvSHWKDACNUzYZ4xUjQaiseCiPJr0kuRp8VS6GuqlUHjwz1DsVf1p1iGiXlK9UFQfOrLIKM9kQ4mYNej6eAgrBbbfJwQ87j01l4U9EV0bZtDefpZNTUZBw5d4+AZp/o+6CvpZZZnVQfCv8kWzwWV8aTqfNC8ZK4NvsC43yG46SGWBVUFBx1TrUonlAVBHCScXwVOM6c63fytqrVBVenaNqDNoOzHvnUIwktiJR/f1YbTzKlGF8UyAxniB7F0VxWceUo1J6hLPLXG9qwQy4RkxrolASe9q1oTjS0W619QHef4/h2Oxlj/GTHn1M0SXdoGs1S3xPYq7nXQl2L9bNXMOABONScH7RcLnrdUN8R+uCpce1CaOXMo3EH0F0BTTB/UeNFiTjopVnbcOTimrnNwxi9i9gDPpYwuvHtFfbqyDXgGviVQKKEfq34NIuAbvWmB9zs0o3FDSv9wQqykAamZWlxWj3Hw5nSwI/z0uIO8JLSFjSNDXBYLyCZMVF0Xewb79qpYCWt7gLqwDYr6nZeC/pHiJroSvnDqYVwTSbXes/BWdDyMlaVggmdLOtgRfrqxkd95T1qcmAhONf0Zz+OENoGAuSy2j5Srs9LO2U4Xtnk/m/Y79I6oqNGvTA6e9g56YIPHewlehVER9ESvp4MFsGE0emxm1dfmqriD2Ihz0k1DzgfHL8T6iLjHaOIoyunvYv0EjXxburLNy733ig69DmoVPN4sU/fS2scHvDdU36gmJ3ODweJ2BFX9AFgF3uR4K2CxPLstsXMcnOSbWtdJ7oj3xWxtQ5e2DfZxkGBH/nGT39qnGhVfNBgYQLdNw8Si+fSPvAuP5w7aLZWgSVwX9LlqrnQXRDR+V6TZG0cMn+sPSfFzcBLarZqdzJXBIfxJ7KNlG7qyjWY49S8faT2wNwYxR1Z6W+oFZd+hjG2Tgf8Zh3iTQ2Vvbymk4EYfsoYB3mQ4KPcbVBTK1tPpRCaTyWQymUwmk8lkMplMJpPJFHIbpycHavT2GJ0AAAAASUVORK5CYII=>

[image4]: <data:image/png;base64,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>

[image5]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAHQAAAAbCAYAAACtOKuoAAADyUlEQVR4Xu2ZW4hVVRjHv7DEyDIx1Cjo4CWTEM2SaCoYQUXxlmKICoGoaJRSSldQJJK8JaWIJV4Qbw++CFJSL81DaI8S9BRBPfQq9JAPCer/N99azjmLvc+ck3PGc4b1gx86e6195uz9rfWtb60xy2QymcwQZYzcI49Wua6mh9kI+UFow93y8ZoeQweevfpdpH4on5UPxBvajRzQWjo+oMPkWHlO3pSL5ciaHv7lJ8hf5CfySfP7hiqvyblynHzb/PmR93Rcvie/kqPiDe3IR/KGnJU2BF6Xn1sbj8wB5EXZbT5wV9c22SI5R74sNyVtbcVyedt8hqYwEkk3T6cNHcCrckZ6sR/qBZQBP9t8qSL9NgwzoSLfkCsKnHa3ZzGkRHL9I2lDCYy6W3Jr2iC2yDfTix0CwdmWXuyHegGdH5ws30naSnlI7jefMUX+J7+UD8YbClhg3vdY2lACD/Gv3JVcf978Mx5OrncKvKPP5KS0oQ5lAWVWHpCb5UlrImOtkR+bzzLS3dkgi3Sj8MsumQe2Efjyf8lT4WcGFX4jX4idOpRnzN9fJbleRnVAL8pfg3zGZdllTRaFj1rfDXw4FSiyfWgVT8jfZI95lbskSAouKoQY+aRiPCyn1Da3hIr8OphuJ/qTwf2PeYVaL7NBOkOpK3ClXBb837xrngbTVDjQEMQe86CSZk8ESTNlkAWwRz5V29RWMCDZfnxqjdUUaUAZALhdTjX/nEro2zQ5oPdO2wSUFPud+ZqKrYb182/zzTMba6wHlTGet/7T2P2ELRmptmjpKCINaKQid5hXuBRHTReKjIY/zPc+ZRv+Mihkrpsf6zUKWYDK+Ij1jcoUZuReuU/+FIxbncfMi7md5usqfXmJ3UHWPl7EvN7efljxhfln0d4KKCT5vc28/LKAQlxDX5IbrPFB0gsL8Z/m6azZlBYD2swebKP5AKok1yME6EfzLQAp+vsgR2Uci/H/6aEvs4LtDjODLRby8Awwyn7up2qcKNebFxytgMJuVXqxDpzlXjV/Tr7f7+YDDjm/pvJnEJLFrpnvAhpJ471w82CeFzJo6h1YMBPZfxEYznZ5aKRCZjDENuAo8Yz82XzEYzXMfs5DyQj0YTa0guHm7zFTwEHzQAEjPxZOXfLbqjZm3w/yLXnFPFgxYAR8vPlaxIkLL/u0fCW0ZwYRUitpdKn53i4GlLVkprwQ+hySC82DRaqlHSmg+DPcc+Z/giPVrpXvh76Z+wAvnjQG/IsxzXIYMrrq5wgzNloNa08OZCaTyWQymUwm03HcARDZswLj024RAAAAAElFTkSuQmCC>

[image6]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAHUAAAAbCAYAAABC+sCWAAAD6ElEQVR4Xu2ZWahNURiAfxkyhsgQMqZQIiHzfSCEEgkZylBKUubyYEymQpKQMuWJ8iBTCSEppchQnhAp4kGRrsL/9a/lnr3vOfvsc+45OfdaX31179nr7Lv3Wuv/17/WFQkEAvWT1s528QuB+sk09aLzmVqt7oi0KJ6+6mH1RIZTIy1sIu1x13CD2jzSomGyTKL9Ene72u9v6wIJg/pvKOug7lK7O1uoS9UxkRbF01Ttrd5TP6ojpPaANVaHqa/UxWoHtVGkRcOEyTxZ/a7uU7tm2FPd4q6tkyL6Y6fYF7FcnFHfiU2cbCxQV8Q//A/gvX+pE+MXHAvFBnZU/EI++MJbJ5FUDjar38QiMk4v9ZhYoVZfaKLOF4u2uhSXLE2v1W6xzz191A9i/VcQXcTWUnwpuaMpk1Zqf7HUmQai8LdE11M6BllPR2Z8Xl9YJRYQBUeRo43YsnRFai9JHj+oZLpUkKdXqlfV1U5SwbaMNrk4KbUHKYkZYu1JN55Jzr1SxJpRAfQQm5BI7VAoA9TP6qb4hQzGqj/FIjoVs9W7YoVJe+cj9aZYJCbBYF6WdFENpF3Sr38B/iazD9PeoxKZ5dwtVmQWAt9LWk/BZ7jMYMhJZ7FUG29MJ9+R0q9vflb6NEJWmOPMBn9/q7pf7Fmx3DBR49uKtD4R68/Rkp586ykpmdRMgckOIi+8wCexzs6ETie1lhrK9DdiD0nUHhFLWUlpa7hYNvCnXZVIW+dRdYqkrzF8VkxaT+mnr+pGSbk8hUEtDRU1qBQuz9WO7nffcbfVeb5RCeHed8Re5Lw6KHI1O6wnHIxUKkxIijwsdCuYr0hiolDbXHA/p4JZ8FRqipRxzltiRUw+OKj4oU6IX8gBWxeOIVn0kw45BopFMYXHC4lW1zwrpywcltCRvCyRMVc9qB5wDnHteR/uw7pc5T4rJUQmE6+YQ5Nshw5EIw5WH6unJH/BGsFvZ0hvFC3XnfF0nAsG5os6NH4hAQoDqu1cM497sb1iUpGuH4jt03gmvCG2pwY24+vF7kmntlRPOznLJjOQETh7Xi428KWE/mMrw/NhWpgIHPJUi01wjk79wc97J+85XlKm3GyQzzuJzfi060GxMDCcaeaCtdynI/ZnpB6ej4FDf42XZRYTrQ8le/VIZjgk1nH3xSZJqSGKfHQFsuDLd9Z6YACRA+9rTn+NTT8Rv0gssn0R5Qsv6gTSNFHB7+ek+FOfQB3hPzSslxRql8TSGz8zmMh+sEo9LlYZM5hn1ZnqdHWtk7WX75J2l6hrJLnKDpSZZlIzAPFSn8+zrcccqMfbAukxDGYgEAgEAoFAINDg+AN0Is25sIdI/gAAAABJRU5ErkJggg==>

[image7]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAE8AAAAbCAYAAAA9K9JnAAACVUlEQVR4Xu2YPUsdQRSGj2hAUQimMAkIfhALCaIkYghYWKSICAoaUEgjBETEzkIQAkmbQCoL0RRJ5Q+wsTRgkS8ELUwgNoofhIBCIEWEEN+XmfXurO7c2d3r3mYeeIqds3vv7tkzM+deEY+nhFyDd2E7rIzEPBYa4QLshK/hMzMcTwtcg0vaW0a0vNTCm9HBEEG19MDqSMyVKvgePtbH/fBBIWzHJy9D8sgdeKh9YYZyh0log1NwF86a4XO4Nn2EM3ACfoLd2iS0wu/wOXwl6vtqjDOKwOwva7/AejOcK13wJRyDB3J58vhwK3A6NMbK2dA2hMaLcR8eS6Hy5iRFAQ1q/8FHkVg5uC3xlccH/gl7Q2OsxF9aTj3C6ffE4j1R1/0Q9ZmE37cG6/SxE1xb6Dc4DyvMcO7YkjcM/0jhgUlwftw1cVyHq2ImjzOQs9EZJosycUygbaEO4ILN83jjLnI6ufZQtuRxzJa8t6FxF/gyFkW1Ku9ErbmpGIf/RU3hYtyAQ3JxOsQ5IGoHdSFL8rh7JoXTlIXAgkgMH4x+gDuSonRLTN7JSw3LNtipmkTtNvuiesByYUteKde8zPjkpaACjsIjUV06JQ/hX/hUH8fB5vor3HN0HTbzQgdsyQt6s3BLxcX+ROuyXmcimrgwbEK5fdNE3XYJsSUvuL9ok7yp5cJ/pfBNsdEciQY0k/C3mFMjDzrglqjK4q5/KoXKfRM6rxtuiyqAPvhZVHMcNMhXCvst/gxjBV4G4+zLEnXaOcPfwX3atH8MeDwej8fj8Xg8nqycATbdiqlFAJAtAAAAAElFTkSuQmCC>

[image8]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAE8AAAAbCAYAAAA9K9JnAAACQ0lEQVR4Xu2YzUsVURjGX7EgsUW2MFv5gS0k0igxAhd3IagECRYoRNAqQty1CFrVH1BuxI1tWrUscKM7BRd+EdhCN20UNSQwCFoURD0P7xk7M92Ze+bOdQbh/ODHZc6ZuffOM+fjvVfE46kxZ2C3efWk5B5cgOejHXG0w0U4a2wJ9RZLI7wUbbQ4C6/CPngu0peWDjgD58SHl5qqwiOd8MD4ItyVOwzhCpyAO/BZuPuYLrgCn8LHcBX2GtPCsJ7DEvxgjp3hAvnOuA6bwt25ch2+hONwX8qH1yA6QiattiH40dhstVeiDj4UHXk3pYrwyF3jbzgQ6SuCyxI/8niTh7DfauNI/GocNm234P0Eb4i+15Q55mcx/FHRB+QM1xa6DadFn0iRJIXHm/sheuMBwflx18TBZYLX0kHR3Zb7QL19UiUYFmVwDDBpoQ7ggs3zgg+vJKeT65dKCo9tSeG9sdpd4XLxXnSpeAUvhLvdeAT/iE7hSlyEI/L/dIjzjugO6kKW8N5a7bnAG6NL8LPo5lFkpX1qwuMaEuxUraLlyp7o3C+KpPBqueZlxodXBXVwDH4RrdIpuQ1/wgfmOA4W1xtw19Fl2MYLHUgKj6EdSbik6oHfjC7rdSaiwdmwxpk3pqp3akhSeMH3ixbJm0aXSiETfFIsNPlPQjmewO8Snhp5cA1+Eh1Z3PV/yb+R+9o6rxduiQ6AElwTLY6DAvlEYb3Fn2EcgeVgP+uy1D9VcoQFbsmY9Y8Bj8fj8Xg8Ho/HUy1/AbVOh8Lmfu6TAAAAAElFTkSuQmCC>

[image9]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAE8AAAAbCAYAAAA9K9JnAAACSElEQVR4Xu2YzUtUURjGXzEhKQgVtEDoA12ESFKWCC1m0aIoCjIoCMKVSOjGFm11LbgQdwrhyj/AjdDGoEWlBLUoiBYVfhCBgeDCIPJ5fM+xe24z596Zq3MTzg9+MHPOuePcZ87HexUJBPaJGngGXoVH3a6Ajzr4FF6Gt+AneMUZ4eEsXITTxpNOb74cgy3xxgi88Q7Rm610xpyCX+AN834Szuz1JhDCyxAeaYNrxlG3q+owhHb4GH4VXVLFOA9fwSdwAL6G3cZy4H7XKPpD8PUz0QBTcwTOGZdgg9tdVbrgGHwAV6V4ePVwHg5F2q7Dt8bmSHs59MDnsDXekcRt4294LdaXB1xOpWbeJfhd9HS0cCb+MNolyDDuebxoxhFePw5PRNpSw72FfoRTolM4T3zh3YVboiFa7PhS1/g4Bx+JLl2uumG3OxmGRRkcA/Rt1Bb+MY7jF08jl1Pt7pXJ+MJjmy+8cjb8JvgO/ok44owog37RD+ASToIb7R35dzmU8qboCZqGLOHNRtqrAm+MvoCfRQ8PHiR5cWjC4x5iT6rTouXKimgNmBe+8PZ7z8tECK8CauB9uC5apdtnul64DR+a96Vgcb0Mv6X0pegDeBp84TG0DXFLqgvwpzHNfp2JeHBRWIQuGPk6D3zh2e8XL5J5atI0lUIm+Eux0OyLdxgG4aa4S6MadML3ojOLp/4v+TtzJyLjuuEH0QlQgG9Ei2NbIB8orLdYEHIGFoP9rMuOxzv+I/gcXDBW+o+BQCAQCAQCgUAgkJUdgs2J40M1HzYAAAAASUVORK5CYII=>

[image10]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAE8AAAAbCAYAAAA9K9JnAAACHUlEQVR4Xu2YsUtWURjGX0nB0KWQykkFGyKiyI9CcPgGh0Qw0KCgJRBCws2hNf8BJzddGsTBwcHFUcFBTcQadGlR1IigIGhIkHoez7l67um757vfuXmvwvnBD/R970Xv47nnvJ8igcB/pgU22MWAm0E4B3dgq9Vz0gGX4JT2VqxbLE3wpl004Cq5Cx/BRqtXK11wS0J4XniFRzrhofZdvJU7DOE2fAN34dt4+5Q7cBWOwddwDZa0PniHVw9ntR/gtXg7Vx7AcfgCHkjl8K7CBThq1J7ATe0No54W7/DIgPYY9lq9IuBDJK08PuhX2GPUuBK/aft07TF85vChvo5kCo97C+WJMwnr4u3ccYXH0/GXqAeOiK5PuqcamcJjWJTBMUDXRh3BDZvX8Qemka/TlZM7q+MKjzVXeNNGPQ3DcB7+hDNytnJr5hX8I+oVrsZ1+FT+fR2S7Bd1gqYhS3jvjXou8MHoMvws6vDgQVIUlyY87iHRSdUmalzZFzUDFoUrvPPY87wJ4XlQB5/DL6KmdEq64W/4Un+fBIfrDbiX0hXYzhtT4AqPoX2X+Eh1H/7QptmvM2EHZ8IhdFHLr4vAFV70+9lD8kdtmkkhE/xLcdAcshuaEVFHt/lq5ME9+EnUyuKpfyRnK3fCuK4Et0UtgDJcFzVieI8ZtcB5ix/DuAIrwT7nsma7cYHg5+CyNus/BgKBQCAQCAQCgYAvfwEHfYXAw+wdigAAAABJRU5ErkJggg==>

[image11]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAwAAAAeCAYAAAAYa/93AAAAo0lEQVR4XmNgGAXDBvAAsQMQh6BhZyBmhSliBuI8KP4FxP+x4FtArAbTUAzEB6FYBogZgTgBiI8BMT8UowCSNCgC8V0g9oBiGLAB4mtALAnFcBANxFeBWASKCYkzlAPxGiBmgWIQANHLgXgCA8R5IAwHfkC8CqoIpsEciE8CsTxMETIgWQMoouYDcSsU1wDxZiBWQFKDAUBuFIZiATS5UTAiAQAZZx/I/sfpjQAAAABJRU5ErkJggg==>

[image12]: <data:image/png;base64,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>

[image13]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAZCAYAAABQDyyRAAABP0lEQVR4Xu2Uu0oDURCGR6KQRNAijakEmxQGOwlYiYggQQxWgiBikyaQwjKlVcDSSnwCC9NIUAR9Bp/CIkUeIf4/Z87u2Y0b9wIGdD/4YM/s2Z3hXEYk549ThLuwrs+/zlwLaMEneAXf4RgeqlOUYSEczEANvsA1HS/BBzhSNzXusQOH8FTlB1k4ghN478TONEbbTtyDK3CsvsFLWArMiE8V3sIDJ3YiPxTgwmK4Ks+wB1eCrxOzIKagyC2Igh9uwQHsw4qalIaYxB2V/00MDxZXhF7DxeDrSNbhB7wQkzhVcjK3AsLbYLciDqvwETZ1zNtFl70ZM2Bi7l3ag8hELHbfifEmWL+Fp5/uwVfYlZjVhmDyGzHX+c6RY7rtTzXYHsBmRM8lfQ8gbLf2zrt+qhv+VAP7NvfJrkBOTs7/4QvUxDlIy5iJvgAAAABJRU5ErkJggg==>

[image14]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAsAAAAeCAYAAAD6t+QOAAAA2UlEQVR4Xu3SvQ7BUBwF8CtYfAwSidjEYrQwSMRkMRhswmjwAAZh8QQS8QI2E+8gMdlsBiQGi6fgnPY0zVULG3GSX9Le/2mb29aY700WZrKHuj22E4WaXKBsTV+Ed6MDZJ5mgbxVHssKIk8zKxyyRLyA4aZ7ktaaEz72KA0owQgWMvCr7u7P0pEC3KTtV98sd+EuS4hrnXsJbHYOa5nAFYpWQ0nCFvqSgA0MISdVt2pMHk5aIK/chJZUPirzYGfcF08hmBr3/XpflT+akzDEvBOFF6Q0o39+Ig+3Di3PGomtvQAAAABJRU5ErkJggg==>

[image15]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACgAAAAcCAYAAAATFf3WAAAB90lEQVR4Xu2WO0seQRSGjyRKjAYDikQUFIuABAneOtMZULwUioKIjRaBBC2C4gURUUNi0oiCNxIvTZoo2Np9YOMfEGwsUuQnaCNE3zfnrJlvop8SdFdkH3hgOTMLZ3bOnFmRmJjoyYUzcMWz15nzCA5645/gU2fOrfEA5sPv8MRshtnOnDRYCvfMEVgg+m5oDMFjs8YbI6/gtMmEQ6cVnpr8gi45ottaZEZCHfxtvvfG+mG7FwudKnhkfnDiL+BXmOnEIuHOJ8hT+dPcsFg6XIIVwaQoyYP7ZkK0zbSI1uNlp7YMLkhI9cmEEiaT5NauijbyVEyJLiQUuLX0F/wGXycP/wMX9UP0S4YCDwdlL1yED5OHz2HT/giX4bZoorxV2kxeg7w+n9t89s7Pjt0WfwYn4RfYYLGUvDEPYUny0B+YGOXW8wCxuc+J1ijv6uB9UgvnYTHcFL1OO00mRVjfHaI9uM9iKbnzCRaa5f6AaBJrZpfFWA5Mku/siv5QUMI465l3vNtXXRpF7/4D+VsO/00W3DLZ1IMDwtXX2zNjlLW7Lnq6+YWDu52LpGxpL+G4zR2Ta9bgVbwzeTe/hTtwWHQbg69JB2CPaDLVcFZ0UaNmpejCJmCT6IHjD8mN8Vj01FLWYsAT0/9P5JyLEmA8ww/GxMTcJ84ASUtiI6PceV8AAAAASUVORK5CYII=>

[image16]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAC0AAAAbCAYAAADoOQYqAAAClUlEQVR4Xu2WT6hNURSHl1DkvycS8sSMkl6RoigDipKEYs7AQBTF5BkoZpIRCgMlzGRm8EIIA4kUKUrKhFKUCX7f22u7++57zrn33fduurpffT32uufetc5eZ51t1qM7mS1PypnuSODzx+WMPNAq4+QaeUs+ls/kc7lLjndz+LEbclUeGAGr5Rk5MQ+0QlclzfbidXlZTk9iy+RredSlsJRj7mjgO2mvI3mgDO7UXfeCFVe7V/501ybrS+QD/ztaVshHclEeyCFBEuVO4rz68F8G5Hf3cLK+30IrTUjW2mWSvC335IGczfKXPOiWkSYdW4FESTgtIsJ2b5T7LLTaZLnVwpRY6eZtBsQv5YspVHZHfrWwNVjGDvnbjUnPkk/ltvihhE0W+v+ifGjhOaFw1j+5aZtF+J0hOdVtYKH8KO/LaW4Z56yW9BZfm29hspBMhLuHpy08wCT7Ri72ONd8cIuKZY0Yn8MG4pZfs9qPFUGf0+8v3bm+XpU0N6DPwk6kk2WdhZ1F/p3TNGn66pu8mgcy6Ev6nr8YKUo6hfUvFloiQgEUgrRXzv+Z9Bz5yqobv1++s9r8Tmc4X/rW6pNKYba/lwv8/7wPeMsOurTPTo9FSDoWVFTUMAfkD7neTemXTyw8TFPqQ8NQ5JCFJ74IRhfTiSkF7CxTg15GitrtsQjjM14Tr2uAO3dCfna5iOrPyhdWO3OUwVQ5lS9araB09jOtOMucd7kuf/tSaMtHgtgeG+R2udSqk43wcrpnxcdKJkj+HSQZzzn5tKJdORKUPSNjBoWynXlrtQM3gKEwFkeCpnCsvGLhVd0u7NRNuTwPdBIexkNW/ZIqg5bhzFH2QHeU2MN5HzeDz1cdITpKVybdo8e/5A8nGIRpWBevFAAAAABJRU5ErkJggg==>

[image17]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAE4AAAAbCAYAAADS6blZAAACh0lEQVR4Xu2XS6hNURjH//IoeT/CgHQjJe93RFKUwkSUCCFJSEleI5FIKaEYkDAQIfJIMbgxMzJBiYnkjjBTRvz/vm8523LvPmffc4p97vrVr/Zea521z/n2t761DpDo0qyhB2ifuCNil5twetNHsAB2xFj6lH6gLVFfYBg9TwfHHc2MgnaT9og7SDe6g06lrfSot8ksi+l1tD9H05IC10mG02d0YtxBJtDNfr0EtlzVJkVfeoG20Xf0JO3lfU2P6tw9ejhqV1bthgVWaNx9etoNWafg3aUz/L60zKGrcpxeGfqrmJ+iW+kLWJBCoKbRtX4dWEA/uSFQ42EbzKAwqBb609WwSbJrvzudDHtLul5Gx3lfI9CceqYyQi6HPasII+kDOhOVbFrqqlbto0N+jzbUrlomL/r9OnoGNsfCytCOCVuwCuNr2A8Jb2Eu/Uin0En0K73iffWiQv2S7oT9eLmRnsgOqoI+85zOzrRpk7jhLqLf6Y8c1a8M3ETPwl7gKNTAFtgD9IaUukpZKfbTV3QoLAsPonrgBsLqRR6j6VtY0LLoe2jHqxV9p7iIK4uVYVLXReiHAp/RYKXqOfoYlqpSbbfoZVSW7gq6za/bQwH/DDto5p3iVY++wd6uXtxVV8umVIdPFdI3+DMoansPW/uB9cjfdQbQS3Q7/j4jBRRQBVZLbAzsOT3d0pEC10kUDG0Cs3LatHxVfxScelD9a0X1WlkK4iCJlfSL94n5dEOluy5U41Q/47828+gRFCjQ/xotEx1JntBD7jV6B3Yu2kuP+bhGMII+pMdhm8Ntdw+Kn+P+C7SMwlYeapSOF9n7RqH5NK/Okcqw0mRZIpFIJBKJRCLR5fgJSKhudV2E1zMAAAAASUVORK5CYII=>

[image18]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABkAAAAbCAYAAACJISRoAAABXUlEQVR4Xu3UvUoDQRQF4BtUUBFEFBuLINoERQuxMESwSMAHsBB8AR9A0N5CtEhIJYgpUgm2IqQMVoIvYSE2VhYpLPw5x7mXnZ0YN0IMgnvgK3Z2du/cmWVF/kuGYSwc7GUG4Rya8ouF+lJkBVrwBpvBva/ChRzAnEoMu6jCnrhCDRiJzWhPAR5hWSVmEU5hVNyWddPNPtzBhOqYjDqBdR1bgxeJuvE74tw8bIsrcANbKuvNi4UdWBdDOsatu4BXKCkL723ALjzDsURFZqJpUbiqsvJfxFg3Vyo8nyI8SRdnsSBu/yl8Cbu6FFeIbCst/nl0DLtgq+F2+OGLrQgL2nbyr3AtbnHfpi9F5qEm7V+PH47bmbAQz4nhAd/Djl5zMbSk159hF4fifh9nCTiH3sV9cfy6+Gd4gFUYh4qaFC+zOokP/oR1Mw23cAR1yKmeh+czBQPhjTRp0vyhfADGf1GhzcP8lwAAAABJRU5ErkJggg==>

[image19]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAI4AAAAbCAYAAACqVrf4AAAE1UlEQVR4Xu2ZW8hmUxiAXxlFxlnGNCSSEsZhHJJDP7kg57OaGcLFnJDMRAblkJzKhaYmJUZC5FQypplpZsKFmGI0KGYuCCXFjSsXeB/v+/rWXvb+/tn7+//55/Otp5749trzfWu/+11rvWv9IoVCYSTYx71PvULdrdpcYZr6pHpx3jAZTHf3zxsSDnQfkv735VyuXphfLHTiePUz9ci8IeFsdbP6sbpf1gbnu8vzhraQmW+4W9U/1Icrd1gHXndPztrGYw/1CfX0vKHQGmaTV9W5eYNYnPFe9ST1G3Ve5Q7jGbfuO1pREmd42KUS51H1MHcv9Rb1rModIvckduFoda3YbxQGg2X/XbF3lTLmRm2zUN2iHuKfZ6vr1d/dT8Tqpc48oi5162A9/cj/229t7QfF3ArpnniFHseq29Qzk2sk0d1uJBQJQ+KQQMEc9R2XmnYg6MD3bt1yskBsGWOaxK5coH4g9QXbqHKGe02Dp/Ru/YfT1MfUp8UGYuyumGXG3BSWKpasw/0z75IVBgfmULHaBr+W6nJCopA0dyXXUo5QbxJbioAHucQlICl87+fqidn1ncW+7rViIy+CvrvYNM5I5f+RF3GMt08E1B7nis3qY2K/0Qb6g6+JDTx2VwzCGf6ZmTxqnBTa2F3RHvURAxhZPTo9I4FbrK5W73D/VB9M7jlA/VS9NLkWHKc+LjYyvhR7CDryi/ueuue/d9s5xIdS/10pBJVpduYOyu9iHrQUvm+lS9C+EkseYMb9QSyhT3B/U1/09kG5SGxAXifW3wfUWyt39OcysVhizNYkwStiMwr+NY4/ib2vVWJLFy6R/jFr5GqxrD1ILEEiSSig9vZ7eFBmiQhyQNLdrx6l3iaWOAd7G5/xZb8vYE3dJOPXOYx8gp1P201S4GH8fh28qPNciksCSa0A9Cf6T3+RnUlT4sQ9xC0dGDks+/izVM+xbpR2iRMlQl4m8NttztOAQRmHiZ1ghDIK8i0ZwdokvcKpX+Lw4yTYGrHtXcABFC5KrsGOJs5kQF8j+CvE+kyCxlL8glSTnFmReqCOmOqZnZ/L2gJe6tvuj+rNYrP7m2L1Rb4jGhoY0SwnMeoCEicNRlPiBFz/VSyQwe0uyZMylYkDsaQxYCIp+Lxd/juA5kvzM1OrIVti4lhHfC+ypBBHlsu2tc0uR0mc3rWSOC1gKk7rEl4qblRviJvEHvhbqSZGCgGnsCSQQPEWJ5P5tjsSJ39JOfw9jKUkjgjGk0TAU/nHfSARkP6yrY1r6WeWEORsK+9/G4jbd+5UDZRJgYB9Ib0Xfo67QazoC+JlX5VcSyEJCA6BgivFkrJu5xSjvSkJJ5u6xOG5mDFjdon6jAJ2ENIaJz0zoY7iOCA9lBsqeACKNaZbtuGMcMyXLmD2aDowImHYmT0v9vetpVJ/ngBsdzers/KGnUT0a6W6Tuyvwy+pb4nFYZn0Dsfq+t8WYomcoxAX4v2+2Iw+9EsWIyPW3qaHYStJcjB1103fsTWNnVgT1BX57mWqoK/0OfrCtjY+T3T/4lwq/b2RgCBz+BTLWReoG9j2cthWGCE4yFrldjmDuF59SkZsxBUMCkm8U9olAEfdz0r9MlcYITiFbaqH6uB0eSKKzcKQUxKnUCgUCoVCofC/4W+RLe+pJnvHSAAAAABJRU5ErkJggg==>

---

# 🔬 RIVF 2026 — Technical Peer Review

**Paper:** *Efficient Visualization of Knowledge Bases via Space-Time Graphs: The OHARA Architecture*

---

## 1. Summary

The paper proposes OHARA, a framework that unifies document structural hierarchy, temporal decay, and cross-document entity pivots into a "Space-Time Graph." It includes (a) a 3D sunburst-tunnel visualization, (b) an eight-phase hybrid retrieval engine, and (c) a corroboration-gated abstention mechanism. Evaluated on QASPER and MultiHop-RAG, the system achieves ranking parity with dense vector retrieval (not superiority) while abstaining on 45.6% of unanswerable queries.

---

## 2. Recommendation

| Aspect | Verdict |
|---|---|
| **Originality** | **Moderate.** The 3D sunburst-tunnel visualization combining time, ontology, and document structure is a novel contribution. However, the retrieval engine is a standard multi-signal fusion with weighted summation — not architecturally novel. |
| **Soundness** | **Weak-to-Moderate.** Several methodological concerns (see §3). |
| **Significance** | **Moderate.** The honest framing of "parity not superiority" is commendable, but the core contribution (abstention behavior) is a thin quantitative differentiation. |
| **Presentation** | **Strong.** Clear writing, transparent limitations, well-structured. |
| **Overall** | **Weak Accept / Borderline.** Requires revision. |

---

## 3. Detailed Technical Issues

### 3.1 🔴 Critical: Tuned-on-Test Risk (Section 5.1)

The fusion weights (BM25 0.6, Vector 1.0) are selected via grid search on a **75-query subset**, then evaluated on **the same 150 questions** — not a held-out test set. The paper acknowledges this, but calling it "ranking parity" on the full 150 queries while the tuning was done on a subset of those same 150 is methodologically unsound. This is **overfitting to the test set**, even if unintentional.

**Required fix:** Either (a) hold out a proper test split (e.g., 75 train / 75 test), or (b) use cross-validation, or (c) clearly label the QASPER Hits@10=33.3% as a **training-set** metric and only report the MultiHop-RAG transfer as the generalization result.

### 3.2 🔴 Critical: LightRAG Comparison Is Not Apples-to-Apples (Tables 1 & 2)

LightRAG is evaluated under an **"unranked, uncapped-context protocol"** — no top-$k$ cutoff, no rank order — while OHARA is evaluated under **ranked top-10 with document-level Hits@10**. The metrics are fundamentally different:
- LightRAG: answer-string overlap (loose)
- OHARA: document-level ranking (strict)

The paper itself admits this is "directional evidence, not a controlled comparison." A reviewer would ask: **why include a baseline you cannot fairly compare against?** This weakens rather than strengthens the evaluation.

**Required fix:** Either re-run LightRAG under the same top-$k$ ranked protocol, or remove the LightRAG row from the main tables and discuss it only qualitatively in Related Work.

### 3.3 🟡 Major: No Human Evaluation of the Core Thesis

The paper's title emphasizes **visualization**, and the stated thesis is that knowledge bases should be "seeable and auditable." Yet there is **zero user study**. The 3D visualization is the paper's most distinctive contribution, but its utility is entirely unvalidated. The scaling benchmark (713→12,323 nodes, sub-linear growth) proves technical feasibility, not human cognitive benefit.

**Required fix:** At minimum, include a **pilot user study** (even n=8-10) comparing the sunburst-tunnel view against a flat list for specific tasks (temporal filtering, topic tracing, structural lookup). Without this, the visualization contribution is a system demo, not a research contribution.

### 3.4 🟡 Major: Missing Ablation — Which Phases Actually Matter?

The paper lists 8 phases but provides no per-phase ablation. The only ablation is removing the corroboration constraint (Finding 2). Critical questions unanswered:
- What happens without TOC selection (Phase 0b)?
- What happens without multi-hop traversal (Phase 1c)?
- What is the marginal contribution of SUMO overlap (Phase 1b)?

The paper notes that "graph phases contribute provenance and abstention, not ranking lift" but does not show the data.

**Required fix:** Add an ablation table showing each phase's contribution (or lack thereof) to both ranking and abstention.

### 3.5 🟡 Major: Visualization Scaling — No Variance Reported

The scaling benchmark claims "five measured points" from 713 to 12,323 nodes, but these appear to be **single-run measurements** with no error bars, confidence intervals, or repeated trials. The 17× node increase yielding 1.7× memory growth is presented as a fact, but could be an artifact of a single hardware state.

**Required fix:** Report mean ± std over ≥3 runs, or acknowledge the single-run nature and remove the quantitative scaling claim.

### 3.6 🟢 Minor: Subsection Labeling Error

Section 5.1 is labeled `\label{sec:eval71}` — likely a copy-paste artifact from an earlier draft. The same label is referenced in the text as "Sec. 5.1, Finding 1" which is actually in Section 5.2.

### 3.7 🟢 Minor: Bibliography Formatting

- The `\begin{thebibliography}{9}` limit suggests 9 references, but there are 11 `\bibitem` entries. Use `{11}` or `{99}`.
- References are not in alphabetical order (IEEE style requires it).
- arXiv preprints should include access dates or version numbers for reproducibility.

### 3.8 🟢 Minor: Single Author

A single-author paper at a conference is unusual and may raise reviewer concerns about depth of evaluation. Consider adding a co-author or acknowledging the single-author scope explicitly.

---

## 4. Strengths (What the Paper Does Well)

1. **Honest framing.** The paper explicitly states it does *not* claim retrieval superiority — this is rare and refreshing. The negative finding on temporal decay (Finding 3) is commendable intellectual honesty.

2. **Transparent limitations.** The tuned-on-test risk, single-run variance, and LightRAG comparison caveats are all disclosed. Many papers hide these.

3. **Clear writing.** The paper is well-organized, technically precise, and fits within page limits despite dense content.

4. **Novel visualization concept.** The 3D sunburst-tunnel combining time, ontology, and document structure is genuinely creative and technically well-executed.

5. **Practical cost analysis.** The $12/1K documents cost estimate is useful for practitioners.

---

## 5. Suggested Revisions (Priority Order)

| # | Issue | Effort | Impact |
|---|---|---|---|
| 1 | Fix tuned-on-test split (cross-val or hold-out) | Medium | High |
| 2 | Add per-phase ablation table | Low | High |
| 3 | Run pilot user study (n≥8) for visualization | Medium | High |
| 4 | Report scaling variance (≥3 runs) | Low | Medium |
| 5 | Normalize LightRAG to same top-$k$ protocol | Medium | Medium |
| 6 | Fix bibliography formatting | Low | Low |
| 7 | Fix `\label{sec:eval71}` reference | Low | Low |

---

## 6. Questions for the Author

1. What happens to the retrieval metrics if you remove the SUMO grounding entirely? Is the ontology layer pulling its weight in retrieval, or only in visualization?
2. Can you provide the per-phase ablation data? The claim that "graph phases contribute provenance, not ranking" needs empirical backing.
3. The five-layer temporal decay protection mechanism seems over-engineered for a system where temporal decay is empirically neutral-to-negative. Is this complexity justified?
4. Would the system work on non-English corpora? The SUMO index appears English-only.

---

**Bottom line:** The paper has a creative visualization concept and honest evaluation, but the core retrieval contribution is "we match dense vector retrieval" — which is not a strong enough result for a systems paper without the human evaluation to validate the visualization thesis. The tuned-on-test issue is a methodological red flag that must be addressed before publication.
