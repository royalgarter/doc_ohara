# Brainstorm: Doc Ohara × EMR/EHR

Panel discussion on what the Doc Ohara platform (unstructured-document Space-Time Graph + hybrid retrieval engine) could contribute to Electronic Medical Record / Electronic Health Record systems.

## The panel

- **Dr. Elena Castillo** - AI/ML generalist, knowledge-graph RAG research
- **Dr. Raj Subramaniam** - Computer Vision, medical imaging (radiology AI)
- **Dr. Mei-Lin Wu** - Clinical NLP / AI-in-Medicine, deployed CDS systems
- **Dr. Aaron Feld** - Health IT interoperability, FHIR/HL7, EHR-vendor background
- **Dr. Sofia Andersson** - AI safety, regulatory (FDA SaMD), clinical validation methodology

**Platform context for the panel:** Doc Ohara ingests unstructured docs → a "Space-Time Graph" in ArangoDB (`documents → sections → paragraphs/tables`, with `entities` extracted and SUMO-ontology-tagged, `MENTIONS`/`RELATED_TO`/`SIMILAR_TO` edges, cross-document Jaccard similarity, and a 5-phase hybrid BM25+graph retrieval engine that returns ranked results *with provenance* - source phase, edge verb, edge summary).

---

## Round 1 - Where's the actual gap in EMR/EHR?

**Castillo:** The gap isn't data capture, it's data *shape*. EHRs store encounters as flat timestamped blobs - notes, labs, orders - with almost no cross-encounter structure. Doc Ohara's core idea, turning unstructured text into a navigable graph instead of a flat chunk list, maps directly onto the "lost in the middle" problem clinicians have when scrolling a chart: critical context buried in note #47 of 200.

**Wu:** I'd sharpen that. The literature on clinical note retrieval (and frankly every CDS post-mortem I've reviewed) shows the failure mode is rarely "we didn't have the data" - it's "the system surfaced the wrong slice of a 40-page chart at decision time." That's a retrieval-ranking problem, not a data problem. So yes, this is squarely in-lane.

**Feld:** Caution before we get excited. EHR vendors already have structured graphs - FHIR resources are a graph (Patient → Encounter → Observation → Condition, etc.). The pitch can't be "EHRs have no structure," because they do. The pitch has to be "EHRs have no structure *for the unstructured 80%* - free-text notes, scanned referral letters, discharge summaries, faxed outside records." That's the actual white space.

**Andersson:** Agreed, and I'd add: that 80% is exactly where most diagnostic errors and missed follow-ups originate, per AHRQ's own diagnostic-safety reporting. So the target is right. The question is whether a generic document-graph engine, built and tuned on PDFs/EPUBs, survives contact with clinical text's actual failure modes - negation, temporality, hedge language ("possible," "cannot exclude"). That's not free.

---

## Round 2 - Structural fit: Space-Time Graph vs. FHIR

**Feld:** Let's be concrete. Doc Ohara's collections - `documents/sections/paragraphs/tables/entities` plus typed `edges` - are structurally *isomorphic* to a FHIR Bundle if you map `documents→DocumentReference`, `entities→Condition/MedicationStatement/Observation` mentions, `MENTIONS→extension/reference`. That's not a coincidence, that's just "graph of clinical concepts," which is what FHIR already is. The genuine new capability is the layer FHIR doesn't have: `SIMILAR_TO` edges and SUMO-tag-overlap scoring across *unstructured* documents that were never coded.

**Castillo:** Right - and that's the wedge. FHIR resources require someone (a coder, an NLP pipeline, a biller) to have already extracted structure. Doc Ohara's ingest pipeline - LLM structuring into DoCO nodes, entity extraction, ontology tagging - *is* that extraction step, running on the stuff that never gets coded: the referral letter, the outside-hospital discharge summary, the handwritten-then-scanned consult note.

**Wu:** I want to push on "Space-Time" specifically, because the name is doing real work here that the panel hasn't named yet. Longitudinal patient history *is* a space-time graph - same entity (a diagnosis, a medication) recurring across encounter-time with edges that should encode temporal precedence, not just co-occurrence. Right now `RELATED_TO` is symmetric, undirected, paragraph-co-occurrence-only. For clinical use you need `entity_A precedes entity_B by Δt`, `entity_A contradicts entity_B as of t2`. That's a meaningfully different edge semantics than what exists today.

**Andersson:** Which is the first real engineering gap, not just a "nice to have." Undirected co-occurrence edges actively mislead a clinician if "hypertension" and "discontinued lisinopril" get flattened into one symmetric relation with no timestamp ordering. You'd be building a system that looks rigorous and is quietly wrong.

**Feld:** Mitigatable - FHIR already timestamps everything (`Observation.effectiveDateTime`, `Encounter.period`). If ingest pulls structured timestamps from the source system alongside the free text, you inherit temporal ordering for free instead of trying to infer it from prose. Don't reinvent clinical temporal reasoning from scratch; bolt onto what FHIR already timestamps.

---

## Round 3 - Computer Vision: should imaging even be in scope?

**Subramaniam:** I'll be the one to ask the uncomfortable question: why is CV in this conversation at all? Doc Ohara's `tables` node type and figure handling suggest it already treats images as first-class - fine for a chart or a scanned page. But "bring CV into EMR" usually means radiology, pathology, dermatology images, and that is an entirely different regulatory and technical universe from text RAG. I don't think the platform should pretend otherwise.

**Castillo:** I'd push back gently. The architectural fit is real even if the modality is harder: a chest X-ray report and the image it describes are *already* a `MENTIONS`-style relation in clinical practice - "consolidation in the right lower lobe" (text entity) ↔ a specific image region (visual entity). If Doc Ohara's entity-extraction layer already produces `{canonical, type, document_ids}` nodes, extending `type` to include `IMAGING_FINDING` with a bounding-box or embedding pointer instead of forcing CV to live in a separate silo is structurally clean.

**Subramaniam:** Structurally clean, sure. But "clean graph schema" and "clinically safe CV pipeline" are not the same bar. A SUMO-tag-style ontology match on a radiology finding is not how radiology AI gets validated - you need per-finding sensitivity/specificity on a held-out, demographically-representative dataset, ideally FDA 510(k)-cleared if it touches diagnosis. Bolting an embedding into the graph as "just another entity" risks laundering an unvalidated CV model's output into the same trust tier as a board-certified radiologist's dictation. That's a real harm vector, not a hypothetical.

**Wu:** That's the crux. I'd draw the line exactly where Raj is drawing it: CV-as-*indexing* (let me search "studies similar to this one" by embedding similarity, surfaced as a retrieval candidate with a confidence-scored provenance tag) is defensible and useful. CV-as-*finding-generator* injected into the clinical narrative without a human-in-the-loop boundary is not - and is exactly the kind of feature that turns a documentation tool into a de facto diagnostic device under FDA's SaMD framework.

**Andersson:** Correct, and that reclassification is the single biggest risk on this whole roadmap. The moment retrieved CV output reads like a finding rather than "here are 3 prior similar images, ranked by embedding distance, for your review," you've likely crossed into Class II SaMD territory and need a wholly different validation, clearance, and liability posture. My recommendation: any imaging integration ships with retrieval-only framing, mandatory provenance display (which the platform already does well for text - `sources`, `edge_verb`, `edge_summary` - so extend that same provenance UI to imaging hits), and an explicit non-diagnostic disclaimer baked into the UI, not the README.

**Subramaniam:** With that framing - embeddings as a retrieval modality, never a finding generator - I'm on board. It's a meaningfully smaller, more honest scope than "CV in EMR" usually means, and I'd rather ship that than the alternative.

---

## Round 4 - Cross-document similarity for cohort discovery / population health

**Castillo:** The `SIMILAR_TO` edge with Jaccard-on-entity-sets plus LLM-enriched verb/summary is, I think, the single most differentiated piece of this whole platform for a research/population-health use case. Cohort discovery today is mostly "ICD code matches" - brittle, misses anything not perfectly coded. Entity-set similarity across free text could surface "these 40 patients have functionally the same presentation" even when their billing codes diverge.

**Feld:** Powerful, and also the part that scares me most from a de-identification standpoint. Cross-document similarity by definition requires comparing entity sets *across patients*, which means the moment you compute that Jaccard score you've already touched PHI from multiple individuals in one process - and the LLM-enrichment-on-each-edge step (Gemini generating verb/summary per `SIMILAR_TO` edge) means raw clinical entity text is being sent to a third-party model call, per edge, for what could be tens of thousands of patient-pairs. That's a BAA-and-data-residency conversation before it's an engineering conversation.

