import { Client, Connection } from '@temporalio/client';
import { existsSync, readFileSync } from 'node:fs';
import { config } from '../config.js';
import { quoteFollowUp, type FollowUpArgs } from '../temporal/workflows.js';

export function temporalEnabled(): boolean {
  return Boolean(config.temporalAddress);
}

function readCert(path: string): Buffer | undefined {
  return path && existsSync(path) ? readFileSync(path) : undefined;
}

/**
 * Cloud needs TLS plus either a Bearer API key or a client certificate. A bare
 * address is only ever a local dev server, so report which mode we are in
 * rather than connecting in a way that quietly never works. Shared with the
 * worker so the two cannot disagree about how they reach the same cluster.
 */
export function tlsOptions(): Record<string, unknown> | boolean {
  const crt = readCert(config.temporalClientCert);
  const key = readCert(config.temporalClientKey);
  const ca = readCert(config.temporalCaCert);
  // Temporal Cloud's certificate is publicly trusted, so a root CA is only
  // needed for a private deployment — an empty tls object still means TLS.
  const tls: Record<string, unknown> = {};
  if (ca) tls.serverRootCACertificate = new Uint8Array(ca);
  if (crt && key) tls.clientCertPair = { crt: new Uint8Array(crt), key: new Uint8Array(key) };
  return Object.keys(tls).length ? tls : true;
}

export function authMetadata(): Record<string, string> | undefined {
  return config.temporalApiKey ? { authorization: `Bearer ${config.temporalApiKey}` } : undefined;
}

function connectionOptions(): Parameters<typeof Connection.connect>[0] | null {
  if (!temporalEnabled()) return null;
  const metadata = authMetadata();
  return {
    address: config.temporalAddress,
    tls: tlsOptions(),
    ...(metadata ? { grpcMetadata: new Map(Object.entries(metadata)) } : {}),
  };
}

let client: Client | null = null;
let failed = false;
let connected = false;

async function getClient(): Promise<Client | null> {
  if (!temporalEnabled() || failed) return null;
  if (client) return client;
  try {
    const options = connectionOptions();
    if (!options) return null;
    const connection = await Connection.connect(options);
    client = new Client({ connection, namespace: config.temporalNamespace });
    connected = true;
    return client;
  } catch {
    failed = true;
    connected = false;
    return null;
  }
}

/** Did a real handshake happen? `enabled` only means an address was configured. */
export async function temporalStatus(): Promise<{ enabled: boolean; connected: boolean }> {
  if (!temporalEnabled()) return { enabled: false, connected: false };
  return { enabled: true, connected: (await getClient()) !== null };
}

export type FollowUpPlan = { workflowId: string; runId: string };

/**
 * Start a durable follow-up: nudge the pro if the client hasn't replied, then
 * expire the quote. This is exactly the shape Temporal exists for — a timer
 * that must survive a deploy or a crash, and resolve on a signal.
 */
export async function startQuoteFollowUp(args: FollowUpArgs): Promise<FollowUpPlan | null> {
  const c = await getClient();
  if (!c) return null;
  try {
    const handle = await c.workflow.start(quoteFollowUp, {
      taskQueue: config.temporalTaskQueue,
      workflowId: `chalk-quote-${args.quoteId}`,
      args: [args],
    });
    return { workflowId: handle.workflowId, runId: handle.firstExecutionRunId };
  } catch {
    return null;
  }
}

export async function signalQuoteAccepted(quoteId: string, price?: number): Promise<boolean> {
  const c = await getClient();
  if (!c) return false;
  try {
    const handle = c.workflow.getHandle(`chalk-quote-${quoteId}`);
    await handle.signal('accepted', { price });
    return true;
  } catch {
    return false;
  }
}

/**
 * Cancel a quote's follow-up. Deleting a job has to stop its timers as well as
 * its rows, or the pro keeps being nudged about a quote that no longer exists.
 */
export async function cancelQuoteFollowUp(quoteId: string): Promise<boolean> {
  const c = await getClient();
  if (!c) return false;
  try {
    await c.workflow.getHandle(`chalk-quote-${quoteId}`).cancel();
    return true;
  } catch {
    // No such workflow, or follow-ups were never scheduled for this quote.
    return false;
  }
}

export type FollowUpStatus = {
  enabled: boolean;
  workflowId: string;
  status?: string;
  nudges?: number;
  expired?: boolean;
};

export async function followUpStatus(quoteId: string): Promise<FollowUpStatus> {
  const workflowId = `chalk-quote-${quoteId}`;
  const c = await getClient();
  if (!c) return { enabled: false, workflowId };
  try {
    const handle = c.workflow.getHandle(workflowId);
    const desc = await handle.describe();
    let nudges: number | undefined;
    let expired: boolean | undefined;
    try {
      nudges = await handle.query<number>('nudges');
      expired = await handle.query<boolean>('expired');
    } catch {
      /* query handlers unavailable until the worker has polled */
    }
    return { enabled: true, workflowId, status: desc.status.name, nudges, expired };
  } catch {
    return { enabled: true, workflowId, status: 'not-found' };
  }
}
