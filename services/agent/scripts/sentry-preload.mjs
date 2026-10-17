// Four-line, DSN-gated preload. Node reads the ESM module graph before any module
// body runs, so Sentry must init here to instrument @mastra/core and the ai SDK.
// With no DSN this file is inert and the SDK is never loaded.
const dsn = process.env.SENTRY_DSN;
if (dsn) {
  try {
    const mod = await import('@sentry/node');
    const integrations =
      typeof mod.mastraIntegration === 'function' ? [mod.mastraIntegration()] : undefined;
    mod.init({
      dsn,
      tracesSampleRate: 1.0,
      environment: process.env.NODE_ENV || 'development',
      release: 'chalk-agent@0.1.0',
      debug: process.env.CHALK_SENTRY_DEBUG === '1',
      ...(integrations ? { integrations } : {}),
    });
  } catch (err) {
    console.warn('chalk: sentry preload skipped —', String(err));
  }
}
