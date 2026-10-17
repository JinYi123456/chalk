import type { PriceBand } from './types.js';
import { clamp, money } from './util.js';

/**
 * The five asks the ladder compares. Index 2 is the recommendation, and the
 * order is load-bearing: the UI, the pricing result and the TabPFN batch call
 * all index into it.
 *
 * This module is deliberately dependency-free (no config, no client, no other
 * lib module) so both the pure pricing math and the hosted TabPFN client can
 * use the same ladder without importing each other.
 */
export const BAND_STEPS: { label: string; mult: number }[] = [
  { label: 'Win the job', mult: 0.85 },
  { label: 'Fair', mult: 0.95 },
  { label: 'Recommended', mult: 1.0 },
  { label: 'Strong', mult: 1.1 },
  { label: 'Max', mult: 1.22 },
];

/** The candidate prices for a recommended total, in ladder order. */
export function bandPrices(base: number): number[] {
  return BAND_STEPS.map((s) => money(base * s.mult));
}

/**
 * Is the model's own ladder worth showing?
 *
 * Measured on the demo ledger (45 jobs), the classifier answered every rung and
 * produced this: 66% · 67% · 67% · 65% · 67% across a 44% price range. It is a
 * real answer from a real fit, and it is useless — worse than useful: it tells a
 * pro that price does not change their odds. At small n the win/lose signal is
 * mostly noise, so the honest move is to require the ladder to actually slope
 * before it replaces the drawn shape, and to say which one answered.
 *
 * A usable ladder falls as the price rises (a little noise tolerated) and spans
 * at least ten points end to end. As the ledger grows this test starts passing
 * on its own, and the card switches to the model's numbers.
 */
export function usableBand(band: PriceBand[] | null | undefined): band is PriceBand[] {
  if (!band || band.length < 3) return false;
  const wins = band.map((b) => b.win);
  const spread = Math.max(...wins) - Math.min(...wins);
  const nonIncreasing = wins.every((w, i) => i === 0 || w <= wins[i - 1] + 0.06);
  return spread >= 0.1 && nonIncreasing;
}

/**
 * The ladder straight from the classifier: one probability per candidate price,
 * from the same fit that produced the odds on the card. Returns null unless the
 * model answered for every rung — a half-filled ladder would be a lie of shape,
 * so the caller falls back to the drawn line instead.
 */
export function bandFromProbs(base: number, probs: number[]): PriceBand[] | null {
  const prices = bandPrices(base);
  if (probs.length !== prices.length) return null;
  return BAND_STEPS.map((s, i) => ({
    label: s.label,
    at: prices[i],
    win: Math.round(clamp(probs[i], 0.02, 0.98) * 100) / 100,
  }));
}
