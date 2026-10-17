import { Client, Connection } from '@temporalio/client';
import { config } from '../config.js';
import { quoteFollowUp, type FollowUpArgs } from '../temporal/workflows.js';

export function temporalEnabled(): boolean {
  return Boolean(config.temporalAddress);
}

let client: Client | null = null;
let failed = false;

async function getClient(): Promise<Client | null> {
  if (!temporalEnabled() || failed) return null;
  if (client) return client;
  try {
    const connection = await Connection.connect({ address: config.temporalAddress });
    client = new Client({ connection, namespace: config.temporalNamespace });
    return client;
  } catch {
    failed = true;
    return null;
  }
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
