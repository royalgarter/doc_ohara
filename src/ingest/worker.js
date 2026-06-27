// Doc_Ohara: Job processor for the ingestion queue (src/queue.js).
// Pulls 'ingestion' jobs and runs them through pipeline_runner.ingestSingleFile,
// reporting progress and retrying transient OOM / Gemini rate-limit failures.
import { getIngestionQueue } from './queue.js';
import { ingestSingleFile } from './ingest.js';

const RETRYABLE_CODES = new Set(['OOM', 'RATE_LIMIT']);
const NON_ERROR_CODES = new Set(['ALREADY_INGESTED']);

async function processJob(queue, job, aiKey) {
	queue.update(job.id, { status: 'active', progress: 0, progressMessage: 'Starting...' });

	try {
		const result = await ingestSingleFile(job.data.filename, aiKey, (progress, message) => {
			queue.update(job.id, { progress, progressMessage: message });
		}, { force: !!job.data.force });
		queue.update(job.id, { status: 'completed', progress: 100, result, error: null });
		return result;
	} catch (err) {
		// ALREADY_INGESTED is not a failure — mark completed with a skipped flag
		if (NON_ERROR_CODES.has(err.code)) {
			const result = { skipped: true, reason: err.message, existingDoc: err.existingDoc };
			queue.update(job.id, { status: 'completed', progress: 100, result, error: null });
			return result;
		}

		const attempts = job.attempts + 1;
		const retryable = RETRYABLE_CODES.has(err.code);

		if (retryable && attempts < job.maxAttempts) {
			const backoffMs = 500 * attempts;
			queue.update(job.id, {
				status: 'waiting',
				attempts,
				error: `${err.message} (retrying in ${backoffMs}ms, attempt ${attempts}/${job.maxAttempts})`
			});
			await new Promise(res => setTimeout(res, backoffMs));
			return processJob(queue, queue.getJob(job.id), aiKey);
		}

		queue.update(job.id, { status: 'failed', attempts, error: err.message });
		throw err;
	}
}

// Drains all currently waiting jobs once (used by the CLI, which is a short-lived process).
export async function runWorkerOnce(aiKey) {
	const queue = getIngestionQueue();
	const processed = [];
	let job = queue.claimNext();
	while (job) {
		try {
			const result = await processJob(queue, job, aiKey);
			processed.push({ jobId: job.id, success: true, result });
		} catch (err) {
			processed.push({ jobId: job.id, success: false, error: err.message });
		}
		job = queue.claimNext();
	}
	return processed;
}

// Long-running mode: polls for new jobs forever (used for `ohara worker --watch` / server boot).
export function startWorkerLoop(aiKey, intervalMs = 1000) {
	const queue = getIngestionQueue();
	let stopped = false;

	const tick = async () => {
		if (stopped) return;
		const job = queue.claimNext();
		if (job) {
			try {
				await processJob(queue, job, aiKey);
			} catch {
				// already recorded on the job; keep the loop alive
			}
		}
		setTimeout(tick, intervalMs);
	};

	tick();
	return () => { stopped = true; };
}
