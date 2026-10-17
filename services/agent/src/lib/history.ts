import type { PastJob } from './types.js';
import { money, mulberry32, hashStr } from './util.js';

/**
 * Every pro starts with a history. A brand-new account would have none — TabPFN
 * would have nothing to learn from — so the demo persona ships with a realistic
 * record of a solo cleaner/handyman's last two years of work. In production this
 * comes from MongoDB; here it is generated deterministically so the app, the
 * tests and the screenshots are always the same.
 */
export type JobTypePrior = {
  slug: string;
  label: string;
  baseHourly: number; // typical labor rate for this work
  hours: [number, number]; // typical job size
  materials: number; // typical materials per job
  winCurve: number; // steepness of the win-probability drop with price
};

export const JOB_TYPES: JobTypePrior[] = [
  { slug: 'standard_clean', label: 'Standard home clean', baseHourly: 42, hours: [2, 3.5], materials: 8, winCurve: 0.09 },
  { slug: 'deep_clean', label: 'Deep clean', baseHourly: 52, hours: [4, 7], materials: 18, winCurve: 0.07 },
  { slug: 'move_out_clean', label: 'Move-out / end-of-lease clean', baseHourly: 55, hours: [5, 9], materials: 22, winCurve: 0.06 },
  { slug: 'window_clean', label: 'Window clean', baseHourly: 48, hours: [2, 4], materials: 10, winCurve: 0.08 },
  { slug: 'carpet_clean', label: 'Carpet clean', baseHourly: 58, hours: [2, 4], materials: 26, winCurve: 0.07 },
  { slug: 'handyman_small', label: 'Small handyman job', baseHourly: 68, hours: [1, 2.5], materials: 24, winCurve: 0.08 },
  { slug: 'handyman_medium', label: 'Handyman day', baseHourly: 72, hours: [4, 6], materials: 46, winCurve: 0.06 },
  { slug: 'odd_jobs', label: 'Odd jobs run', baseHourly: 60, hours: [2, 4], materials: 20, winCurve: 0.08 },
  { slug: 'gutter_clear', label: 'Gutter clear', baseHourly: 66, hours: [1.5, 3], materials: 12, winCurve: 0.09 },
  { slug: 'pressure_wash', label: 'Pressure wash', baseHourly: 62, hours: [2, 4], materials: 16, winCurve: 0.07 },
];

export const JOB_TYPE_LABELS: Record<string, string> = Object.fromEntries(JOB_TYPES.map((j) => [j.slug, j.label]));

export function canonicalJobType(input: string | undefined | null): string {
  if (!input) return 'standard_clean';
  const raw = input.toLowerCase().trim();
  const direct = JOB_TYPES.find((j) => j.slug === raw || j.label.toLowerCase() === raw);
  if (direct) return direct.slug;
  if (/move.?out|end.?of.?lease|bond/.test(raw)) return 'move_out_clean';
  if (/deep/.test(raw)) return 'deep_clean';
  if (/window|glass/.test(raw)) return 'window_clean';
  if (/carpet|rug|steam/.test(raw)) return 'carpet_clean';
  if (/gutter|downspout/.test(raw)) return 'gutter_clear';
  if (/pressure|power.?wash|jet.?wash/.test(raw)) return 'pressure_wash';
  if (/handyman|repair|fix|install|mount|assemble/.test(raw)) return 'handyman_medium';
  if (/odd.?job|to.?do.?list|errand/.test(raw)) return 'odd_jobs';
  if (/clean/.test(raw)) return 'standard_clean';
  return 'standard_clean';
}

/** Deterministic 42-job history for the demo persona. */
export function seedHistory(seed = 'chalk-demo-pro'): PastJob[] {
  const rng = mulberry32(hashStr(seed));
  const jobs: PastJob[] = [];
  const start = Date.parse('2024-11-04T09:00:00Z');
  for (let i = 0; i < 42; i++) {
    const prior = JOB_TYPES[Math.floor(rng() * JOB_TYPES.length)];
    const span = prior.hours[1] - prior.hours[0];
    const hours = Math.round((prior.hours[0] + rng() * span) * 4) / 4;
    const rooms = Math.max(1, Math.round(hours / 1.6 + rng() * 1.5));
    const complexityAvg = Math.round((2 + rng() * 2.4) * 10) / 10;
    const complexityMax = Math.min(5, Math.round((complexityAvg + rng() * 1.4) * 10) / 10);
    const accessDifficulty = rng() < 0.32 ? Math.floor(1 + rng() * 3) : 0;
    const riskCount = rng() < 0.4 ? Math.floor(1 + rng() * 3) : 0;
    const materialsCost = money(prior.materials * (0.6 + rng() * 0.9));
    const tasks = Math.max(2, Math.round(hours * 1.6 + rng() * 2));
    // A pro's real price: labor + materials, with a small premium for hard access.
    const labor = hours * prior.baseHourly * (0.92 + rng() * 0.22);
    const access = accessDifficulty * 14;
    const price = money(labor + materialsCost + access);
    const won = rng() < 0.68;
    jobs.push({
      dateKey: new Date(start + i * 16 * 86_400_000).toISOString().slice(0, 10),
      jobType: prior.slug,
      totalHours: hours,
      tasks,
      rooms,
      complexityAvg,
      complexityMax,
      materialsCost,
      accessDifficulty,
      riskCount,
      price,
      won,
      daysToAccept: won ? Math.round(1 + rng() * 5) : null,
    });
  }
  return jobs;
}
