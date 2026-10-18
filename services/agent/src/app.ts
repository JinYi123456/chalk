import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { config, engineLabel, llmEndpoint, llmEndpoints } from './config.js';
import { loadReport } from './lib/benchmark.js';
import { JOB_TYPE_LABELS, seedHistory } from './lib/history.js';
import { buildLines } from './lib/lines.js';
import { chatOnceDebug, resolvedTextModel } from './lib/llm.js';
import { marketRate, serpApiEnabled } from './lib/market.js';
import { feedbackStats, forgetQuote, memoryKind, memoryStatus, quoteById, recentQuotes, recordFeedback, rememberQuote, similarQuotes } from './lib/memory.js';
import { features, priceJob, underchargeWarning } from './lib/pricing.js';
import { writeQuote } from './lib/quote-agent.js';
import { extractScope } from './lib/scope.js';
import { captureException, sentryEnabled, withSpan } from './lib/sentry.js';
import { tabpfnCloudEnabled } from './lib/tabpfn-cloud.js';
import { cancelQuoteFollowUp, followUpStatus, signalQuoteAccepted, startQuoteFollowUp, temporalStatus } from './lib/temporal.js';
import { marginSeries, recordJobEvent, tigerEnabled, tigerStatus } from './lib/tiger.js';
import { voiceFromTinker, tinkerEnabled } from './lib/tinker.js';
import { audioFile, readAloudDataUrl, ttsEnabled } from './lib/tts.js';
import type { PastJob, Quote } from './lib/types.js';
import { hashStr, stableStringify } from './lib/util.js';
import { readSite } from './lib/vision.js';
import { clientQuoteView } from './lib/visibility.js';

export const app = new Hono();

app.use('*', async (c, next) => {
  const t0 = performance.now();
  await next();
  c.header('x-chalk-ms', String(Math.round(performance.now() - t0)));
});

app.onError((err, c) => {
  captureException(err, { path: c.req.path });
  return c.json({ error: 'chalk snapped', detail: String(err) }, 500);
});

/* ── the pro's history: seeded persona + everything they have actually won ── */

function deriveFromQuote(q: Quote): PastJob | null {
  if (q.outcome !== 'won' && q.outcome !== 'lost') return null;
  const f = features(q.scope);
  return {
    dateKey: new Date(q.createdAt).toISOString().slice(0, 10),
    jobType: q.scope.jobType,
    totalHours: f.totalHours,
    tasks: f.tasks,
    rooms: f.rooms,
    complexityAvg: f.complexityAvg,
    complexityMax: f.complexityMax,
    materialsCost: f.materialsCost,
    accessDifficulty: f.accessDifficulty,
    riskCount: f.riskCount,
    price: q.total,
    won: q.outcome === 'won',
    daysToAccept: q.outcome === 'won' ? 1 : null,
  };
}

export async function loadHistory(): Promise<PastJob[]> {
  const base = seedHistory();
  const stored = await recentQuotes(120);
  const derived = stored.map(deriveFromQuote).filter((x): x is PastJob => x !== null);
  return [...base, ...derived];
}

/* ── health ─────────────────────────────────────────────────────────── */

app.get('/api/health', async (c) => {
  const [tabpfnOk, mem, tiger, temporal] = await Promise.all([
    fetch(`${config.tabpfnUrl}/health`, { signal: AbortSignal.timeout(2500) })
      .then((r) => r.ok)
      .catch(() => false),
    memoryStatus(),
    tigerStatus(),
    temporalStatus(),
  ]);
  return c.json({
    ok: true,
    provider: config.provider,
    model: resolvedTextModel() || config.model,
    visionModel: llmEndpoints().find((p) => p.vision)?.visionModel ?? config.visionModel,
    tabpfn: tabpfnOk,
    tabpfnCloud: tabpfnCloudEnabled(),
    tabpfnUrl: config.tabpfnUrl,
    storage: mem.kind === 'mongodb' ? 'mongodb-atlas' : 'memory',
    storedQuotes: mem.count,
    tts: ttsEnabled(),
    serpapi: serpApiEnabled(),
    sentry: sentryEnabled(),
    temporal: temporal.enabled,
    temporalConnected: temporal.connected,
    tinker: tinkerEnabled(),
    tiger: tiger.enabled,
    tigerConnected: tiger.connected,
    engine: engineLabel(resolvedTextModel()),
    time: new Date().toISOString(),
  });
});

/* ── the scoreboard: closed vs open weights, measured on this repo ───── */

app.get('/api/benchmark', async (c) => c.json(await loadReport()));

/* ── would anyone pay for this? ───────────────────────────────────────
   A public write endpoint, so every field is treated as hostile input:
   bounded length, an enumerated verdict, a coerced number. */

