import { initSentry } from './lib/sentry.js';

// Must run before any other module so @mastra/core and ai can be instrumented.
initSentry();
