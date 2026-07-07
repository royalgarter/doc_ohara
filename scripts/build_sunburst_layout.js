#!/usr/bin/env node
// Compute sunburst polar layout for SUMO categories and bake into sumo_tag_categories.json.
// Angle: recursive angular partition of the category tree, slice width proportional to
// SUMO tag count per subtree (corpus-independent → stable across sessions).
// Output: cat_layout = { <category>: { theta: <rad>, a0: <rad>, a1: <rad> } }

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ONTOLOGY_DIR = path.join(__dirname, '..', 'ontology');
const CAT_FILE = path.join(ONTOLOGY_DIR, 'sumo_tag_categories.json');
const HIER_FILE = path.join(ONTOLOGY_DIR, 'sumo_hierarchy.json');

const cats = JSON.parse(fs.readFileSync(CAT_FILE, 'utf8'));
const hierarchy = JSON.parse(fs.readFileSync(HIER_FILE, 'utf8'));

const categorySet = new Set(cats.categories);

// Tag count per category (slice weight)
const tagCount = {};
for (const cat of Object.values(cats.map)) tagCount[cat] = (tagCount[cat] || 0) + 1;

// Parent of a category = nearest ancestor (BFS up sumo_hierarchy) that is itself a category
function categoryParent(cat) {
	const seen = new Set([cat]);
	let frontier = hierarchy[cat] || [];
	while (frontier.length) {
		const next = [];
		for (const p of frontier) {
			if (seen.has(p)) continue;
			seen.add(p);
			if (categorySet.has(p)) return p;
			next.push(...(hierarchy[p] || []));
		}
		frontier = next;
	}
	return null;
}

const children = { __root__: [] };
for (const cat of cats.categories) {
	const parent = categoryParent(cat) || '__root__';
	(children[parent] = children[parent] || []).push(cat);
}

// Subtree weight = own tag count + descendants.
// sqrt damping: raw tag counts are dominated by Artifact (military hardware lists),
// which would starve the Abstract half of angular room.
function subtreeWeight(cat) {
	let w = Math.sqrt(tagCount[cat] || 1);
	for (const c of children[cat] || []) w += subtreeWeight(c);
	return w;
}

// Recursive angular partition with a minimum slice floor
const MIN_SLICE = (8 * Math.PI) / 180;
const catLayout = {};

function partition(cat, a0, a1) {
	if (cat !== '__root__') {
		catLayout[cat] = {
			theta: +((a0 + a1) / 2).toFixed(4),
			a0: +a0.toFixed(4),
			a1: +a1.toFixed(4),
		};
	}
	const kids = (children[cat] || []).slice().sort((a, b) => subtreeWeight(b) - subtreeWeight(a));
	if (!kids.length) return;
	const span = a1 - a0;
	const weights = kids.map(subtreeWeight);
	const totalW = weights.reduce((s, w) => s + w, 0);
	// Proportional slices, clamped to floor (when span allows), renormalized
	let slices = weights.map(w => (w / totalW) * span);
	if (span >= kids.length * MIN_SLICE) {
		let deficit = 0, flexible = 0;
		slices = slices.map(s => { if (s < MIN_SLICE) { deficit += MIN_SLICE - s; return MIN_SLICE; } flexible += s; return s; });
		if (deficit > 0 && flexible > 0) slices = slices.map(s => s > MIN_SLICE ? s - (deficit * (s / flexible)) : s);
	}
	let cursor = a0;
	kids.forEach((kid, i) => {
		partition(kid, cursor, cursor + slices[i]);
		cursor += slices[i];
	});
}

partition('__root__', 0, 2 * Math.PI);

cats.cat_layout = catLayout;
fs.writeFileSync(CAT_FILE, JSON.stringify(cats));
console.log(`Wrote cat_layout for ${Object.keys(catLayout).length} categories to ${CAT_FILE}`);
const roots = children.__root__;
console.log('Top-level slices:', roots.map(r => `${r}:${((catLayout[r].a1 - catLayout[r].a0) * 180 / Math.PI).toFixed(0)}°`).join(' '));