**Wu:** Agreed it needs a BAA-covered or self-hosted model for anything touching real PHI - not a blocker, just a deployment requirement, and one this team has presumably already solved for since they're calling Gemini API today on document content. The bigger open question for me is clinical validity, not privacy: does entity-Jaccard-similarity actually track clinical similarity, or does it mostly track *documentation-style* similarity - two notes written by the same attending using the same templated phrasing look "similar" for reasons that have nothing to do with the patient's condition. That needs a validation study against a clinician-labeled ground truth before anyone trusts a cohort built this way.

**Andersson:** That's the methodological trap I see constantly in informatics papers - conflating textual similarity with clinical similarity, then publishing a cohort-discovery tool that's secretly a writing-style classifier. I'd want a pilot explicitly designed to test that confound: same condition, different documenting clinicians/templates - does the similarity score survive?

---

## Round 5 - Hybrid retrieval as clinical decision support

**Wu:** This is where I think the platform's existing design choice is its strongest asset, and underappreciated by the team if they're not already pitching it this way: most clinical RAG failures I've seen in deployed systems come from "confident, plausible, source-free" answers. Doc Ohara's retrieval engine returns `{node, score, sources, edge_verb, edge_summary}` - meaning every result is traceable to *why* it surfaced. For a clinician, "why did the system show me this" is not a nice-to-have, it's the difference between a tool they'll trust and one they'll ignore after the first bad miss.

**Castillo:** Strongly agree, and I'd go further: the multi-phase fusion (BM25 + SUMO-tag overlap + cross-doc edges + entity pivot + structural traversal) is actually a *better* fit for clinical retrieval than a single dense-embedding RAG pipeline, because it's auditable phase-by-phase. If a result surfaced via "Phase 1c cross-doc edge," a clinician (or a QA reviewer) can interrogate that specific signal instead of treating the whole thing as an embedding black box.

**Andersson:** I'll be the dissenting voice on enthusiasm here. Auditability of the retrieval mechanism doesn't make the output safe to act on - it makes a *bad* output more diagnosable after the fact, which is necessary but not sufficient. If this sits in front of a clinician during an encounter, the generated `edge_summary` text (LLM-written) needs to be treated as a hypothesis pointer to the source paragraph, never as a standalone clinical statement. The interface design - does it read like a Google snippet or like medical advice - will determine whether this is a documentation aid or an unlicensed-practice liability.

**Feld:** Practically: this argues for shipping it first as a *clinician-facing chart-search tool*, not anything that auto-populates a note or surfaces inline during order entry. Lowest-risk integration point: "search this patient's full record, including scanned outside documents" - a feature most EHRs genuinely lack today - before anything that looks like decision support.

---

## Round 6 - Regulatory posture and where this actually slots into existing EHR workflows

**Andersson:** Building on Aaron's point - I'd formally scope an MVP as a *retrieval/search augmentation* sitting alongside the EHR (via FHIR DocumentReference ingestion, surfaced through SMART-on-FHIR launch into a side panel), explicitly not in the clinical decision pathway, not auto-suggesting diagnoses or orders. That keeps it out of SaMD Class II territory and lets the team get real clinician usage data without a multi-year clearance process.

**Feld:** That's also the only integration path that doesn't require rebuilding half the platform. SMART-on-FHIR launch context gives you patient ID and encounter context for free; Doc Ohara's ingest pipeline points at that patient's `DocumentReference` bundle instead of an arbitrary folder of PDFs. The hard part isn't the integration, it's operational: hospital document corpora are enormous and continuously growing, and the ingest pipeline as described (LLM structuring per chunk, cached by content hash) needs a sustained, not batch, ingestion mode if it's going to track a live EHR instead of a static document set.

**Wu:** And once it's scoped as search-augmentation, the validation bar drops from "clinical efficacy trial" to "does this measurably reduce time-to-find-relevant-history," which is a far more tractable usability study - comparative chart-review time, with and without the tool, on a matched note set. That's achievable in a single-site pilot in months, not years.

