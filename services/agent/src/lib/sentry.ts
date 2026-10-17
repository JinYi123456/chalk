import { createRequire } from 'node:module';
import { config } from '../config.js';

type SentryModule = typeof import('@sentry/node');

const require = createRequire(import.meta.url);

let sentry: SentryModule | null = null;
let attempted = false;

/**
 * Synchronous on purpose: Sentry registers runtime-instrumentation hooks inside
 * init(), and any module loaded before that (notably @mastra/core and the ai
 * package) can never be instrumented afterwards. instrument.ts calls this
 * before anything else in the process. Without a DSN it is a pure no-op.
 */
export function initSentry(): SentryModule | null {
  if (attempted) return sentry;
  attempted = true;
  if (!config.sentryDsn) return null;
  try {
    // The CommonJS build, so init stays synchronous.
    const mod = require('@sentry/node') as SentryModule;
    // The Mastra integration ships with the SDK only on some versions — attach
    // it when it exists and trace the agent with plain spans when it does not.
    const maybe = mod as unknown as { mastraIntegration?: () => unknown };
    const integrations =
      typeof maybe.mastraIntegration === 'function' ? [maybe.mastraIntegration() as never] : undefined;
    mod.init({
      dsn: config.sentryDsn,
      tracesSampleRate: 1.0,
      environment: process.env.NODE_ENV || 'development',
      release: 'chalk-agent@0.1.0',
      debug: process.env.CHALK_SENTRY_DEBUG === '1',
      ...(integrations ? { integrations } : {}),
    });
    sentry = mod;
  } catch (err) {
    console.warn('chalk: sentry init failed, continuing without tracing —', String(err));
    sentry = null;
  }
  return sentry;
}

export function sentryEnabled(): boolean {
  return Boolean(config.sentryDsn);
}

export async function withSpan<T>(
  name: string,
  op: string,
  fn: () => Promise<T>,
  attributes: Record<string, string | number> = {}
): Promise<T> {
  const s = initSentry();
  if (!s) return fn();
  return s.startSpan({ name, op, attributes }, async () => {
    try {
      return await fn();
    } catch (err) {
      s.captureException(err);
      throw err;
    }
  });
}

export function captureException(err: unknown, context?: Record<string, unknown>): void {
  const s = initSentry();
  if (!s) return;
  s.captureException(err, context ? { extra: context } : undefined);
}
