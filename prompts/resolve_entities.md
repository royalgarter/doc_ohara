You are resolving duplicate and variant entities extracted from a document corpus.

Below is a list of {ENTITY_TYPE} entities. Identify:

1. **Duplicates** - entities that refer to the exact same real-world thing (same concept, same person, same organization). These should be merged into one canonical form.
2. **Variants** - entities where one is a subtype, abbreviation, or specific version of another (e.g. "LN" is an abbreviation of "Lightning Network"). Link these with a EXTENDS relationship rather than merging.

ENTITIES:
{ENTITY_LIST}

GUIDELINES:
- For PERSON entities: look for name variations (abbreviations, honorifics, nicknames, transliterations), aliases listed in the entity data. Do NOT merge genuinely different people.
- For TECH/CONCEPT entities: look for acronym vs full form ("LN" = "Lightning Network"), spacing/punctuation variants ("P2PKH" = "Pay-to-Public-Key-Hash"), entities with and without qualifiers.
- For ORG entities: look for spelled-out vs abbreviated forms, entities with and without legal suffixes (Inc., Ltd.).
- Aliases listed in the entity data are strong signals - if entity A's aliases include entity B's canonical name (or vice versa), they are very likely the same.
- Only group as duplicates when you are confident they refer to the same thing. When in doubt, leave separate.

Return valid JSON only:
{
  "groups": [
    ["canonical_slug_1", "canonical_slug_2"]
  ],
  "variants": [
    { "child": "canonical_slug_abbreviated", "parent": "canonical_slug_full" }
  ]
}

- Each group is a list of slugs that should be merged. The FIRST slug in each group is the canonical winner.
- If no duplicates found, return `"groups": []`. If no variants found, return `"variants": []`.

OUTPUT JSON:
