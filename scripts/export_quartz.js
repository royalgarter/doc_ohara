import { getArangoDBSimulator } from '../src/arangodb_sim.js';
import { QuartzExporter } from '../src/quartz_exporter.js';

async function main() {
  const dbSim = getArangoDBSimulator();
  const exporter = new QuartzExporter(dbSim, 'wiki');
  
  try {
    await exporter.export();
    console.log('✅ Quartz wiki export successful. You can now point Quartz to the ./wiki folder.');
  } catch (err) {
    console.error('❌ Quartz export failed:', err);
    process.exit(1);
  }
}

main();
