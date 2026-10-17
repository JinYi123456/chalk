import { Mastra } from '@mastra/core';
import { Agent } from '@mastra/core/agent';
import { z } from 'zod';
import type { MastraLanguageModel } from '@mastra/core/agent';
import { buildMastraModel, chatText, providerReady, resolvedTextModel } from './llm.js';
import { JOB_TYPE_LABELS } from './history.js';
import { marketRate } from './market.js';
import { similarQuotes } from './memory.js';
import { sentryEnabled } from './sentry.js';
import { clamp, fixValidity, looseJson } from './util.js';
import type { JobScope, QuoteLine, PricingResult } from './types.js';

export const QuoteProse = z.object({
  clientMessage: z.string().default(''),
  rationale: z.string().default(''),
  assumptions: z.array(z.string()).default([]),
  tone: z.string().default(''),
});
export type QuoteProse = z.infer<typeof QuoteProse>;

const INSTRUCTIONS = `You are Chalk's quote writer. You write the words a solo home-service pro sends to a client, and the private note the pro reads before they send it.

Voice for the client message: warm, plain, confident, first person plural or "I". No corporate filler, no "please don't hesitate", no emojis. Short paragraphs. Say what you will do, what it costs, what you assumed, and when it's valid.

The rationale is for the pro only: one tight paragraph explaining why the number is fair — the hours, the complexity, the access, and how it compares to their own history. Be specific and numeric.

The assumptions are the things you could not see and had to decide — always list them, because a hidden assumption is a lost job. If there are none, say so honestly with an empty list.

You have tools: market_rate (live local prices), similar_jobs (this pro's closest past quotes). Use them when they would sharpen the number or the wording.

Answer with ONLY minified JSON:
{"clientMessage":"","rationale":"","assumptions":[""],"tone":""}`;

export const quoterTools = {
  market_rate: {
    description: 'Live local market prices for a job type.',
    parameters: z.object({ jobType: z.string(), location: z.string().default(''), hours: z.number() }),
    execute: async ({ jobType, location, hours }: { jobType: string; location: string; hours: number }) => {
      const m = await marketRate(jobType, location, hours);
      return m ?? { note: 'no live market data available' };
    },
  },
  similar_jobs: {
    description: "This pro's closest past quotes for comparable work.",
    parameters: z.object({ query: z.string(), limit: z.number().default(4) }),
    execute: async ({ query, limit }: { query: string; limit: number }) => {
      const rows = await similarQuotes(query, limit);
      return rows.map((q) => ({ headline: q.headline, total: q.total, won: q.winProbability >= 0.5 }));
    },
  },
};

export const quoterAgent = new Agent({
  name: 'chalk-quoter',
  instructions: INSTRUCTIONS,
  model: (() => buildMastraModel()) as unknown as MastraLanguageModel,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tools: quoterTools as any,
});

/** Mastra only attaches Sentry's span exporter when a Mastra instance exists. */
export const chalkMastra = sentryEnabled() ? new Mastra({ agents: { quoter: quoterAgent } }) : null;

export type QuoteContext = {
  scope: JobScope;
  pricing: PricingResult;
  lines: QuoteLine[];
  client: string;
  location: string;
  market: { low: number; high: number; note: string } | null;
  memory: { headline: string; total: number }[];
  validDays: number;
};

function context(ctx: QuoteContext): string {
  return JSON.stringify(
    {
      client: ctx.client,
      location: ctx.location,
      jobType: JOB_TYPE_LABELS[ctx.scope.jobType] ?? ctx.scope.jobType,
      headline: ctx.scope.headline,
      whatTheCameraSaw: ctx.scope.seen,
      tasks: ctx.scope.tasks.map((t) => `${t.label} (${t.hours}h, complexity ${t.complexity}/5)`),
      access: ctx.scope.access,
      risks: ctx.scope.risks,
      totalHours: ctx.scope.totalHours,
      lineItems: ctx.lines.map((l) => `${l.label}: $${l.total}`),
      recommendedTotal: ctx.pricing.price,
      quoteValidDays: ctx.validDays,
      fairRange: { low: ctx.pricing.low, high: ctx.pricing.high },
      winProbability: ctx.pricing.winProbability,
      yourUsualPrice: ctx.pricing.usualPrice,
      marketBenchmark: ctx.market,
      closestPastJobs: ctx.memory,
    },
    null,
    0
  );
}

