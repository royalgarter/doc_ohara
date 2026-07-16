#!/usr/bin/env node
// Publication-quality screenshots for paper §6: fitted camera (_g3dResetCamera)
// + sunburst guide view, 1920×1080 @2× DPI, three color modes + one guide close-up.
// Prereq: OHARA server running. Usage: node tests/eval/shoot_pub.js [--url=...] [--docs=25]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const URL_BASE = process.argv.find(a => a.startsWith('--url='))?.split('=')[1] || 'http://127.0.0.1:6454';
const N_DOCS = parseInt(process.argv.find(a => a.startsWith('--docs='))?.split('=')[1] || '25', 10);
const OUT_DIR = path.join(ROOT, 'eval', 'viz');

function findChrome() {
	for (const p of ['/snap/bin/chromium', '/usr/bin/chromium', '/usr/bin/chromium-browser']) {
		if (fs.existsSync(p)) return p;
	}
	throw new Error('chromium not found - install: sudo snap install chromium');
}

async function main() {
	fs.mkdirSync(OUT_DIR, { recursive: true });
	const browser = await puppeteer.launch({
		executablePath: findChrome(),
		args: ['--no-sandbox', '--window-size=1920,1080', '--use-angle=swiftshader'],
		defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 2 },
	});
	const page = await browser.newPage();
	page.on('pageerror', e => console.error('  [page]', e.message.slice(0, 120)));
	await page.goto(URL_BASE, { waitUntil: 'networkidle2', timeout: 60000 });
	await page.waitForFunction('window.Alpine && Alpine.$data(document.querySelector("[x-data]"))', { timeout: 30000 });

	// The app's _g3dResetCamera uses Box3.expandByObject, which ignores InstancedMesh
	// instance matrices → tiny box at origin. Fit from instance positions instead.
	await page.evaluate(() => {
		window.fitCameraInstanced = () => {
			const box = new THREE.Box3();
			const m = new THREE.Matrix4(), v = new THREE.Vector3();
			let n = 0;
			for (const mesh of (G3D.nodeMeshes || [])) {
				for (let i = 0; i < mesh.count; i++) {
					mesh.getMatrixAt(i, m);
					v.setFromMatrixPosition(m);
					box.expandByPoint(v);
					n++;
				}
			}
			if (!n) return { n };
			const center = new THREE.Vector3(), size = new THREE.Vector3();
			box.getCenter(center); box.getSize(size);
			const maxDim = Math.max(size.x, size.y, size.z, 1);
			const fov = G3D.camera.fov * (Math.PI / 180);
			const camDist = (maxDim / 2) / Math.tan(fov / 2) * 1.15;
			G3D.controls.target.copy(center);
			const side = size.x / 2 || 100;
			G3D.camera.position.set(center.x + side * 0.9, center.y + side * 0.55, center.z - camDist * 0.8);
			G3D.camera.lookAt(center);
			G3D.controls.update();
			return { n, size: size.toArray().map(Math.round), pos: G3D.camera.position.toArray().map(Math.round) };
		};
		Alpine.$data(document.querySelector('[x-data]')).tab = 'graph';
	});
	await page.waitForFunction('Alpine.$data(document.querySelector("[x-data]")).graphData.documents.length > 0', { timeout: 30000 });

	// Select N docs spread across publication months (tunnel needs multiple Z buckets)
	// and render at month resolution.
	await page.evaluate(async (count) => {
		const comp = Alpine.$data(document.querySelector('[x-data]'));
		let offset = 0, all = [];
		while (true) {
			const d = await fetch(`/api/documents?limit=200&offset=${offset}`).then(r => r.json());
			if (!d.documents?.length) break;
			all.push(...d.documents);
			offset += 200;
			if (offset >= (d.total || 0)) break;
		}
		const dated = all.filter(d => (d.source_file || '').startsWith('mhrag_') && d.published_date);
		const byMonth = {};
		for (const d of dated) (byMonth[d.published_date.slice(0, 7)] ||= []).push(d);
		const months = Object.keys(byMonth).sort();
		const perMonth = Math.ceil(count / months.length);
		const picked = months.flatMap(m => byMonth[m].slice(0, perMonth)).slice(0, count);
		const have = new Set(comp.graphData.documents.map(x => x._key));
		comp.graphData.documents.push(...picked.filter(x => !have.has(x._key)));
		comp.selectedDocKeys = new Set(picked.map(d => d._key));
		comp.timelineResolution = 'month';
		await comp.loadDocGraph();
		await new Promise(r => setTimeout(r, 500));
	}, N_DOCS);

	const shoot = async (name) => {
		await new Promise(r => setTimeout(r, 2000));
		const shot = path.join(OUT_DIR, `pub_${name}_${N_DOCS}docs.png`);
		await page.screenshot({ path: shot });
		console.log('screenshot →', shot);
	};

	for (const mode of ['doc', 'type', 'sumo']) {
		await page.evaluate((m) => {
			const comp = Alpine.$data(document.querySelector('[x-data]'));
			comp.colorMode = m;
			comp.graphZoom = 1.0;
			comp.renderCurrentGraph();
		}, mode);
		await new Promise(r => setTimeout(r, 2000)); // let async render settle before fitting
		const cam = await page.evaluate(() => fitCameraInstanced());
		console.log(`  [${mode}] fit:`, JSON.stringify(cam));
		await shoot(mode);
	}

	// Oblique tunnel view: camera off to the side so the temporal Z axis (month
	// buckets, topic columns, decay auras stretching along time) reads as depth.
	await page.evaluate(() => {
		const comp = Alpine.$data(document.querySelector('[x-data]'));
		comp.colorMode = 'sumo';
		comp.graphZoom = 1.0;
		comp.renderCurrentGraph();
	});
	await new Promise(r => setTimeout(r, 2000));
	await page.evaluate(() => {
		fitCameraInstanced();
		const c = G3D.controls.target.clone();
		G3D.camera.position.set(c.x + 1500, c.y + 600, c.z - 1300);
		G3D.camera.lookAt(c.x, c.y, c.z + 200);
		G3D.controls.update();
	});
	await shoot('tunnel_oblique');

	await browser.close();
}

main().catch(err => { console.error(err); process.exit(1); });
