# Brainstorm: Time Dimension for Doc Ohara Space-Time Graph

*Session: 2026-06-25*

---

## The Proposal

Doc Ohara calls itself a "Space-Time Graph" but currently only has Space:
- **Spatial axes**: document → section → paragraph (structural), entity/SUMO (semantic), SIMILAR_TO (cross-doc)
- **Time axis**: missing. Only `upload_time` exists - no published date, no covered period, no temporal decay in scoring.

The user's vision: documents are 2D semantic planes stacked on a timeline axis. Each document has a position in time (when it was created / what period it covers), and its influence degrades along that axis at a rate determined by document type.

---

## Panel: Three Expert Perspectives

### 🗄️ Dr. Archive (Library Science / Information Science)

**Two independent time axes exist - must not be conflated:**

1. **T_creation** - when the document was produced (publication date, commit date, broadcast date)
2. **T_coverage** - what period the *content* describes (a 2024 paper about the 1929 crash covers 1929–1933, not 2024)

These behave *oppositely* in retrieval:
- Query: *"what happened in 1929"* → high T_coverage relevance for 1929, regardless of T_creation
- Query: *"what do researchers think now"* → high T_creation recency, regardless of T_coverage

**Proposed schema fields on `documents`:**
```
published_date:          ISO date string (nullable)
temporal_coverage_start: ISO date string (nullable)
temporal_coverage_end:   ISO date string (nullable - open if ongoing)
temporal_granularity:    'day' | 'month' | 'year' | 'decade' | 'century'
temporal_confidence:     Number  // 0.0–1.0
temporal_needs_review:   Boolean // true = LLM extracted, awaiting human confirm
```

LLM extracts at ingest from front matter, abstract, byline - cheap (same call, extra JSON keys). Low-confidence extractions flagged for human review.

---

### 📊 Dr. Signal (Data Science / Information Retrieval)

**Decay taxonomy - four classes with distinct half-lives:**

| Class | Examples | Half-life | λ (decay rate) |
|---|---|---|---|
| `EVERGREEN` | Scientific laws, proofs, classic literature, famous history | Centuries → ∞ | 0.000001 |
| `SCHOLARLY` | Peer-reviewed papers, textbooks, encyclopedias | 5–20 years | 0.0001 |
| `CURRENT` | News articles, blog posts, forum threads, press releases | Weeks–months | 0.01 |
| `EPHEMERAL` | Social posts, changelogs, event announcements | Days | 0.1 |

**Decay function:**
```
temporal_score(doc, t_query) = exp(−λ · Δt)

where:
  Δt = (t_query − doc.published_date) in days
  λ  = decay_rate[doc.effective_decay_class]
```

**Integration into score fusion** (additive, never multiplicative):
```
fused_score += OHARA_TEMPORAL_WEIGHT × temporal_score
```
Default `OHARA_TEMPORAL_WEIGHT = 0.2` (conservative - see Gold Article Problem below).

**T_coverage scoring** (separate from decay):
When query contains a date hint (detected via `DATE` entity type), score by T_coverage overlap:
```
coverage_score = overlap(query_date_range, doc.temporal_coverage) / query_range_length
```
Additive with decay. A 1929 document about 1929 scores high even if old.

---

### 🧠 Dr. Logos (Philosophy of Knowledge / Epistemology)

**Three distinct kinds of "influence" that decay at different rates:**

1. **Epistemic authority** - how much we trust this document's claims as *currently true*
   - 1990 HIV treatment paper: low authority today (medicine advanced)
   - 1905 Einstein special relativity paper: full authority (theory unchanged)
   - Governed by: `decay_class` + domain (SUMO `Medicine` decays faster than `Mathematics`)

2. **Historical evidence weight** - how much this document *proves something happened*
   - A 1929 newspaper is *more* authoritative about 1929 than a 2024 retrospective
   - Decay should *reverse* for T_coverage queries - older primary sources gain authority

3. **Citation influence** - how much this document shaped subsequent documents
   - Proxied by SIMILAR_TO in-degree (many documents similar to this one → foundational)

**Query temporal intent classification** (add to `prompts/extract_query_fingerprint.md`):
```json
{
  "temporal_intent": "current_state" | "historical_fact" | "influence_chain" | "none"
}
```
- `current_state` → apply decay
- `historical_fact` → apply coverage alignment, invert decay for primary sources
- `influence_chain` → weight by SIMILAR_TO in-degree
- `none` → temporal weight = 0 (skip decay entirely)

**Key insight**: *Old ≠ Superseded.* A foundational 1953 paper hasn't decayed - the field still builds on it. The signal for supersession vs. foundation is whether newer documents *extend* or *contradict* the older one. This is available from the existing `verb` field on SIMILAR_TO edges.

