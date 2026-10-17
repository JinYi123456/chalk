import './instrument.js';
import { serve } from '@hono/node-server';
import { engineLabel } from './config.js';
import { app, loadHistory } from './app.js';
import { config } from './config.js';
import { warmTabpfnCloud, tabpfnCloudEnabled } from './lib/tabpfn-cloud.js';

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`chalk agent listening on :${info.port} — ${engineLabel()}`);

  // The first quote otherwise pays for uploading and fitting the pro's history.
  // Warm it in the background so a demo starts fast without faking anything.
  if (tabpfnCloudEnabled()) {
    void loadHistory()
      .then((history: Awaited<ReturnType<typeof loadHistory>>) => warmTabpfnCloud(history))
      .then(() => console.log('tabpfn: history fitted in-context, first quote is warm'))
      .catch(() => console.log('tabpfn: warm-up skipped'));
  }
});
