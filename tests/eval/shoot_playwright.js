#!/usr/bin/env node
// Playwright capture: three concept-explaining camera angles for the paper.
// (1) tunnel_oblique — time (Z) reads as depth, topic columns visible.
// (2) sunburst_top — ontology cross-section (XY plane), looking down +Z.
// (3) disc_closeup — single document's radial structural rings.
// Prereq: OHARA server running at --url (default http://127.0.0.1:6454).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const URL_BASE = process.argv.find(a => a.startsWith('--url='))?.split('=')[1] || 'http://127.0.0.1:6454';
const N_DOCS = parseInt(process.argv.find(a => a.startsWith('--docs='))?.split('=')[1] || '25', 10);
const OUT_DIR = path.join(ROOT, 'eval', 'viz');

async function main() {
	fs.mkdirSync(OUT_DIR, { recursive: true });
	const browser = await chromium.launch({ args: ['--use-angle=swiftshader'] });
	const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 });
	page.on('pageerror', e => console.error('  [page]', e.message.slice(0, 120)));

	await page.goto(URL_BASE, { waitUntil: 'networkidle', timeout: 60000 });
	await page.waitForFunction('window.Alpine && Alpine.$data(document.querySelector("[x-data]"))', { timeout: 30000 });

	await page.evaluate(() => {
		window.fitCameraInstanced = function () {
			const box = new THREE.Box3();
			const m = new THREE.Matrix4(), v = new THREE.Vector3();
			for (const mesh of G3D.nodeMeshes || []) {
				if (!mesh?.isInstancedMesh) continue;
				for (let i = 0; i < mesh.count; i++) {
					mesh.getMatrixAt(i, m);
					v.setFromMatrixPosition(m);
					box.expandByPoint(v);
				}
			}
			if (box.isEmpty()) return null;
			const center = new THREE.Vector3(), size = new THREE.Vector3();
			box.getCenter(center);
			box.getSize(size);
			const maxDim = Math.max(size.x, size.y, size.z, 1);
			const fov = G3D.camera.fov * (Math.PI / 180);
			const dist = (maxDim / 2) / Math.tan(fov / 2) * 1.15;
			G3D.controls.target.copy(center);
			G3D.camera.near = Math.max(1, dist / 100);
			G3D.camera.position.set(center.x + dist * 0.9, center.y + dist * 0.55, center.z + dist * 0.8);
			G3D.camera.lookAt(center);
			G3D.camera.updateProjectionMatrix();
			G3D.controls.update();
			return { size: size.toArray().map(Math.round), pos: G3D.camera.position.toArray().map(Math.round), center: center.toArray().map(Math.round) };
		};
	});

	await page.waitForFunction(
		() => Alpine.$data(document.querySelector('[x-data]')).tab !== undefined
	);
	await page.evaluate(() => { Alpine.$data(document.querySelector('[x-data]')).tab = 'graph'; });
	await page.waitForFunction(
		() => (Alpine.$data(document.querySelector('[x-data]')).graphData?.documents?.length || 0) >= 0,
		{ timeout: 30000 }
	);

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
		const shot = path.join(OUT_DIR, `pw_${name}_${N_DOCS}docs.png`);
		await page.screenshot({ path: shot });
		console.log('screenshot ->', shot);
	};

	// Baseline render, color-by-doc (ontology clusters legible).
	await page.evaluate(() => {
		const comp = Alpine.$data(document.querySelector('[x-data]'));
		comp.colorMode = 'doc';
		comp.graphZoom = 1.0;
		comp.renderCurrentGraph();
	});
	await new Promise(r => setTimeout(r, 2000));

	// (1) Tunnel oblique: time as depth, topic columns visible.
	const cam1 = await page.evaluate(() => {
		fitCameraInstanced();
		const c = G3D.controls.target.clone();
		G3D.camera.position.set(c.x + 1600, c.y + 500, c.z - 1500);
		G3D.camera.lookAt(c.x, c.y, c.z + 300);
		G3D.controls.update();
		return { pos: G3D.camera.position.toArray().map(Math.round) };
	});
	console.log('  [tunnel_oblique] cam:', JSON.stringify(cam1));
	await shoot('tunnel_oblique');

	// (2) Sunburst top-down: ontology XY cross-section, camera above looking down.
	const cam2 = await page.evaluate(() => {
		const c = G3D.controls.target.clone();
		const box = new THREE.Box3();
		const m = new THREE.Matrix4(), v = new THREE.Vector3();
		for (const mesh of G3D.nodeMeshes || []) {
			if (!mesh?.isInstancedMesh) continue;
			for (let i = 0; i < mesh.count; i++) { mesh.getMatrixAt(i, m); v.setFromMatrixPosition(m); box.expandByPoint(v); }
		}
		const size = new THREE.Vector3();
		box.getSize(size);
		const dist = Math.max(size.x, size.z, 800) * 0.9;
		G3D.camera.position.set(c.x, c.y + dist, c.z + 1);
		G3D.camera.lookAt(c.x, c.y, c.z);
		G3D.controls.update();
		return { pos: G3D.camera.position.toArray().map(Math.round) };
	});
	console.log('  [sunburst_top] cam:', JSON.stringify(cam2));
	await shoot('sunburst_top');

	// (3) Close-up on the document with the most structural children (richest disc).
	const cam3 = await page.evaluate(() => {
		const entries = G3D.nodeEntries || [];
		const docs = entries.filter(e => e.colKey === 'document');
		if (!docs.length) return null;
		let best = docs[0], bestCount = -1;
		for (const d of docs) {
			const docKey = d.node?._key;
			const count = entries.filter(e => e.node?.document_id === docKey).length;
			if (count > bestCount) { bestCount = count; best = d; }
		}
		const target = new THREE.Vector3(best.x, best.y, best.z);
		const R = Math.max(best.r || 150, 150);
		G3D.controls.target.copy(target);
		G3D.camera.position.set(target.x + R * 2.6, target.y + R * 2.0, target.z + R * 2.6);
		G3D.camera.lookAt(target);
		G3D.controls.update();
		return { pos: G3D.camera.position.toArray().map(Math.round), target: target.toArray().map(Math.round), r: R, bestCount };
	});
	console.log('  [disc_closeup] cam:', JSON.stringify(cam3));
	await shoot('disc_closeup');

	await browser.close();
}

main().catch(err => { console.error(err); process.exit(1); });