app.post('/api/feedback', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const verdict = ['yes', 'no', 'maybe'].includes(String(body.wouldPay)) ? (String(body.wouldPay) as 'yes' | 'no' | 'maybe') : null;
  if (!verdict) return c.json({ error: 'wouldPay must be yes, no or maybe' }, 400);
  const rawPrice = Number(body.price);
  const doc = {
    id: crypto.randomUUID(),
    at: Date.now(),
    trade: str(body.trade, 60),
    country: str(body.country, 60),
    wouldPay: verdict,
    price: Number.isFinite(rawPrice) && rawPrice > 0 && rawPrice < 10000 ? Math.round(rawPrice) : null,
    note: str(body.note, 900),
    quoteId: typeof body.quoteId === 'string' ? body.quoteId.slice(0, 64) : null,
  };
  await recordFeedback(doc);
  return c.json({ ok: true, id: doc.id });
});

app.get('/api/feedback', async (c) => c.json(await feedbackStats()));

/* ── the quote ──────────────────────────────────────────────────────── */

type QuoteBody = {
  photos?: string[];
  notes?: string;
  jobType?: string;
  client?: string;
  location?: string;
};

// Quote results are cached by input so a repeat demo is instant.
const quoteCache = new Map<string, Quote>();

app.post('/api/quote', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as QuoteBody;
  // The phone downscales before upload, so anything huge here is a client that
  // ignored that — dropped rather than stored (and echoed back to the client).
  const photos = (body.photos ?? [])
    .filter((p) => typeof p === 'string' && p.startsWith('data:image') && p.length < 1_600_000)
    .slice(0, 4);
  const notes = (body.notes ?? '').toString().slice(0, 4000);
  const client = (body.client ?? '').toString().slice(0, 80);
  const location = (body.location ?? '').toString().slice(0, 80);
  const jobTypeHint = (body.jobType ?? '').toString().slice(0, 60);

  if (photos.length === 0 && notes.trim().length < 3) {
    return c.json({ error: 'need at least one photo or a few words about the job' }, 400);
  }

  const cacheKey = stableStringify({
    notes,
    jobTypeHint,
    client,
    location,
    photos: photos.map((p) => hashStr(p.slice(0, 4000))),
  });

  const p = llmEndpoint();
  const quote = await withSpan(
    'quote.compile',
    'agent',
    async (): Promise<Quote> => {
      const cached = quoteCache.get(cacheKey);
      if (cached) return { ...cached, id: crypto.randomUUID(), createdAt: Date.now() };

      const t0 = Date.now();
      const [site, history] = await Promise.all([readSite(photos, jobTypeHint, notes), loadHistory()]);
      const tVision = Date.now();
      const scope = await extractScope({ site, notes, jobTypeHint, client, photoCount: photos.length });
      const tScope = Date.now();

      // The price, the live market check and this pro's own memory are
      // independent of each other, so they run together.
      const [pricing, market, memory] = await Promise.all([
        priceJob(scope, history),
        marketRate(scope.jobType, location, scope.totalHours),
        similarQuotes(`${scope.headline} ${scope.seen} ${scope.tasks.map((t) => t.label).join(' ')}`, 4),
      ]);
      const materialsCost = scope.materials.reduce((s, m) => s + m.cost, 0);
      const lines = buildLines(scope, pricing.price, materialsCost);
      const tPricing = Date.now();

      // One truth for the validity window: the writer is told it, the quote
      // stores it, and the follow-up workflow expires on it.
      const validDays = 14;
      const { prose, engine } = await writeQuote({
        scope,
        pricing,
        lines,
        client,
        location,
        market,
        memory: memory.map((m) => ({ headline: m.headline, total: m.total })),
        validDays,
      });

      const tinkerVoice = await voiceFromTinker({
        client,
        headline: scope.headline,
        jobType: JOB_TYPE_LABELS[scope.jobType] ?? scope.jobType,
        totalHours: scope.totalHours,
        lines: lines.map((l) => ({ label: l.label, total: l.total })),
        total: pricing.price,
      });

      const id = crypto.randomUUID();
      const plan = await startQuoteFollowUp({ quoteId: id, total: pricing.price, client, headline: scope.headline, validDays });

      const quote: Quote = {
        id,
        createdAt: Date.now(),
        jobType: scope.jobType,
        client,
        headline: scope.headline,
        scope,
        lines,
        subtotal: lines.reduce((s, l) => s + l.total, 0),
        total: pricing.price,
        range: { low: pricing.low, high: pricing.high },
        winProbability: pricing.winProbability,
        band: pricing.band,
        bandSource: pricing.bandSource,
        usualPrice: pricing.usualPrice,
        underchargeWarning: underchargeWarning(pricing.price, pricing.usualPrice, scope),
        marketBenchmark: market,
        priceRationale: prose.rationale,
        clientMessage: tinkerVoice ?? prose.clientMessage,
        assumptions: prose.assumptions,
        validDays,
        timings: {
          vision: tVision - t0,
          scope: tScope - tVision,
          pricing: tPricing - tScope,
          words: Date.now() - tPricing,
          total: Date.now() - t0,
        },
        engine: {
          scope: `${scope.basis.join(' · ')}${site ? '' : photos.length ? ' (photos unreadable — words only)' : ' (words only — no photos)'}`,
          pricing: `${pricing.served} · ${pricing.basis}`,
          writing: engine,
          voice: tinkerVoice ? 'tinker lora' : undefined,
        },
        followUp: {
          scheduled: Boolean(plan),
          workflowId: plan?.workflowId,
          reason: plan ? undefined : 'temporal not configured',
          nudges: [`Follow up in 3 days if ${client || 'the client'} hasn't replied`, `Quote lapses after ${validDays} days`],
        },
        audioUrl: null,
        currency: 'USD',
        outcome: null,
        // The evidence: the same photos the scope was read from, plus the
        // vision model's one-line caption for each, in order.
        photos: photos.length ? photos : undefined,
        photoCaptions: site?.captions.length ? site.captions : undefined,
      };

      quoteCache.set(cacheKey, quote);
      if (quoteCache.size > 40) quoteCache.delete(quoteCache.keys().next().value as string);

      await rememberQuote(quote).catch(() => {});
      void recordJobEvent({
        id: quote.id,
        ts: quote.createdAt,
        jobType: quote.jobType,
        price: quote.total,
        winProbability: quote.winProbability,
        outcome: 'quoted',
      });
      return quote;
    },
    {
      'gen_ai.system': p.name,
      'gen_ai.request.model': p.model,
      'chalk.photos': photos.length,
      'chalk.notes_chars': notes.length,
    }
  );

  return c.json(quote);
});