function fallbackProse(ctx: QuoteContext): QuoteProse {
  const t = ctx.lines.map((l) => `• ${l.label} — $${l.total}`).join('\n');
  const name = ctx.client || 'there';
  return {
    clientMessage:
      `Hi ${name}, thanks for showing me the job today.\n\n` +
      `Here's what it takes:\n${t}\n\n` +
      `Total: $${ctx.pricing.price}, valid for ${ctx.validDays} days.\n\n` +
      `I've assumed the site is as I saw it today. If anything changes, I'll re-quote the difference before I start.`,
    rationale: `$${ctx.pricing.price} covers ${ctx.scope.totalHours}h across ${ctx.scope.tasks.length} tasks, priced against your own history.`,
    assumptions: ctx.scope.risks.length ? [`Site is as described: ${ctx.scope.risks.join(', ')}`] : [],
    tone: 'plain',
  };
}

function normalize(prose: QuoteProse, validDays: number): QuoteProse {
  const message = fixValidity(prose.clientMessage.trim(), validDays);
  return {
    clientMessage: message.slice(0, 1600),
    rationale: prose.rationale.trim().slice(0, 700),
    assumptions: prose.assumptions.map((a) => a.trim()).filter(Boolean).slice(0, 6),
    tone: (prose.tone || '').trim().slice(0, 40),
  };
}

/** Write the client message, the private rationale and the assumptions. */
export async function writeQuote(ctx: QuoteContext): Promise<{ prose: QuoteProse; engine: string }> {
  if (!providerReady()) return { prose: fallbackProse(ctx), engine: 'hand-written template (offline-safe)' };
  const prompt = `WALKTHROUGH CONTEXT:\n${context(ctx)}\n\nWrite the quote now: the ${ctx.client ? 'client' : ''} message, the private rationale, and every assumption you had to make. The quote is valid for exactly ${ctx.validDays} days — say that and no other number. Output only the JSON.`;
  try {
    const res = (await quoterAgent.generate(prompt, { maxSteps: 3 })) as { text?: string };
    const parsed = QuoteProse.safeParse(looseJson(res.text ?? ''));
    if (parsed.success && parsed.data.clientMessage.trim().length > 20) {
      return { prose: normalize(parsed.data, ctx.validDays), engine: resolvedTextModel() };
    }
    const repaired = await chatText(
      [
        {
          role: 'user',
          content: `Convert this into ONLY the required JSON with keys clientMessage, rationale, assumptions, tone:\n${(res.text ?? '').slice(0, 1500)}`,
        },
      ],
      { temperature: 0.2, maxTokens: 700 }
    );
    const fixed = repaired ? QuoteProse.safeParse(looseJson(repaired)) : null;
    if (fixed?.success && fixed.data.clientMessage.trim().length > 20) {
      return { prose: normalize(fixed.data, ctx.validDays), engine: resolvedTextModel() };
    }
  } catch {
    /* the tool loop fell over — the text-only pass below still writes a quote */
  }

  const solo = await chatText(
    [
      { role: 'system', content: 'You output only minified JSON.' },
      {          role: 'user', content: `${INSTRUCTIONS}\n\nWALKTHROUGH CONTEXT:\n${context(ctx)}\n\nThe quote is valid for exactly ${ctx.validDays} days. Answer immediately, no tools. Output only the JSON.` },
    ],
    { temperature: 0.5, maxTokens: 900 }
  );
  const soloParsed = solo ? QuoteProse.safeParse(looseJson(solo)) : null;
  if (soloParsed?.success && soloParsed.data.clientMessage.trim().length > 20) {
    return { prose: normalize(soloParsed.data, ctx.validDays), engine: `${resolvedTextModel()} (text-only)` };
  }
  return { prose: fallbackProse(ctx), engine: 'hand-written template (model unavailable)' };
}

export { clamp };
