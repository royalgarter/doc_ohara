#!/usr/bin/env node
import 'dotenv/config';
import { loadEnvFromDB } from '../src/db/env.js';
import { connectBrowser, capturePage, fetchHtml } from '../src/browser/index.js';
import { writeFileSync } from 'fs';
import { program } from 'commander';
import path from 'path';

if (process.env.ARANGO_URL) await loadEnvFromDB();

program
	.name('capture')
	.argument('<url>', 'URL to capture')
	.option('-t, --type <type>', 'output type: html | pdf | png', 'png')
	.option('-o, --out <file>', 'output file path (default: stdout for html, ./capture.<ext> for binary)')
	.option('--timeout <ms>', 'navigation timeout in ms', (v) => parseInt(v, 10), 30000)
	.parse();

const [url] = program.args;
const { type, out, timeout } = program.opts();

const browser = await connectBrowser();
try {
	let result;
	if (type === 'html') {
		const { html, via } = await fetchHtml(browser, url, timeout);
		process.stderr.write(`via: ${via}\n`);
		result = html;
	} else {
		result = await capturePage(browser, url, type, timeout);
	}

	if (type === 'html') {
		if (out) writeFileSync(out, result);
		else process.stdout.write(result);
	} else {
		const dest = out || `capture.${type}`;
		writeFileSync(dest, result);
		console.error(`${type.toUpperCase()} → ${path.resolve(dest)}`);
	}
} finally {
	await browser.disconnect();
}
