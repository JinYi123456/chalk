import { z } from 'zod';
import type { SiteRead } from './vision.js';
import { canonicalJobType, JOB_TYPE_LABELS } from './history.js';
import { chatText, providerReady, resolvedTextModel } from './llm.js';
import { clamp, looseJson, money } from './util.js';
import type { JobScope, ScopeTask } from './types.js';

export const ScopeDraft = z.object({
  jobType: z.string().default(''),
  headline: z.string().default(''),
  rooms: z.array(z.object({ name: z.string(), condition: z.string().default('') })).default([]),
  tasks: z
    .array(
      z.object({
        label: z.string(),
        qty: z.number().default(1),
        unit: z.string().default('job'),
        hours: z.number().default(1),
        complexity: z.number().default(3),
        // Which walkthrough photo shows this task — it becomes the evidence
        // shown next to the line item on the client's quote.
        //
        // nullish, not optional: told to omit the field for a task no photo
        // shows, the model answers `"photo": null`. Measured on the deployed
        // build — one null on one task threw away an otherwise perfect scope
        // and the quote silently priced off the deterministic floor.
        photo: z.number().nullish(),
      })
    )
    .default([]),
  materials: z.array(z.object({ label: z.string(), cost: z.number().default(0) })).default([]),
  access: z.array(z.string()).default([]),
  risks: z.array(z.string()).default([]),
  confidence: z.number().default(0.6),
});
export type ScopeDraft = z.infer<typeof ScopeDraft>;

/** The exact estimator system prompt — exported so the benchmark cannot drift from it. */
export const SYSTEM = `You are Chalk's estimator. You turn a walkthrough — photos plus the pro's own words — into an itemized scope of work that a pricing model can reason about, and that a client can read.

Rules:
- Work in the pro's trade. If they clean, tasks are cleaning tasks. If they fix, tasks are repairs. Do not invent a different trade.
- Every task is a real, billable unit of work with an honest hours estimate and a complexity 1 (easy) to 5 (brutal).
- hours must reflect how long the work actually takes a competent solo pro, not a guess that makes the number pretty.
- materials are consumables you would buy for this job, with a realistic cost.
- access is anything that changes the price: stairs, no parking, keys, occupied home, tight access.
- risks are conditions that could blow the job up: grease, mold, pets, damage, fragile items. Empty is fine.
- photo: when photos are supplied, the 1-based index of the photo that shows this task. Omit it for a task no photo shows — a wrong photo next to a line item is worse than none.
- Never claim to see something the photos and words do not support.
${'' /* job type vocabulary is injected per request */}
Answer with ONLY minified JSON matching:
{"jobType":"","headline":"","rooms":[{"name":"","condition":""}],"tasks":[{"label":"","qty":1,"unit":"","hours":2,"complexity":3,"photo":1}],"materials":[{"label":"","cost":0}],"access":[""],"risks":[""],"confidence":0.0}`;

export type ScopeInput = {
  site: SiteRead | null;
  notes: string;
  jobTypeHint?: string;
  client?: string;
  /** how many walkthrough photos the pro actually attached */
  photoCount?: number;
};

/** The walkthrough report handed to the estimator. Exported for the benchmark. */
export function scopeReport(input: ScopeInput): string {
  return JSON.stringify(
    {
      proSaysJobType: input.jobTypeHint || '',
      knownJobTypes: Object.keys(JOB_TYPE_LABELS),
      client: input.client || '',
      proWords: input.notes || '(none)',
      photoCount: input.photoCount ?? 0,
      whatTheCameraSaw: input.site
        ? {
            summary: input.site.seen,
            observations: input.site.observations,
            measures: input.site.measures,
            conditions: input.site.conditions,
            perPhoto: input.site.captions,
          }
        : null,
    },
    null,
    0
  );
}

export function normalizeScope(draft: ScopeDraft, input: ScopeInput): JobScope {
  const maxPhoto = Math.max(0, Math.min(input.photoCount ?? 0, 4));
  const tasks: ScopeTask[] = draft.tasks
    .map((t) => {
      const p = Math.round(Number(t.photo));
      return {
        label: t.label.trim().slice(0, 80),
        qty: clamp(Math.round(Number(t.qty) || 1), 1, 999),
        unit: (t.unit || 'job').trim().slice(0, 24),
        hours: clamp(Number(t.hours) || 1, 0.25, 40),
        complexity: clamp(Math.round(Number(t.complexity) || 3), 1, 5),
        // A photo index we cannot point at is dropped, not guessed.
        ...(Number.isFinite(p) && p >= 1 && p <= maxPhoto ? { photo: p } : {}),
      };
    })
    .filter((t) => t.label.length > 0)
    .slice(0, 12);

  const totalHours = Math.round(tasks.reduce((s, t) => s + t.hours, 0) * 4) / 4;
  const jobType = canonicalJobType(draft.jobType || input.jobTypeHint || input.notes);

  return {
    jobType,
    headline: (draft.headline || JOB_TYPE_LABELS[jobType] || 'Home-service job').trim().slice(0, 90),
    rooms: draft.rooms
      .map((r) => ({ name: r.name.trim().slice(0, 40), condition: (r.condition || '').trim().slice(0, 80) }))
      .filter((r) => r.name)
      .slice(0, 12),
    tasks,
    materials: draft.materials
      .map((m) => ({ label: m.label.trim().slice(0, 60), cost: money(m.cost) }))
      .filter((m) => m.label)
      .slice(0, 10),
    access: draft.access.map((a) => a.trim()).filter(Boolean).slice(0, 6),
    risks: draft.risks.map((a) => a.trim()).filter(Boolean).slice(0, 6),
    totalHours,
    confidence: clamp(Number(draft.confidence) || 0.6, 0, 1),
    seen: input.site?.seen ?? 'read from the pro\'s words only',
    basis: input.site ? ['photos (open-weight vision)', 'pro notes'] : ['pro notes'],
  };
}

