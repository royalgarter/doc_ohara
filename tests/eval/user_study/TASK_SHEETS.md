# OHARA User Study — Task Sheets & Protocol

Implements the protocol in paper §6 ("Planned user study"). Within-subjects, n ≥ 8, two interfaces, counterbalanced. Corpus: the MultiHop-RAG news corpus (609 articles, Sep–Dec 2023) already ingested.

## Interfaces

| Code | Interface | URL |
|---|---|---|
| **FL** | Flat list (search + date/tag filters + section reader) | `http://<host>:6454/study.html` |
| **ST** | Sunburst-tunnel 3D graph | `http://<host>:6454/` (graph tab) |

Both read the same database. The flat-list page has a built-in task timer + JSON log export; for the ST interface the facilitator times with the same stopwatch convention (start on task read-aloud finish, stop on participant's verbal "done").

## Design

- Within-subjects: every participant does both interfaces.
- Two **matched task sets (A, B)** of equal difficulty; interface×set assignment is counterbalanced:

| Participant | First | Second |
|---|---|---|
| P1, P5 | FL + Set A | ST + Set B |
| P2, P6 | FL + Set B | ST + Set A |
| P3, P7 | ST + Set A | FL + Set B |
| P4, P8 | ST + Set B | FL + Set A |

- Warm-up (3 min, untimed, before each interface): "Find any document published in November 2023 and open one of its sections." Mitigates the 3D-navigation learning-curve risk; note observations but do not score.
- Measures per task: completion time (s), error (answer vs gold below), give-up (cap 5 min/task). Post-interface: SUS questionnaire (below). Post-session: preference + free comments.

## Task Set A

**A-T1 (temporal filtering)** — "Find all documents about **Sam Bankman-Fried / the FTX trial** published **before October 5, 2023**. Give the count and one title."
Gold: **3 documents** — `SBF's trial starts soon...` (2023-10-01), `SBF, riding high on FTX, reportedly offered $5B to Trump...` (2023-10-02), `Is Sam Bankman-Fried a bad man or a good boy?...` (2023-10-04, Fortune; a same-title Verge variant also dated 10-04 counts if present — accept 3 or 4). *(Facilitator: re-verify against DB before session; The FTX trial dated 2023-09-28 counts if participant includes it — accept 4/5 accordingly. Pin the exact gold list during pilot.)*

**A-T2 (topic tracing)** — "How did coverage of the **Taylor Swift / Travis Kelce relationship** evolve between September and December 2023? Name the earliest and the latest article on the topic."
Gold: earliest = `Fans spot Travis Kelce wearing Taylor Swift-themed friendship bracelet` or `When pop culture and sport collide` (both 2023-09-26); latest = `Taylor Swift is Time's Person of the Year` or `Taylor Swift reveals secret start to her relationship...` (both 2023-12-06). Score correct if both endpoints within ±1 document of these dates.

**A-T3 (structural lookup)** — "In the document **'2023 Kentucky online sports betting sites'**, find the section that discusses **how to claim a sportsbook promo / bonus**. Read out its section title."
Gold: the section whose title mentions promos/bonus claiming (verify exact title in DB during pilot; accept any section whose paragraphs describe bonus-claiming steps).

## Task Set B

**B-T1 (temporal filtering)** — "Find all documents about the **US v. Google antitrust trial** published **before November 1, 2023**. Give the count and one title."
Gold: **4 documents** — `Apple defends Google Search deal in court` (2023-09-26), `Amazon sellers sound off on the FTC's antitrust case` (2023-10-06, distractor: FTC≠Google — not counted; if counted, mark as error), `Is Google Search better than the rest?` (2023-10-22), `5 things we learned so far about the Google antitrust case` (2023-10-31). Accept 3–4 depending on whether the Pixel-8 digest (2023-10-07, tangential) is included; pin during pilot.

**B-T2 (topic tracing)** — "How did coverage of the **SBF/FTX trial** evolve between late September and November 2023? Name the earliest and the latest article on the topic."
Gold: earliest = `The FTX trial...` (2023-09-28); latest = `Sam Bankman-Fried...` (2023-10-31) or the jury piece (2023-10-28). Score correct if endpoints within ±1 document.

**B-T3 (structural lookup)** — "In the document **'Vermont sportsbook promos and sports betting launch news'**, find the section that discusses **which sportsbooks will launch in Vermont**. Read out its section title."
Gold: verify exact section title during pilot; accept any section whose paragraphs list launching operators.

## SUS Questionnaire (per interface, 1 = strongly disagree … 5 = strongly agree)

1. I think I would like to use this interface frequently.
2. I found the interface unnecessarily complex.
3. I thought the interface was easy to use.
4. I think I would need technical support to use this interface.
5. I found the various functions well integrated.
6. I thought there was too much inconsistency.
7. I imagine most people would learn this interface very quickly.
8. I found the interface very cumbersome to use.
9. I felt very confident using the interface.
10. I needed to learn a lot before I could get going.

Score: standard SUS scoring (odd items −1, even items 5−x, sum × 2.5 → 0–100).

## Facilitator checklist

- [ ] Server up (`npm start`), DB has 609 mhrag docs with dates (`study.html` shows them under date filter).
- [ ] **Pilot run (1 person, not counted)**: pin exact gold answer lists for all T1/T3 tasks above; adjust wording if any task takes < 30 s or > 5 min on both interfaces.
- [ ] Per participant: consent, 2× (warm-up → 3 tasks → SUS), preference question, export FL log JSON + facilitator sheet.
- [ ] Analysis: per-task median time + error rate per interface; paired comparison (Wilcoxon signed-rank given n=8); report per-participant learning effect (first vs second interface); honest reporting regardless of direction (paper §6 hypothesis: ST wins T1/T2, parity on T3).

## Result capture sheet (per participant)

| Field | Value |
|---|---|
| Participant ID / date | |
| Order (e.g. FL-A then ST-B) | |
| A/B-T1 time / answer / correct | |
| A/B-T2 time / answer / correct | |
| A/B-T3 time / answer / correct | |
| SUS (FL) / SUS (ST) | |
| Preference + comments | |
