import { config } from '../config.js';
import { JOB_TYPES } from './history.js';
import { usableBand } from './band.js';
import { tabpfnCloudPredict } from './tabpfn-cloud.js';
import type { JobScope, PastJob, PriceBand, PricingResult } from './types.js';
import { clamp, fetchWithTimeout, money } from './util.js';

export type PriceFeatures = {
  jobType: string;
  totalHours: number;
  tasks: number;
  rooms: number;
  complexityAvg: number;
  complexityMax: number;
  materialsCost: number;
  accessDifficulty: number;
  riskCount: number;
};

export function features(scope: JobScope): PriceFeatures {
  const c = scope.tasks.map((t) => t.complexity);
  return {
    jobType: scope.jobType,
    totalHours: scope.totalHours,
    tasks: scope.tasks.length,
    rooms: Math.max(scope.rooms.length, scope.tasks.reduce((s, t) => s + (t.unit === 'room' ? t.qty : 0), 0)) || 1,
    complexityAvg: c.length ? Math.round((c.reduce((a, b) => a + b, 0) / c.length) * 10) / 10 : 3,
    complexityMax: c.length ? Math.max(...c) : 3,
    materialsCost: scope.materials.reduce((s, m) => s + m.cost, 0),
    accessDifficulty: accessScore(scope.access),
    riskCount: scope.risks.length,
  };
}

/** 0 = easy on-street access, 3 = third-floor walk-up in the rain. */
export function accessScore(access: string[]): number {
  let score = 0;
  for (const a of access) {
    const s = a.toLowerCase();
    if (/walk.?up|no lift|stairs|flight|third|3rd|fourth|4th/.test(s)) score += 2;
    if (/no parking|permit|far|tight|narrow|locked|key|occupied|occupied home/.test(s)) score += 1;
  }
  return clamp(score, 0, 3);
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

/** What the pro normally charges for this kind of work. */
export function usualPrice(scope: JobScope, history: PastJob[]): number | null {
  const sameType = history.filter((j) => j.jobType === scope.jobType && j.won);
  const pool = sameType.length >= 3 ? sameType : history.filter((j) => j.won);
  if (pool.length === 0) return null;
  return median(pool.map((j) => j.price));
}

/**
 * The pro's own ledger, 10th–90th percentile for this kind of job. A mixed
 * history (a $70 gutter clear beside an $800 repaint) makes the model's
 * 80% interval honest about the rows and useless as a quote: "$53–$744" on a
 * $400 job reads like a guess. The ledger is the tighter, defensible bound.
 */
function ledgerBounds(features: PriceFeatures, history: PastJob[]): { p10: number; p90: number } | null {
  const peers = history.filter((j) => j.jobType === features.jobType).map((j) => j.price);
  const pool = (peers.length >= 5 ? peers : history.map((j) => j.price)).sort((a, b) => a - b);
  if (pool.length < 5) return null;
  const at = (q: number) => pool[Math.round(q * (pool.length - 1))];
  return { p10: at(0.1), p90: at(0.9) };
}

/** Keep the reported range inside what this pro has actually charged. */
export function saneRange(
  price: number,
  low: number,
  high: number,
  features: PriceFeatures,
  history: PastJob[]
): { low: number; high: number } {
  const b = ledgerBounds(features, history);
  const lo = Math.min(Math.max(low, price * 0.55, b ? Math.min(b.p10, price * 0.8) : 0), price * 0.95);
  const hi = Math.max(Math.min(high, price * 1.6, b ? Math.max(b.p90, price * 1.2) : Infinity), price * 1.05);
  return { low: money(lo), high: money(hi) };
}

// The ladder lives in band.ts (no imports of its own) so the TabPFN client can
// use the same definition without a cycle back through this module.
export { BAND_STEPS, bandFromProbs, bandPrices, usableBand } from './band.js';

/**
 * Fallback ladder: a straight line around one estimate. This is NOT the model's
 * answer for each price — it is a shape drawn through a single point, kept so
 * the card still says something useful when the classifier is unavailable.
 */
export function priceBand(base: number, winAtBase: number, slope = 0.07): PriceBand[] {
  const steps: { label: string; mult: number; dWin: number }[] = [
    { label: 'Win the job', mult: 0.85, dWin: 0.24 },
    { label: 'Fair', mult: 0.95, dWin: 0.11 },
    { label: 'Recommended', mult: 1.0, dWin: 0 },
    { label: 'Strong', mult: 1.1, dWin: -0.14 },
    { label: 'Max', mult: 1.22, dWin: -0.32 },
  ];
  return steps.map((s) => ({
    label: s.label,
    at: money(base * s.mult),
    win: Math.round(clamp(winAtBase + s.dWin * (slope / 0.07), 0.02, 0.98) * 100) / 100,
  }));
}

/** Distance-based heuristic over the pro's own history — the honest floor. */
export function heuristicPricing(features: PriceFeatures, history: PastJob[]): PricingResult {
  const sameType = history.filter((j) => j.jobType === features.jobType);
  const pool = (sameType.length >= 3 ? sameType : history).filter((j) => j.won);
  const rows = pool.length ? pool : history;
  const prior = JOB_TYPES.find((j) => j.slug === features.jobType);

  const scored = rows.map((j) => {
    const dh = Math.abs(j.totalHours - features.totalHours) / 6;
    const dc = Math.abs(j.complexityAvg - features.complexityAvg) / 3;
    const da = Math.abs(j.accessDifficulty - features.accessDifficulty) / 3;
    const dr = Math.abs(j.riskCount - features.riskCount) / 3;
    const dm = Math.abs(j.materialsCost - features.materialsCost) / 40;
    return { j, w: 1 / (0.15 + dh + dc + da + dr + dm) };
  });
  scored.sort((a, b) => b.w - a.w);
  const top = scored.slice(0, 8);
  const wsum = top.reduce((s, x) => s + x.w, 0) || 1;
  const blended = top.reduce((s, x) => s + x.j.price * x.w, 0) / wsum;
  const fallback = prior ? features.totalHours * prior.baseHourly + features.materialsCost + features.accessDifficulty * 14 : 180;
  const price = money(rows.length >= 3 ? blended : fallback);

  const winRate = rows.length ? rows.filter((j) => j.won).length / rows.length : 0.6;
  const winProbability = Math.round(clamp(winRate - (price > 1.08 * fallback ? 0.08 : 0) + 0.05, 0.2, 0.95) * 100) / 100;

  return {
    price,
    low: money(price * 0.88),
    high: money(price * 1.16),
    winProbability,
    served: 'heuristic',
    basis: `${rows.length} of your past jobs, distance-weighted on hours, complexity, access and materials`,
    band: priceBand(price, winProbability),
    bandSource: 'modelled' as const,
    usualPrice: usualPrice({ jobType: features.jobType } as JobScope, history),
    historyUsed: rows.length,
  };
}

type TabpfnResponse = Partial<PricingResult> & { served?: string; error?: string };

/**
 * Ask the TabPFN service to price this job in-context over the pro's history.
 * Returns null when the service is absent so the caller can fall back honestly.
 */
export async function tabpfnPricing(
  features: PriceFeatures,
  history: PastJob[]
): Promise<PricingResult | null> {
  try {
    const res = await fetchWithTimeout(
      `${config.tabpfnUrl.replace(/\/$/, '')}/predict`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: features, history: history.slice(-120) }),
      },
      20_000
    );
    if (!res.ok) return null;
    const data = (await res.json()) as TabpfnResponse;
    if (!data || typeof data.price !== 'number' || !Number.isFinite(data.price)) return null;
    const served = data.served === 'model' ? 'model' : data.served === 'precomputed' ? 'precomputed' : 'heuristic';
    return {
      price: money(data.price),
      low: money(data.low ?? data.price * 0.88),
      high: money(data.high ?? data.price * 1.16),
      winProbability: clamp(Number(data.winProbability ?? 0.6), 0.05, 0.98),
      served,
      basis: data.basis ?? 'TabPFN over your own job history',
      band: Array.isArray(data.band) && data.band.length ? data.band : priceBand(money(data.price), clamp(Number(data.winProbability ?? 0.6), 0.05, 0.98)),
      bandSource: 'modelled',
      usualPrice: data.usualPrice ?? null,
      historyUsed: Number(data.historyUsed ?? history.length),
    };
  } catch {
    return null;
  }
}