/** Deterministic scope from words alone — used when no model is reachable. */
export function heuristicScope(input: ScopeInput): JobScope {
  const jobType = canonicalJobType(input.jobTypeHint || input.notes);
  const words = `${input.notes} ${input.site?.seen ?? ''}`.toLowerCase();
  const rooms = Math.max(1, Math.min(6, (words.match(/\b(\d+)\s*(bed|bedroom|room)/g)?.length ?? 0) + (/kitchen/.test(words) ? 1 : 0) + (/bath/.test(words) ? 1 : 0) || 2));
  const heavy = /deep|grease|move.?out|filthy|neglect|construction/.test(words);
  const hours = Math.round((heavy ? 5.5 : 2.5) * (rooms / 2 + 0.5) * 4) / 4;
  const tasks: ScopeTask[] = [
    { label: heavy ? 'Deep clean all kitchen surfaces' : 'Clean kitchen', qty: 1, unit: 'kitchen', hours: Math.round(hours * 0.35 * 4) / 4, complexity: heavy ? 4 : 2 },
    { label: 'Clean and sanitise bathrooms', qty: Math.max(1, /bath/.test(words) ? 1 : 1), unit: 'bath', hours: Math.round(hours * 0.3 * 4) / 4, complexity: 3 },
    { label: 'Floors, dusting and general tidy', qty: rooms, unit: 'room', hours: Math.round(hours * 0.35 * 4) / 4, complexity: 2 },
  ];
  return {
    jobType,
    headline: `${rooms}-room ${JOB_TYPE_LABELS[jobType]?.toLowerCase() ?? 'home-service job'}`,
    rooms: [],
    tasks,
    materials: [{ label: 'Consumables and supplies', cost: money(heavy ? 22 : 10) }],
    access: [],
    risks: [],
    totalHours: Math.round(tasks.reduce((s, t) => s + t.hours, 0) * 4) / 4,
    confidence: 0.35,
    seen: input.site?.seen ?? 'word-only estimate',
    basis: ['pro notes', 'deterministic estimate (no model reachable)'],
  };
}

/** Extract a priced scope from the walkthrough. Falls back to the deterministic scope. */
export async function extractScope(input: ScopeInput): Promise<JobScope> {
  if (!providerReady()) return heuristicScope(input);
  const prompt = `${SYSTEM}\n\nWALKTHROUGH:\n${scopeReport(input)}\n\nReturn the scope JSON now.`;
  const text = await chatText(
    [
      { role: 'system', content: 'You output only minified JSON. No prose, no code fences.' },
      { role: 'user', content: prompt },
    ],
    { temperature: 0.3, maxTokens: 900 }
  );
  const parsed = text ? ScopeDraft.safeParse(looseJson(text)) : null;
  if (parsed?.success && parsed.data.tasks.length > 0) {
    return { ...normalizeScope(parsed.data, input), basis: [...(input.site ? ['photos (open-weight vision)'] : []), 'pro notes', `scope: ${resolvedTextModel()}`] };
  }

  // One repair pass — small models sometimes wrap JSON in prose.
  const repaired = await chatText(
    [
      {
        role: 'user',
        content: `Convert this into ONLY the required minified scope JSON (keys jobType, headline, rooms, tasks, materials, access, risks, confidence). Answer:\n${(text ?? '').slice(0, 1500)}`,
      },
    ],
    { temperature: 0.1, maxTokens: 800 }
  );
  const fixed = repaired ? ScopeDraft.safeParse(looseJson(repaired)) : null;
  if (fixed?.success && fixed.data.tasks.length > 0) {
    return { ...normalizeScope(fixed.data, input), basis: [...(input.site ? ['photos (open-weight vision)'] : []), 'pro notes', `scope: ${resolvedTextModel()}`] };
  }
  return heuristicScope(input);
}
