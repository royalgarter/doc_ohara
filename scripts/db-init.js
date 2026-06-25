import dotenv from 'dotenv';
import * as client from '../src/db/client.js';

dotenv.config();
(async ()=>{
	try{
		const db = await client.initArangoClient();
		console.log('initArangoClient succeeded');
		const colls = await db.listCollections();
		console.log('collections now:', colls.map(c=>c.name));
		await client.createSearchViewIfNotExists();
		console.log('ArangoSearch view ready');

		// Persistent index on published_date for temporal range queries / sort
		try {
			const docsCol = db.collection('documents');
			await docsCol.ensureIndex({ type: 'persistent', fields: ['published_date'], sparse: true, name: 'idx_published_date' });
			console.log('Index on documents.published_date ready');
		} catch (e) {
			console.warn('Could not create published_date index:', e.message);
		}

		// Vector index on paragraphs.embedding for ANN cosine similarity (ArangoDB 3.12+)
		try {
			const parasCol = db.collection('paragraphs');
			await parasCol.ensureIndex({
				type: 'vector',
				fields: ['embedding'],
				inBackground: true,
				name: 'idx_para_embedding',
				params: { metric: 'cosine', dimension: 768, nLists: 4 },
			});
			console.log('Vector index on paragraphs.embedding ready');
		} catch (e) {
			console.warn('Could not create vector index (requires ArangoDB 3.12 Enterprise):', e.message);
		}
	} catch (e) {
		console.error('init failed:', e.message);
		process.exit(1);
	}
})();