/**
 * Prior Labs predict latency swings from ~4s to over a minute. A pro standing
 * in a hallway cannot wait for the slow tail, so the hosted call gets a bounded
 * wait — it keeps running and fills the predict cache for the next quote — and
 * the honest local layer answers now.
 */
const CLOUD_WAIT_MS = 12_000;

function settled<T>(p: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    p,
    new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), ms);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/**
 * Price the job, in layers, and say which one answered:
 *   1. TabPFN-3.5 through Prior Labs' hosted REST API (no torch needed)
 *   2. the local TabPFN service, where the weights are installed
 *   3. the transparent distance-weighted heuristic over the same rows
 */
export async function priceJob(scope: JobScope, history: PastJob[]): Promise<PricingResult> {
  const f = features(scope);

  const cloud = await settled(tabpfnCloudPredict(f, history).catch(() => null), CLOUD_WAIT_MS);
  const modelBand = usableBand(cloud?.band) ? cloud!.band! : null;

  let result: PricingResult | null = cloud
    ? {
        price: cloud.price,
        low: cloud.low,
        high: cloud.high,
        // When the classifier answered for the recommendation itself, the card's
        // headline odds and the rung under it are the same number by construction.
        winProbability: modelBand ? modelBand[2].win : cloud.winProbability,
        served: 'model',
        basis: modelBand ? `${cloud.basis} · win odds at each price from the same fit` : cloud.basis,
        // The model's own ladder when it slopes; the drawn shape when it does not.
        band: modelBand ?? priceBand(cloud.price, cloud.winProbability),
        bandSource: modelBand ? ('model' as const) : ('modelled' as const),
        usualPrice: null,
        historyUsed: history.length,
      }
    : null;

  if (!result) result = await tabpfnPricing(f, history);
  if (!result) result = heuristicPricing(f, history);

  const usual = result.usualPrice ?? usualPrice(scope, history);
  const range = saneRange(result.price, result.low, result.high, f, history);
  return { ...result, ...range, usualPrice: usual };
}

/** The nudge that keeps a pro from leaving money on the table. */
export function underchargeWarning(quotePrice: number, usual: number | null, scope: JobScope): string | null {
  if (!usual || usual <= 0) return null;
  const gap = usual - quotePrice;
  if (gap > Math.max(35, usual * 0.14)) {
    return `You usually charge about $${usual} for ${scope.jobType.replace(/_/g, ' ')} this size — this quote is $${gap} under your own average.`;
  }
  return null;
}