/* ── the pro's quotes (memory) ──────────────────────────────────────── */

app.get('/api/jobs', async (c) => {
  const limit = Math.min(Number(c.req.query('limit') || 20), 60);
  const quotes = await recentQuotes(limit);
  return c.json({ kind: await memoryKind(), jobs: quotes });
});

app.get('/api/jobs/:id', async (c) => {
  const q = await quoteById(c.req.param('id'));
  if (!q) return c.json({ error: 'no such quote' }, 404);
  const followUp = await followUpStatus(q.id);
  return c.json({ ...q, followUpLive: followUp });
});

/**
 * The client's face of the same record, enforced on the server — see
 * lib/visibility.ts. A stranger holding the link gets the work, the price and
 * the assumptions; the odds, the usual price and the hours never leave here.
 */
app.get('/api/jobs/:id/client', async (c) => {
  const q = await quoteById(c.req.param('id'));
  if (!q) return c.json({ error: 'no such quote' }, 404);
  return c.json(clientQuoteView(q as unknown as Record<string, any>));
});

app.post('/api/jobs/:id/outcome', async (c) => {
  const id = c.req.param('id');
  const body = (await c.req.json().catch(() => ({}))) as { outcome?: 'won' | 'lost'; price?: number };
  const q = await quoteById(id);
  if (!q) return c.json({ error: 'no such quote' }, 404);
  const outcome = body.outcome === 'won' ? 'won' : 'lost';
  await rememberQuote({ ...q, outcome }).catch(() => {});
  void recordJobEvent({
    id,
    ts: Date.now(),
    jobType: q.jobType,
    price: typeof body.price === 'number' ? body.price : q.total,
    winProbability: q.winProbability,
    outcome,
  });
  const signalled = outcome === 'won' ? await signalQuoteAccepted(id, body.price) : false;
  return c.json({ ok: true, id, outcome, signalled });
});

/* ── forgetting a job ─────────────────────────────────────────────────
   A quote carries photographs of somebody's home, so deletion has to exist.
   There is still no auth on this build — one pro, one device — which means the
   capability is bounded by whoever can reach the URL. That is stated as a limit
   in the README rather than papered over: accounts come before this is anyone's
   production system. */

app.delete('/api/jobs/:id', async (c) => {
  const id = c.req.param('id');
  const q = await quoteById(id);
  if (!q) return c.json({ error: 'no such quote' }, 404);
  const gone = await forgetQuote(id).catch(() => false);
  // A follow-up timer for a job that no longer exists must not keep nudging.
  await cancelQuoteFollowUp(id).catch(() => undefined);
  return c.json({ ok: gone, id, removedPhotos: q.photos?.length ?? 0 });
});

/* ── the pricing profile ────────────────────────────────────────────── */

