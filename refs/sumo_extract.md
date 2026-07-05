To guarantee that your pipeline **never misses a single relevant SUMO tag** while using a high-throughput, low-latency model like **Gemini Flash Lite**, you cannot rely on a single, open-ended prompt. Even with its massive 1-million-token context window, long documents can suffer from "lost-in-the-middle" attention drift, or the model might get lazy and truncate lists to save output tokens.

To achieve 100% recall, you must implement a structured, multi-pass pipeline that forces the model to justify its tags with direct evidence. Here is the step-by-step instruction guide to building an unmissable SUMO tagging pipeline.

---

## Step 1: Enforce Determinism & Load the SUMO Schema

Before writing your prompt, you must configure your API call parameters to strip away the model's creativity. Creativity leads to omissions and loose interpretations.

* **Set `temperature = 0.0`:** This forces the model to choose the most statistically certain and literal mapping.
* **Leverage Context Caching:** If you are running multiple documents, cache the core SUMO upper-level hierarchy (the definitions of `Object`, `Process`, `Abstract`, etc.) in Gemini's context cache. This keeps latency lightning-fast and costs extremely low.

## Step 2: Use Strict Structured Outputs (JSON Schema)

Never let the model output free-form text or Markdown tables. Use Gemini’s native **Structured Outputs** feature by passing a strict JSON Schema or Pydantic model.

To ensure the model doesn't skip concepts, **force it to supply a direct quote from the text for every tag it creates.** This acts as an algorithmic anchor.

```json
{
  "type": "object",
  "properties": {
    "extracted_tags": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "sumo_class": { "type": "string" },
          "exact_document_quote": { "type": "string" },
          "logical_justification": { "type": "string" }
        },
        "required": ["sumo_class", "exact_document_quote", "logical_justification"]
      }
    }
  },
  "required": ["extracted_tags"]
}

```

## Step 3: Implement an Overlapping "Windowed" Read

While Gemini Flash Lite easily absorbs entire PDFs, models can exhibit attentional blindness over large blocks of text.

* **Divide the document:** Split your document into overlapping chunks (e.g., 1,000 words per chunk with a 200-word overlap).
* **Why overlap?** It prevents missing concepts that are split or bridged across paragraph boundaries.
* **Process sequentially or in parallel:** Because Flash Lite is highly cost-efficient and incredibly fast, running 5 to 10 chunks in parallel costs fractions of a cent and takes mere seconds.

## Step 4: Craft the "No-Omissions" System Prompt

Your prompt must frame omissions as a critical failure. Explicitly command the model to evaluate the text line-by-line.

> **System Instruction:**
> You are a formal ontological mapping engine. Your sole objective is to extract EVERY possible Suggested Upper Merged Ontology (SUMO) class present in the provided document chunk.
> **CRITICAL RULE:** Do not summarize. Do not combine distinct events. If a sentence contains an instance of a `Process` (e.g., "analyzing data"), an `Object` (e.g., "computer software"), and a `Nation` (e.g., "Vietnam"), you MUST output three separate tag objects. It is a critical failure to omit any valid concept. If you are unsure, include it and explain your reasoning in the `logical_justification` field.

## Step 5: Run a Secondary "Gap Analysis" Pass

This is the secret weapon for ensuring nothing is missed. Once Pass 1 finishes and compiles all unique tags, you run a secondary **Audit Pass** using a fresh Gemini Flash Lite instance.

You pass the model the original document chunk **plus** the tags extracted from Step 4.

> **Audit Prompt:**
> "Below is a document chunk and a list of SUMO tags already extracted from it. Your task is a gap analysis. Read the document line-by-line and identify any concepts, entities, time constraints, or processes that the existing tag list completely missed. Output ONLY the newly discovered tags using the exact same JSON schema. If nothing was missed, return an empty array."

## Step 6: Deduplicate and Flatten

Combine the results of your windowed passes and your audit passes into a master file. Group them by their parent categories using a simple script:

1. Merge identical `sumo_class` targets.
2. Aggregate the `exact_document_quote` strings so you can visually inspect which sentences triggered which classifications.
3. Automatically flag any tags that do not perfectly match the official vocabulary lists of the SUMO-WordNet lexicon mapping.

---

### Why this works with Flash Lite

By relying on **Windowing (Step 3)**, **Forced Quotes (Step 2)**, and an **Audit Pass (Step 5)**, you completely nullify the model's tendency to skip text or give up halfway through a long output. Because Gemini Flash Lite is optimized specifically for high-throughput, low-cost reasoning workflows, this comprehensive multi-step pipeline remains incredibly affordable and executes in seconds.
