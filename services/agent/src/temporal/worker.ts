import { NativeConnection, Worker } from '@temporalio/worker';
import { config } from '../config.js';
import * as activities from './activities.js';

async function run() {
  if (!config.temporalAddress) {
    console.error('chalk: TEMPORAL_ADDRESS is not set — nothing to do.');
    process.exit(1);
  }
  const connection = await NativeConnection.connect({ address: config.temporalAddress });
  const worker = await Worker.create({
    connection,
    namespace: config.temporalNamespace,
    taskQueue: config.temporalTaskQueue,
    workflowsPath: new URL('./workflows.js', import.meta.url).pathname,
    activities,
  });
  console.log(`chalk follow-up worker polling "${config.temporalTaskQueue}" at ${config.temporalAddress}`);
  await worker.run();
}

run().catch((err) => {
  console.error('chalk follow-up worker failed:', err);
  process.exit(1);
});
