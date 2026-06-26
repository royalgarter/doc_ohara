#!/usr/bin/env node

import * as fs from 'fs';
import Anthropic from '@anthropic-ai/sdk';

async function verifyWithClaude() {
	const rawData = fs.readFileSync('/tmp/bitcoin_raw_dump.txt', 'utf8');

	const client = new Anthropic();

	const prompt = `You are analyzing ingest data from a Bitcoin textbook (Mastering Bitcoin 2nd edition).
Review the structured data below and verify:

1. **SUMO Tag Accuracy**: Do the semantic tags (SUMO ontology) match the paragraph content? Examples: is "Transaction" tagged on transaction paragraphs, "Mining" on mining content, etc. Flag any mismatches.

2. **Entity Extraction Quality**: Are named entities correctly identified and categorized? Check for:
   - Duplicates or misspellings (e.g., "bitcoin" vs "Bitcoin", "satoshi-nakamoto" vs "Satoshi Nakamoto")
   - Over-extraction (e.g., random hex strings tagged as entities)
   - Missing key entities (e.g., "blockchain" not extracted)

3. **Hierarchy Correctness**: Verify section-paragraph nesting makes semantic sense. Are paragraphs logically grouped under sections?

4. **Domain Coverage**: Is the Bitcoin content comprehensive? Check for: blockchain concepts, transactions, wallets, mining, consensus, keys, addresses.

RAW DATA (first 50KB):
---
${rawData.slice(0, 50000)}
---

Provide concise findings on each category. Use format:
## Category Name
- Issue description (or "✓ OK")
- Examples if any`;

	console.log('Sending to Claude API for verification...');
	const response = await client.messages.create({
		model: 'claude-opus-4-8',
		max_tokens: 2000,
		messages: [
			{
				role: 'user',
				content: prompt,
			},
		],
	});

	const result = response.content[0].type === 'text' ? response.content[0].text : '';
	fs.writeFileSync('/tmp/llm_verify_output.txt', result);
	console.log('✓ Verification complete\n');
	console.log(result);
}

verifyWithClaude().catch(err => {
	console.error(err);
	process.exit(1);
});
