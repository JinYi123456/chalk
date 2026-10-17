import {
  condition,
  defineQuery,
  defineSignal,
  proxyActivities,
  setHandler,
  sleep,
} from '@temporalio/workflow';
import type * as activities from './activities.js';

export type FollowUpArgs = {
  quoteId: string;
  total: number;
  client: string;
  headline: string;
  nudgeAfterDays?: number;
  validDays?: number;
};

export const accepted = defineSignal<[{ price?: number }]>('accepted');
export const declined = defineSignal('declined');

export const nudgesQuery = defineQuery<number>('nudges');
export const expiredQuery = defineQuery<boolean>('expired');

const { notifyAgent } = proxyActivities<typeof activities>({
  startToCloseTimeout: '30 seconds',
  retry: { maximumAttempts: 5, initialInterval: '5s', backoffCoefficient: 2 },
});

const DAY = 24 * 60 * 60 * 1000;

/**
 * A quote is a promise with a deadline. This workflow holds that promise on a
 * durable timer: if the client hasn't answered in a few days the pro is nudged,
 * and the quote expires on schedule — surviving restarts and deploys.
 */
export async function quoteFollowUp(args: FollowUpArgs): Promise<'accepted' | 'declined' | 'expired'> {
  const nudgeAfterDays = args.nudgeAfterDays ?? 3;
  const validDays = args.validDays ?? 14;

  let acceptedNow = false;
  let declinedNow = false;
  let nudges = 0;
  let expired = false;

  setHandler(accepted, () => {
    acceptedNow = true;
  });
  setHandler(declined, () => {
    declinedNow = true;
  });
  setHandler(nudgesQuery, () => nudges);
  setHandler(expiredQuery, () => expired);

  // Hold for the nudge window, or wake early on a reply.
  await condition(() => acceptedNow || declinedNow, nudgeAfterDays * DAY);
  if (acceptedNow) {
    await notifyAgent({ quoteId: args.quoteId, event: 'accepted', detail: `won at $${args.total}` });
    return 'accepted';
  }
  if (declinedNow) {
    await notifyAgent({ quoteId: args.quoteId, event: 'declined' });
    return 'declined';
  }

  nudges += 1;
  await notifyAgent({
    quoteId: args.quoteId,
    event: 'nudge',
    detail: `${args.nudgeAfterDays ?? nudgeAfterDays} days since the quote for ${args.client || 'the client'} — worth a follow-up on "${args.headline}"`,
  });

  // Hold until the quote expires, or wake early on a reply.
  await condition(() => acceptedNow || declinedNow, Math.max(validDays - nudgeAfterDays, 1) * DAY);
  if (acceptedNow) {
    await notifyAgent({ quoteId: args.quoteId, event: 'accepted', detail: `won at $${args.total}` });
    return 'accepted';
  }
  if (declinedNow) {
    await notifyAgent({ quoteId: args.quoteId, event: 'declined' });
    return 'declined';
  }

  expired = true;
  await notifyAgent({ quoteId: args.quoteId, event: 'expired', detail: `quote lapsed after ${validDays} days` });
  return 'expired';
}