app.get('/api/profile', async (c) => {
  const history = await loadHistory();
  const won = history.filter((h) => h.won);
  const byType = new Map<string, { n: number; won: number; avg: number; sum: number }>();
  for (const h of history) {
    const row = byType.get(h.jobType) ?? { n: 0, won: 0, avg: 0, sum: 0 };
    row.n += 1;
    row.won += h.won ? 1 : 0;
    row.sum += h.price;
    row.avg = Math.round(row.sum / row.n);
    byType.set(h.jobType, row);
  }
  const avgTicket = won.length ? Math.round(won.reduce((s, h) => s + h.price, 0) / won.length) : 0;
  return c.json({
    jobs: history.length,
    won: won.length,
    winRate: history.length ? Math.round((won.length / history.length) * 100) / 100 : 0,
    avgTicket,
    hourly: won.length ? Math.round(avgTicket / (won.reduce((s, h) => s + h.totalHours, 0) / won.length)) : 0,
    byType: Object.fromEntries(
      [...byType.entries()].map(([k, v]) => [
        k,
        { label: JOB_TYPE_LABELS[k] ?? k, jobs: v.n, winRate: Math.round((v.won / v.n) * 100) / 100, avg: v.avg },
      ])
    ),
  });
});

/* ── market benchmark on its own ────────────────────────────────────── */

app.get('/api/market', async (c) => {
  const jobType = c.req.query('jobType') || 'deep_clean';
  const location = c.req.query('location') || '';
  const hours = Number(c.req.query('hours') || 4);
  const m = await marketRate(jobType, location, hours);
  return c.json({ enabled: serpApiEnabled(), benchmark: m });
});

/* ── the margin log (Tiger Data) ────────────────────────────────────── */

app.get('/api/margin', async (c) => {
  const days = Math.min(Number(c.req.query('days') || 30), 180);
  const status = await tigerStatus();
  if (!status.enabled) return c.json({ enabled: false, series: [], total: 0 });
  const series = await marginSeries(days);
  return c.json({ enabled: true, connected: status.connected, total: status.total ?? 0, series: series ?? [] });
});

/* ── voice ──────────────────────────────────────────────────────────── */

app.post('/api/tts', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { text?: string };
  if (!body.text) return c.body(null, 204);
  const url = await readAloudDataUrl(body.text);
  if (!url) return c.body(null, 204);
  return c.json({ url });
});

app.get('/audio/:file', async (c) => {
  const bytes = await audioFile(c.req.param('file'));
  if (!bytes) return c.notFound();
  return c.body(new Uint8Array(bytes), 200, { 'content-type': 'audio/mpeg', 'cache-control': 'public, max-age=604800' });
});

/* ── follow-up events from the Temporal worker ──────────────────────── */

const followUpEvents = new Map<string, { event: string; detail?: string; at: string }[]>();

app.post('/api/_followup/event', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { quoteId?: string; event?: string; detail?: string };
  if (!body.quoteId || !body.event) return c.json({ error: 'need quoteId + event' }, 400);
  const list = followUpEvents.get(body.quoteId) ?? [];
  list.push({ event: body.event, detail: body.detail, at: new Date().toISOString() });
  followUpEvents.set(body.quoteId, list);
  console.log(`[followup] ${body.quoteId} → ${body.event}`);
  return c.json({ ok: true });
});

app.get('/api/_followup/events', (c) => {
  const id = c.req.query('quoteId') ?? '';
  return c.json({ events: followUpEvents.get(id) ?? [] });
});

/* ── diagnostics ────────────────────────────────────────────────────── */

app.get('/api/_diag/model', async (c) => {
  if (c.req.query('go') !== '1') return c.json({ hint: 'append ?go=1', provider: config.provider, model: config.model });
  const attempt = await chatOnceDebug([{ role: 'user', content: 'Reply with the single word: ready' }], {
    temperature: 0,
    maxTokens: 16,
  });
  return c.json({ ...attempt, visionModel: config.visionModel, tabpfn: config.tabpfnUrl, tabpfnCloud: tabpfnCloudEnabled() });
});

/* ── the built web app (single-process demo / self-host) ────────────── */

const webDist = resolve(dirname(fileURLToPath(import.meta.url)), '../../../apps/web/dist');
if (config.serveWeb && existsSync(webDist)) {
  app.use('*', serveStatic({ root: webDist }));
  // SPA fallback: the client's quote link (/q/<id>) is a route in the app, not
  // a file, so unknown paths get index.html and the router takes over.
  app.get('*', async (c, next) => {
    if (c.req.path.startsWith('/api/') || c.req.path.startsWith('/audio/')) return next();
    const html = await readFile(resolve(webDist, 'index.html'), 'utf8');
    return c.html(html);
  });
}
