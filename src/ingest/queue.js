// Doc_Ohara: ArangoDB-backed job queue (BullMQ-shaped API).
// Migrated from file-based (job_queue.json) to ArangoDB 'jobs' collection.
import { EventEmitter } from 'node:events';
import { initArangoClient } from '../db/client.js';

async function getDB() {
	return initArangoClient();
}

export class JobQueue extends EventEmitter {
	constructor(name) {
		super();
		this.name = name;
	}

	async add(type, data, options = {}) {
		const db = await getDB();
		const job = {
			_key: `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
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
			error: null,
		};
		const res = await db.collection('jobs').save(job);
		job.id = res._key;
		this.emit('added', job);
		return job;
	}

	async getJob(id) {
		const db = await getDB();
		try {
			const doc = await db.collection('jobs').document(id);
			return { ...doc, id: doc._key };
		} catch {
			return null;
		}
	}

	async list({ status } = {}) {
		const db = await getDB();
		const cursor = status
			? await db.query(
				`FOR j IN jobs FILTER j.queue == @q AND j.status == @s SORT j.createdAt ASC RETURN j`,
				{ q: this.name, s: status }
			)
			: await db.query(
				`FOR j IN jobs FILTER j.queue == @q SORT j.createdAt ASC RETURN j`,
				{ q: this.name }
			);
		const docs = await cursor.all();
		return docs.map(d => ({ ...d, id: d._key }));
	}

	async update(id, patch) {
		const db = await getDB();
		patch.updatedAt = new Date().toISOString();
		try {
			await db.collection('jobs').update(id, patch);
			const doc = await db.collection('jobs').document(id);
			const job = { ...doc, id: doc._key };
			this.emit('updated', job);
			return job;
		} catch {
			return null;
		}
	}

	// Atomically claim next waiting job via AQL to avoid race conditions.
	async claimNext() {
		const db = await getDB();
		const cursor = await db.query(`
			FOR j IN jobs
				FILTER j.queue == @q AND j.status == 'waiting'
				SORT j.createdAt ASC
				LIMIT 1
				UPDATE j WITH { status: 'active', updatedAt: DATE_ISO8601(DATE_NOW()) } IN jobs
				RETURN NEW
		`, { q: this.name });
		const doc = await cursor.next();
		return doc ? { ...doc, id: doc._key } : null;
	}

	async remove(id) {
		const db = await getDB();
		try {
			await db.collection('jobs').remove(id);
			return true;
		} catch {
			return false;
		}
	}

	async stats() {
		const db = await getDB();
		const cursor = await db.query(`
			FOR j IN jobs FILTER j.queue == @q
			COLLECT s = j.status WITH COUNT INTO c
			RETURN { status: s, count: c }
		`, { q: this.name });
		const rows = await cursor.all();
		const out = { waiting: 0, active: 0, completed: 0, failed: 0, total: 0 };
		for (const { status, count } of rows) {
			if (status in out) out[status] = count;
			out.total += count;
		}
		return out;
	}
}

let ingestionQueueInstance = null;
export function getIngestionQueue() {
	if (!ingestionQueueInstance) {
		ingestionQueueInstance = new JobQueue('ingestion');
	}
	return ingestionQueueInstance;
}