---

## The Gold Article Problem

> What if decay buries a highly relevant "gold value" article containing critical, timeless information?

**Root cause**: Even additive decay drags down old documents relative to new ones with similar semantic scores.

### Five-Layer Defense Stack

**Layer 1: Temporal intent gate**
If query has no detected temporal intent → `OHARA_TEMPORAL_WEIGHT = 0`. Decay simply doesn't fire. Most archival and factual queries will fall here.

**Layer 2: Principal tier immunity**
Principal-tier nodes (multi-phase corroboration, already implemented) get `temporal_contribution = 0`. A gold article will appear in BM25 + entity pivot + SUMO simultaneously - Principal status makes it immune to decay.

**Layer 3: Semantic floor gate**
Nodes with `bm25_score > TEMPORAL_GATE_FLOOR` (default 0.5) get `temporal_contribution = 0`. Temporal only acts as tiebreaker in the weak-relevance band.

```
temporal_contribution(node) =
  if temporal_intent == 'none':           0   (no temporal query signal)
  elif node.tier == 'principal':          0   (Principal immunity)
  elif node.bm25_score > GATE_FLOOR:      0   (semantically strong, immune)
  else: OHARA_TEMPORAL_WEIGHT × exp(−λ × Δt)  (normal decay for weak candidates)
```

**Layer 4: Citation-aware class promotion**
High SIMILAR_TO in-degree OR edge `verb` semantically mapping to "extends/builds on" → auto-promote `effective_decay_class` to EVERGREEN. Computed post-ingest, updated incrementally.

SIMILAR_TO edge `verb` → `temporal_relation` mapping (no extra LLM call, derived from existing field):
- `"extends"`, `"builds on"`, `"is based on"` → `temporal_relation = 'extends'`
- `"contradicts"`, `"supersedes"`, `"corrects"`, `"refutes"` → `temporal_relation = 'supersedes'`
- everything else → `temporal_relation = 'discusses'`

Documents with many `extends` incoming edges → promote to EVERGREEN.
Documents with many `supersedes` incoming edges → bump decay class up one level (toward EPHEMERAL).

**Layer 5: Conservative default weight**
`OHARA_TEMPORAL_WEIGHT = 0.2` (not 0.3). Max temporal penalty < 0.2 points - never enough to bury a genuinely relevant result against a weak competitor.

**Net result**: Decay only meaningfully affects documents that are simultaneously:
- Weakly relevant semantically (low BM25, not Principal)
- Not foundational (low SIMILAR_TO in-degree, no `extends` incoming edges)
- Not flagged EVERGREEN by LLM

That is the correct population: old, weakly-relevant, non-foundational documents.

---

## Complete Schema Changes

### `documents` collection - new fields
```js
published_date:          String | null   // "YYYY-MM-DD" or partial "YYYY"
temporal_coverage_start: String | null   // what period content describes
temporal_coverage_end:   String | null   // null = open/ongoing
temporal_granularity:    String          // 'day'|'month'|'year'|'decade'|'century'
temporal_confidence:     Number          // 0.0–1.0 (LLM self-reported)
temporal_needs_review:   Boolean         // true = LLM-extracted, needs human confirm
decay_class:             String          // 'EVERGREEN'|'SCHOLARLY'|'CURRENT'|'EPHEMERAL'
decay_rate_override:     Number | null   // manual λ override (null = use class default)
effective_decay_class:   String          // computed post-ingest (may differ from decay_class)
similar_to_indegree:     Number          // count of incoming SIMILAR_TO edges
```

### `edges` collection (SIMILAR_TO only) - new field
```js
temporal_relation: String | null  // 'extends'|'supersedes'|'discusses'|null
                                  // derived from existing `verb` field at ingest time
                                  // no extra LLM call
```

### No new edge type needed
Timeline traversal uses AQL `FILTER / SORT doc.published_date` on existing collections. No PRECEDES edge - avoids O(n²) edge explosion.

---

## Env Vars to Add

```
OHARA_TEMPORAL_WEIGHT          = 0.2     # additive weight in score fusion
OHARA_TEMPORAL_MODE            = auto    # auto|decay|coverage|off
OHARA_TEMPORAL_GATE_FLOOR      = 0.5     # semantic score above which decay = 0
OHARA_DECAY_RATE_EVERGREEN     = 0.000001
OHARA_DECAY_RATE_SCHOLARLY     = 0.0001
OHARA_DECAY_RATE_CURRENT       = 0.01
OHARA_DECAY_RATE_EPHEMERAL     = 0.1
OHARA_SIMILAR_TO_EVERGREEN_THRESHOLD = 5  # min in-degree to auto-promote to EVERGREEN
```
