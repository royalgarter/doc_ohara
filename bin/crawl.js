#!/usr/bin/env node
import 'dotenv/config';
import { loadEnvFromDB } from '../src/db/env.js';
import { connectBrowser, fetchHtml } from '../src/browser/index.js';
import { initArangoClient } from '../src/db/client.js';
import { program } from 'commander';

if (process.env.ARANGO_URL) await loadEnvFromDB();

program
	.name('crawl')
	.argument('<url>', 'Seed URL to crawl')
	.option('-d, --depth <n>', 'crawl depth (0=seed only, -1=infinite)', (v) => parseInt(v, 10), 0)
	.option('-p, --parallel <n>', 'concurrent pages', (v) => parseInt(v, 10), 1)
	.option('--timeout <ms>', 'navigation timeout per page in ms', (v) => parseInt(v, 10), 30000)
	.parse();

const [seedUrl] = program.args;
const { depth, parallel, timeout } = program.opts();

const ROOT_HOST = new URL(seedUrl).hostname;

const INVALID_HREF = /[\s()`${}[\]|\\^<>]|^(javascript|mailto|tel|data|blob|vbscript):/i;

function normalizeUrl(href, baseUrl) {
	if (!href || INVALID_HREF.test(href)) return null;
	try {
		// new URL handles absolute, protocol-relative (//), and relative (/path, path)
		const abs = new URL(href, baseUrl);
		if (abs.protocol !== 'http:' && abs.protocol !== 'https:') return null;
		if (abs.hostname !== ROOT_HOST) return null;
		// Strip fragment only; preserve query string
		abs.hash = '';
		let normalized = abs.href;
		if (normalized.endsWith('/') && normalized !== `${abs.protocol}//${abs.host}/`) {
			normalized = normalized.slice(0, -1);
		}
		return normalized;
	} catch {
		return null;
	}
}

function extractLinks(html, baseUrl) {
	const links = new Set();
	for (const m of html.matchAll(/href=["']([^"']+)["']/gi)) {
		const url = normalizeUrl(m[1].trim(), baseUrl);
		if (url) links.add(url);
	}
	return links;
}

async function ensureCrawlCollection(db) {
	const coll = db.collection('crawl');
	if (!(await coll.exists())) await db.createCollection('crawl');
	return coll;
}

const db = await initArangoClient();
const coll = await ensureCrawlCollection(db);
const browser = await connectBrowser();

const visited = new Set();
const queue = [{ url: seedUrl, currentDepth: 0 }];
const queued = new Set([seedUrl]);
let saved = 0;

async function processOne({ url, currentDepth }) {
	let html, via;
	try {
		({ html, via } = await fetchHtml(browser, url, timeout));
	} catch (err) {
		// Log and skip — never let one URL crash the crawl
		console.error(`  SKIP [${currentDepth}] ${url} — ${err.message}`);
		return;
	}

	visited.add(url);

	try {
		const key = Buffer.from(url).toString('base64url').slice(0, 254);
		await coll.save(
			{ _key: key, url, html, via, depth: currentDepth, crawledAt: new Date().toISOString() },
			{ overwriteMode: 'replace' }
		);
		saved++;
		console.log(`[${currentDepth}] ${url} (${html.length} bytes) [${via}] → saved`);
	} catch (err) {
		console.error(`  DB ERR ${url}: ${err.message}`);
		// Still extract links even if DB save failed
	}

	const canGoDeeper = depth === -1 || currentDepth < depth;
	if (canGoDeeper) {
		try {
			for (const link of extractLinks(html, url)) {
				if (!queued.has(link)) {
					queued.add(link);
					queue.push({ url: link, currentDepth: currentDepth + 1 });
				}
			}
		} catch (err) {
			console.error(`  LINK ERR ${url}: ${err.message}`);
		}
	}
}

try {
	while (queue.length > 0) {
		const batch = queue.splice(0, parallel);
		await Promise.all(batch.map(processOne));
	}
} finally {
	await browser.disconnect();
}

console.log(`\nDone. ${saved} pages saved to ArangoDB collection 'crawl'.`);
