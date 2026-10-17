import { fileURLToPath } from 'node:url';
import { NativeConnection, Worker } from '@temporalio/worker';
import { config } from '../config.js';
import { authMetadata, tlsOptions } from '../lib/temporal.js';
import * as activities from './activities.js';

async function run() {
  if (!config.temporalAddress) {
    console.error('chalk: TEMPORAL_ADDRESS is not set — nothing to do.');
    process.exit(1);
  }
  const connection = await NativeConnection.connect({
    address: config.temporalAddress,
    tls: tlsOptions(),
    ...(authMetadata() ? { metadata: authMetadata() } : {}),
  });
  const worker = await Worker.create({
    connection,
    namespace: config.temporalNamespace,
    taskQueue: config.temporalTaskQueue,
    // .pathname hands back "/C:/…" on Windows and the bundle silently fails to
    // resolve, so decode the file URL instead.
    workflowsPath: fileURLToPath(new URL('./workflows.js', import.meta.url)),
    activities,
  });
  console.log(`chalk follow-up worker polling "${config.temporalTaskQueue}" at ${config.temporalAddress}`);
  await worker.run();
}

run().catch((err) => {
  console.error('chalk follow-up worker failed:', err);
  process.exit(1);
});