**Castillo:** Worth flagging for the roadmap: the cross-document `SIMILAR_TO`/cohort features from Round 4 are a *second*, later-stage product, with a materially different risk profile (population-level, research-adjacent) from the *first* product (single-patient chart search). They shouldn't ship in the same release or be validated by the same study design - conflating them is how a low-risk MVP quietly inherits the regulatory weight of the higher-risk feature.

---

## Round 7 - Synthesis: what's the concrete near-term pilot

**Panel consensus, with dissent noted:**

1. **MVP scope (no dissent):** Single-patient longitudinal chart search. Ingest a patient's unstructured `DocumentReference`s (scanned outside records, discharge summaries, consult notes) into the Space-Time Graph; surface via SMART-on-FHIR side panel; every result carries the existing provenance fields (`sources`, `edge_verb`, `edge_summary`) rendered visibly, not hidden in a tooltip.
2. **Defer, don't drop, imaging (Subramaniam/Andersson position prevails over Castillo's broader framing):** CV integration ships only as embedding-based retrieval-of-similar-prior-studies, never as a finding-generator, with explicit non-diagnostic UI framing.
3. **Edge semantics need a directed/temporal upgrade before clinical use (Wu's objection, unresolved):** `RELATED_TO`'s undirected, timestamp-free co-occurrence is flagged as a correctness risk for longitudinal use, not yet designed - open item for the engineering team, not the panel.
4. **Cross-document cohort/`SIMILAR_TO`-for-population-health is a distinct, later workstream (Feld/Andersson position):** gated behind a BAA-compliant or self-hosted model deployment, and a clinical-vs-documentation-style validation study (Wu's open methodological concern), not bundled into the MVP.
5. **Regulatory framing is the load-bearing constraint on the whole roadmap (Andersson, uncontested):** every feature decision above was shaped by staying on the search/retrieval side of the SaMD line; any future move toward "the system suggests X" needs a deliberate, separate regulatory conversation before it's an engineering ticket.

---

## Summary

**What Doc Ohara contributes to EMR/EHR:** a structure-extraction and retrieval layer for the ~80% of clinical documentation that never gets coded into FHIR resources - scanned outside records, referral letters, discharge summaries, consult notes - turned into a navigable, provenance-tracked graph instead of a flat chart timeline. Its phase-by-phase auditable retrieval (BM25 + ontology-tag overlap + cross-doc edges + entity pivot + structural traversal, each result tagged with its source signal) is a materially better fit for clinical trust requirements than an opaque dense-embedding RAG pipeline.

**Where it's structurally complementary to FHIR, not competing:** Doc Ohara's collections map cleanly onto FHIR resources (`documents→DocumentReference`, `entities→Condition/Observation` mentions); the genuine new capability is `SIMILAR_TO`/SUMO-tag scoring across unstructured text FHIR never touches. Integration path: SMART-on-FHIR launch into a side panel, ingesting a patient's `DocumentReference` bundle - not a rebuild of the EHR's existing structured graph.

**Open engineering gaps surfaced:**
- `RELATED_TO` edges are undirected and timestamp-free - a correctness risk for longitudinal/"space-time" use until upgraded to directed, time-ordered semantics (ideally inherited from FHIR's existing resource timestamps rather than inferred from prose).
- Ingest pipeline (LLM-structuring, cached by content hash) is batch-oriented; tracking a live EHR needs a sustained/streaming ingestion mode.

**Where the panel drew hard lines:**
- **Imaging/CV:** retrieval-of-similar-priors only, never a finding-generator - crossing that line risks reclassification as FDA Class II SaMD.
- **Cross-patient cohort discovery:** real research value, but requires (a) BAA-compliant/self-hosted model deployment before any cross-patient entity comparison touches real PHI, and (b) a validation study that explicitly tests whether "entity similarity" tracks clinical similarity or just documentation-style/template similarity.
- **Anything LLM-generated** (`edge_summary`, etc.) shown to a clinician must be framed as a pointer to source text, never a standalone clinical statement - an interface design problem as much as a technical one.

**Recommended first pilot:** single-patient chart search via SMART-on-FHIR, scoped strictly as retrieval/search augmentation (outside the clinical decision pathway), validated with a chart-review-time usability study rather than a clinical efficacy trial - keeping the MVP on the safe side of the SaMD line while generating real usage data to justify any later, higher-risk workstream (imaging, cohort discovery).
