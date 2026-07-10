#!/usr/bin/env node
// §7.4 Visualization efficiency benchmark + §6 screenshots.
// Drives the real app in headless Chrome: selects N docs, times renderGraph,
// samples FPS + JS heap, captures color-mode screenshots.
//
// Prereqs: OHARA server running (node --env-file=.env server.js),
//          chrome-headless-shell installed (npx @puppeteer/browsers install chrome-headless-shell@stable)
//
// Usage: node tests/eval/bench_viz.js [--url=http://127.0.0.1:6454] [--sizes=10,25,50,100,200] [--shots]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

const URL_BASE = process.argv.find(a => a.startsWith('--url='))?.split('=')[1] || 'http://127.0.0.1:6454';
const SIZES = (process.argv.find(a => a.startsWith('--sizes='))?.split('=')[1] || '10,25,50,100,200').split(',').map(Number);
const SHOTS = process.argv.includes('--shots');
const OUT_DIR = path.join(ROOT, 'eval', 'viz');

function findChrome() {
	// ARM64 host: Google ships no linux-arm Chrome; use snap chromium.
	for (const p of ['/snap/bin/chromium', '/usr/bin/chromium', '/usr/bin/chromium-browser']) {
		if (fs.existsSync(p)) return p;
	}
	throw new Error('chromium not found - install: sudo snap install chromium');
}

async function alpine(page, fn, ...args) {
	return page.evaluate((body, a) => {
		const comp = Alpine.$data(document.querySelector('[x-data]'));
		return new Function('comp', ...a.map((_, i) => 'arg' + i), body)(comp, ...a);
	}, fn, args);
}

async function main() {
	fs.mkdirSync(OUT_DIR, { recursive: true });
	const browser = await puppeteer.launch({
		executablePath: findChrome(),
		args: ['--no-sandbox', '--enable-precise-memory-info', '--window-size=1920,1080', '--use-angle=swiftshader'],
		defaultViewport: { width: 1920, height: 1080 },
	});
	const page = await browser.newPage();
	page.on('pageerror', e => console.error('  [page]', e.message.slice(0, 120)));
	await page.goto(URL_BASE, { waitUntil: 'networkidle2', timeout: 60000 });
	await page.waitForFunction('window.Alpine && Alpine.$data(document.querySelector("[x-data]"))', { timeout: 30000 });

	// Instrument renderGraph with a timer before entering graph tab
	await page.evaluate(() => {
		window.__renderMs = 0;
		const orig = window.renderGraph;
		window.renderGraph = (...a) => {
			const t0 = performance.now();
			const r = orig(...a);
			window.__renderMs = performance.now() - t0;
			return r;
		};
	});

	await alpine(page, 'comp.tab = "graph";');
	await page.waitForFunction('Alpine.$data(document.querySelector("[x-data]")).graphData.documents.length > 0', { timeout: 30000 });

	const results = [];
	for (const n of SIZES) {
		const info = await page.evaluate(async (count) => {
			const comp = Alpine.$data(document.querySelector('[x-data]'));
			// UI doc list defaults to 50; page through /api/documents (max 200/call) as needed
			while (comp.graphData.documents.length < count) {
				const d = await fetch(`/api/documents?limit=200&offset=${comp.graphData.documents.length}`).then(r => r.json());
				if (!d.documents?.length) break;
				const have = new Set(comp.graphData.documents.map(x => x._key));
				comp.graphData.documents.push(...d.documents.filter(x => !have.has(x._key)));
			}
			const docs = comp.graphData.documents.slice(0, count);
			comp.selectedDocKeys = new Set(docs.map(d => d._key || d.id));
			await comp.loadDocGraph();
			await new Promise(r => setTimeout(r, 300)); // let $nextTick render settle
			const g = comp.graphData;
			const nodes = g.documents.length + g.sections.length + g.paragraphs.length + g.tables.length + (g.entities || []).length;
			// FPS: count rAF ticks over 2s while orbit idles
			const frames = await new Promise(res => {
				let f = 0; const t0 = performance.now();
				const tick = () => { f++; performance.now() - t0 < 2000 ? requestAnimationFrame(tick) : res(f); };
				requestAnimationFrame(tick);
			});
			return {
				docs: count,
				nodes,
				edges: g.edges.length,
				render_ms: Math.round(window.__renderMs * 10) / 10,
				fps: Math.round(frames / 2),
				heap_mb: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null,
			};
		}, n);
		results.push(info);
		console.log(`docs=${info.docs} nodes=${info.nodes} edges=${info.edges} render=${info.render_ms}ms fps=${info.fps} heap=${info.heap_mb}MB`);
		if (SHOTS && n === 25) {
			for (const mode of ['doc', 'type', 'sumo']) {
				await alpine(page, `comp.colorMode = arg0; comp.renderCurrentGraph();`, mode);
				await new Promise(r => setTimeout(r, 1500));
				const shot = path.join(OUT_DIR, `graph_${mode}_${n}docs.png`);
				await page.screenshot({ path: shot });
				console.log('  screenshot →', shot);
			}
		}
	}

	const outPath = path.join(OUT_DIR, `viz_bench_${new Date().toISOString().slice(0, 19).replace(/[:]/g, '-')}.json`);
	fs.writeFileSync(outPath, JSON.stringify({ run_at: new Date().toISOString(), url: URL_BASE, results }, null, 2));
	console.log('Report →', outPath);
	await browser.close();
}

main().catch(err => { console.error(err); process.exit(1); });
