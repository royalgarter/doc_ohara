// Doc_Ohara: Lightweight disk-persisted job queue (BullMQ-shaped API, no Redis dependency).
// Per project decision: no external broker; jobs persist to doc_pipeline/collections/job_queue.json
// so `ohara status` and the Agent Dashboard can inspect queue/worker state across processes.
import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';

const QUEUE_FILE = 'doc_pipeline/collections/job_queue.json';

function loadJobs() {
	try {
		if (fs.existsSync(QUEUE_FILE)) {
			return JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf-8'));
		}
	} catch (e) {
		console.error('[Queue] Failed to read job_queue.json, resetting.', e);
	}
	return [];
}

function saveJobs(jobs) {
	const dir = path.dirname(QUEUE_FILE);
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(QUEUE_FILE, JSON.stringify(jobs, null, 2), 'utf-8');
}

export class JobQueue extends EventEmitter {
	constructor(name) {
		super();
		this.name = name;
	}

	add(type, data, options = {}) {
		const jobs = loadJobs();
		const job = {
			id: `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
			queue: this.name,
			type,
			data,
			status: 'waiting',
			progress: 0,
			progressMessage: '',
			attempts: 0,
			maxAttempts: options.maxAttempts || 3,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
			result: null,
			error: null
		};
		jobs.push(job);
		saveJobs(jobs);
		this.emit('added', job);
		return job;
	}

	getJob(id) {
		return loadJobs().find(j => j.id === id) || null;
	}

	list({ status } = {}) {
		const jobs = loadJobs();
		return status ? jobs.filter(j => j.status === status) : jobs;
	}

	update(id, patch) {
		const jobs = loadJobs();
		const idx = jobs.findIndex(j => j.id === id);
		if (idx === -1) return null;
		jobs[idx] = { ...jobs[idx], ...patch, updatedAt: new Date().toISOString() };
		saveJobs(jobs);
		this.emit('updated', jobs[idx]);
		return jobs[idx];
	}

	// Atomically claim the next waiting job
	claimNext() {
		const jobs = loadJobs();
		const idx = jobs.findIndex(j => j.status === 'waiting');
		if (idx === -1) return null;
		jobs[idx].status = 'active';
		jobs[idx].updatedAt = new Date().toISOString();
		saveJobs(jobs);
		return jobs[idx];
	}

	remove(id) {
		const jobs = loadJobs();
		const idx = jobs.findIndex(j => j.id === id);
		if (idx === -1) return false;
		jobs.splice(idx, 1);
		saveJobs(jobs);
		return true;
	}

	stats() {
		const jobs = loadJobs();
		return {
			waiting: jobs.filter(j => j.status === 'waiting').length,
			active: jobs.filter(j => j.status === 'active').length,
			completed: jobs.filter(j => j.status === 'completed').length,
			failed: jobs.filter(j => j.status === 'failed').length,
			total: jobs.length
		};
	}
}

let ingestionQueueInstance = null;
export function getIngestionQueue() {
	if (!ingestionQueueInstance) {
		ingestionQueueInstance = new JobQueue('ingestion');
	}
	return ingestionQueueInstance;
}
