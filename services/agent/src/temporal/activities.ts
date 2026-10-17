import { config } from '../config.js';

export type NotifyArgs = { quoteId: string; event: string; detail?: string };

/**
 * Post a follow-up event back to the agent so the job's timeline updates even
 * if the workflow ran on another machine. With no PUBLIC_BASE_URL it logs.
 */
export async function notifyAgent(args: NotifyArgs): Promise<void> {
  const url = `${config.publicBaseUrl}/api/_followup/event`;
  console.log(`[followup] ${args.quoteId} → ${args.event}${args.detail ? ` (${args.detail})` : ''}`);
  if (!config.publicBaseUrl) return;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    /* the agent will reconcile from the workflow status if this misses */
  }
}
