import puppeteer from 'puppeteer-core';

const VIEWPORT = { width: 1920, height: 1080 };

const FETCH_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const BLOCK_PATTERNS = [
	// Cloudflare
	/<title>[^<]*(?:just a moment|attention required|cloudflare)[^<]*<\/title>/i,
	/cf-browser-verification/i,
	/cf_chl_opt/i,
	/\.cf-error-details/i,
	// JS required / SPA shell
	/<noscript>[^<]*(?:enable javascript|you need to enable javascript)/i,
	/id=["']__next["']>\s*<\/div>/i,
	/id=["']root["']>\s*<\/div>/i,
	/id=["']app["']>\s*<\/div>/i,
	// Recaptcha / bot challenge
	/www\.google\.com\/recaptcha/i,
	/grecaptcha\.execute/i,
	/hcaptcha\.com/i,
	// Rate limit / access denied
	/<title>[^<]*(?:403 forbidden|429|too many requests|access denied|rate limit)[^<]*<\/title>/i,
	// Login wall
	/<title>[^<]*(?:login|sign in|log in)[^<]*<\/title>/i,
];

function detectBlock(html, status) {
	if (status >= 400) return `HTTP ${status}`;
	const bodyLen = (html.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? '').trim().length;
	if (bodyLen < 512) return 'body too short (likely SPA shell or empty page)';
	for (const pat of BLOCK_PATTERNS) {
		if (pat.test(html)) return `matched block pattern: ${pat.source.slice(0, 60)}`;
	}
	return null;
}

/** Wrap a promise with a hard deadline that rejects with a clear message. */
function withTimeout(promise, ms, label) {
	return new Promise((resolve, reject) => {
		const t = setTimeout(() => reject(new Error(`timeout after ${ms}ms: ${label}`)), ms);
		promise.then(
			(v) => { clearTimeout(t); resolve(v); },
			(e) => { clearTimeout(t); reject(e); }
		);
	});
}

export async function connectBrowser() {
	if (!process.env.CLOAK_CDP) {
		throw new Error('CLOAK_CDP not set - run: ohara env set CLOAK_CDP <url>');
	}
	return puppeteer.connect({
		browserWSEndpoint: process.env.CLOAK_CDP.replace(/^http/, 'ws'),
	});
}

/**
 * Open a new page, navigate to url, capture content, then close the page.
 * Guarantees page.close() even on crash/timeout. Throws on failure - caller decides.
 */
export async function capturePage(browser, url, type = 'html', timeout = 30000) {
	let page;
	try {
		page = await withTimeout(browser.newPage(), 10000, `newPage(${url})`);
		await page.setViewport(VIEWPORT);
		// Use 'domcontentloaded' as fallback if networkidle2 never fires
		await withTimeout(
			page.goto(url, { waitUntil: 'networkidle2', timeout: 0 }),
			timeout,
			`goto(${url})`
		);
		switch (type) {
			case 'html': return await withTimeout(page.content(), 10000, `content(${url})`);
			case 'pdf':  return await withTimeout(page.pdf({ format: 'A4' }), 30000, `pdf(${url})`);
			case 'png':  return await withTimeout(page.screenshot({ fullPage: true }), 30000, `screenshot(${url})`);
			default: throw new Error(`Unknown type: ${type}. Use html | pdf | png`);
		}
	} finally {
		if (page) {
			try { await page.close(); } catch { /* already closed/crashed - ignore */ }
		}
	}
}

/**
 * Smart HTML fetch: plain HTTP first → validate → fall back to browser CDP.
 * Never throws due to browser crash - logs and re-throws as Error with context.
 */
export async function fetchHtml(browser, url, timeout = 30000) {
	// --- 1. Plain fetch ---
	let rawHtml = null;
	let fetchStatus = 0;
	let blockReason = null;

	try {
		const ctrl = new AbortController();
		const timer = setTimeout(() => ctrl.abort(), timeout);
		const res = await fetch(url, {
			headers: { 'User-Agent': FETCH_UA, 'Accept': 'text/html,application/xhtml+xml,*/*' },
			redirect: 'follow',
			signal: ctrl.signal,
		});
		clearTimeout(timer);
		fetchStatus = res.status;
		rawHtml = await res.text();
	} catch (err) {
		blockReason = `fetch error: ${err.message}`;
	}

	if (rawHtml !== null && blockReason === null) {
		blockReason = detectBlock(rawHtml, fetchStatus);
	}

	if (blockReason === null) {
		return { html: rawHtml, via: 'fetch' };
	}

	// --- 2. Browser fallback ---
	if (!browser) throw new Error(`fetch blocked (${blockReason}) and no browser provided`);

	process.stderr.write(`  [fetch blocked: ${blockReason}] → browser\n`);
	try {
		const html = await capturePage(browser, url, 'html', timeout);
		return { html, via: 'browser' };
	} catch (err) {
		throw new Error(`browser fallback failed for ${url}: ${err.message}`);
	}
}
