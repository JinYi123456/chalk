/**
 * The head-to-head: the same walkthrough, the same production prompt, sent to
 * closed and open-weight models — and to a model running on this laptop with no
 * network at all. Scores are keyword-set recall against a hand-written answer
 * key, so every number here is re-computable by anyone who clones the repo:
 * there is no model judging a model.
 *
 * Two arms are measured separately on purpose. `eyes` scores the vision read
 * alone; `scope` scores the estimator alone, fed one authored site read, so a
 * weak pair of eyes can never be blamed on a weak brain.
 */
import { config } from '../config.js';
import { buildPrompt, normalize, type RawRead, type SiteRead } from './vision.js';
import { SYSTEM, scopeReport, ScopeDraft, normalizeScope, heuristicScope, type ScopeInput } from './scope.js';
import { canonicalJobType } from './history.js';
import { looseJson, stripThinking } from './util.js';
import type { JobScope } from './types.js';

export type Weights = 'closed' | 'open' | 'none';

export type Arm = {
  id: string;
  label: string;
  vendor: string;
  weights: Weights;
  where: 'hosted' | 'device';
  baseURL: string;
  apiKey: string;
  model: string;
  /** set only where this endpoint takes images; absent means "cannot be an eye" */
  vision?: { model: string };
  /** hosted endpoints need more room than a 4B local model can spend */
  maxTokens: number;
  /** USD per million tokens, or null when the provider publishes no such price */
  price: { in: number; out: number } | null;
  priceNote?: string;
  /** arms whose price is null are reported in tokens, never in dollars */
};

const OLLAMA = `${config.ollamaBaseUrl}/v1`;
const GOOGLE = 'https://generativelanguage.googleapis.com/v1beta/openai';

/**
 * Every arm is a model the product can actually be pointed at today. Prices are
 * list prices transcribed from the provider's own pricing page on 2026-10-17;
 * `null` means the provider publishes no per-token price for that id, and the
 * runner then reports tokens only rather than inventing a dollar figure.
 */
export const ARMS: Arm[] = [
  {
    id: 'closed-flash',
    label: 'Gemini 3.8 Flash',
    vendor: 'Google AI Studio',
    weights: 'closed',
    where: 'hosted',
    baseURL: GOOGLE,
    apiKey: config.googleApiKey,
    model: 'gemini-3.8-flash',
    vision: { model: 'gemini-3.8-flash' },
    maxTokens: 1400,
    price: { in: 0.75, out: 3.75 },
    priceNote: 'introductory rate published through 2026-12-31',
  },
  {
    id: 'closed-lite',
    label: 'Gemini 3.1 Flash-Lite',
    vendor: 'Google AI Studio',
    weights: 'closed',
    where: 'hosted',
    baseURL: GOOGLE,
    apiKey: config.googleApiKey,
    model: 'gemini-3.1-flash-lite',
    vision: { model: 'gemini-3.1-flash-lite' },
    maxTokens: 1400,
    price: { in: 0.25, out: 1.5 },
  },
  {
    id: 'open-gemma-hosted',
    label: 'Gemma 4 26B-A4B (open weights)',
    vendor: 'Google AI Studio — same endpoint',
    weights: 'open',
    where: 'hosted',
    baseURL: GOOGLE,
    apiKey: config.googleApiKey,
    model: config.googleModel,
    maxTokens: 3200,
    price: null,
    priceNote: 'AI Studio publishes no per-token price for Gemma, so this row is tokens only',
  },
  {
    id: 'open-qwen-nebius',
    label: 'Qwen3 30B-A3B (open weights)',
    vendor: 'Nebius Studio',
    weights: 'open',
    where: 'hosted',
    baseURL: 'https://api.studio.nebius.com/v1',
    apiKey: config.nebiusApiKey,
    model: config.nebiusModel,
    vision: { model: 'google/gemma-3-27b-it' },
    maxTokens: 1400,
    price: { in: 0.1, out: 0.3 },
  },
  {
    id: 'open-qwen-featherless',
    label: 'Qwen3 30B-A3B (open weights)',
    vendor: 'Featherless — same model, other host',
    weights: 'open',
    where: 'hosted',
    baseURL: 'https://api.featherless.ai/v1',
    apiKey: config.featherlessApiKey,
    model: config.featherlessModel,
    vision: { model: 'Qwen/Qwen3-VL-30B-A3B-Instruct' },
    maxTokens: 1400,
    price: { in: 0.125, out: 0.45 },
    priceNote: 'vision sibling Qwen3-VL-30B is $0.15 / $0.50 on the same page',
  },
  {
    id: 'open-gemma-device',
    label: 'Gemma 4 E2B on this laptop',
    vendor: 'Ollama, offline',
    weights: 'open',
    where: 'device',
    baseURL: OLLAMA,
    apiKey: 'ollama',
    model: 'gemma4:e2b',
    vision: { model: 'gemma3:4b' },
    maxTokens: 900,
    price: { in: 0, out: 0 },
    priceNote: "no per-token price exists — the weights run on the pro's own machine",
  },
];

export const visionArms = (): Arm[] => ARMS.filter((a) => a.vision);

/**
 * What may leave the process. An Arm carries the endpoint credential, and a
 * report is a published artifact — so the key is stripped here rather than at
 * each call site, where forgetting one would put a live API key in a repo.
 */
export function armPublic(a: Arm): Omit<Arm, 'apiKey'> {
  const { apiKey: _apiKey, ...rest } = a;
  return rest;
}

/* ── the answer key ─────────────────────────────────────────────────────── */

export type VisionCase = {
  id: string;
  jobType: string;
  notes: string;
  /** fixture basenames, in the order the pro took them */
  photos: string[];
  /** each group is one thing that is genuinely in the picture; any alternative matches */
  mustSee: string[][];
  /** things NOT in these pictures — naming one is a hallucination */
  forbidden: string[];
};

export const VISION_CASES: VisionCase[] = [
  {
    id: 'v1-kitchen-oven',
    jobType: 'move_out_clean',
    notes: 'Kitchen and the oven. Landlord wants it back to the state it was let in.',
    photos: ['kitchen', 'oven'],
    mustSee: [
      ['hob', 'burner', 'cooktop', 'stove', 'gas ring'],
      ['grease', 'grime', 'baked-on', 'burnt', 'caked', 'built-on'],
      ['splashback', 'splash back', 'tile', 'grout', 'wall'],
      ['oven', 'cavity', 'rack', 'shelf', 'element'],
      ['floor', 'wooden', 'floorboard'],
      ['cabinet', 'cupboard', 'worktop', 'counter', 'unit'],
      ['sink', 'taps', 'faucet'],
    ],
    forbidden: ['carpet', 'shower', 'toilet', 'limescale', 'staircase', 'sofa', 'wardrobe', 'bed frame'],
  },
  {
    id: 'v2-lounge-bedroom',
    jobType: 'move_out_clean',
    notes: 'Front room and the double. It has been lived in with two cats.',
    photos: ['living-room', 'bedroom'],
    mustSee: [
      ['carpet'],
      ['sofa', 'couch', 'settee'],
      ['curtain', 'drape'],
      ['stain', 'soiled', 'dirty', 'mark', 'traffic', 'discolour'],
      ['television', ' tv', 'tv unit', 'media unit'],
      ['bed frame', 'slatted', 'slats', 'mattress', 'bedstead'],
      ['wardrobe', 'cupboard', 'closet'],
      ['blind', 'window'],
    ],
    forbidden: ['oven', 'hob', 'shower', 'toilet', 'limescale', 'staircase', 'sink'],
  },
  {
    id: 'v3-bath-stairs',
    jobType: 'deep_clean',
    notes: 'Bathroom and the stairwell. The tenant never opened the shower screen.',
    photos: ['bathroom', 'stairs'],
    mustSee: [
      ['shower', 'cubicle', 'enclosure', 'screen'],
      ['glass'],
      ['limescale', 'hard water', 'water stain', 'watermark', 'scale', 'spots'],
      ['toilet', 'w.c', 'wc', 'loo'],
      ['mould', 'mold', 'grout', 'silicone', 'pink'],
      ['stair', 'step', 'riser', 'tred'],
      ['carpet'],
      ['handrail', 'banister', 'rail', 'spindle'],
      ['cobweb', 'web'],
    ],
    forbidden: ['oven', 'hob', 'grease', 'sofa', 'wardrobe', 'curtain', 'kitchen'],
  },
  {
    id: 'v4-kitchen-silent',
    jobType: '',
    notes: '',
    photos: ['kitchen'],
    mustSee: [
      ['hob', 'burner', 'stove', 'cooktop'],
      ['grease', 'grime', 'burnt', 'baked-on', 'filth'],
      ['tile', 'splashback', 'grout'],
      ['floor', 'wooden'],
      ['cabinet', 'cupboard', 'unit', 'worktop'],
    ],
    forbidden: ['carpet', 'shower', 'toilet', 'staircase', 'sofa', 'bed'],
  },
];

export type ScopeCase = {
  id: string;
  jobTypeHint: string;
  notes: string;
  client: string;
  /** the site read handed to the estimator — authored, so every arm sees the same eyes */
  site: SiteRead | null;
  photoCount: number;
  key: {
    jobType: string;
    /** each group is billable work that belongs on this job */
    must: string[][];
    /** work that is not part of this job — pricing it in is a precision loss */
    forbidden: string[];
    hours: [number, number];
    minTasks: number;
    maxTasks: number;
    /** true when at least one line should point back at a photo */
    expectPhotoRefs: boolean;
  };
};

const eyes = (over: Partial<SiteRead>): SiteRead => ({
  seen: '',
  observations: [],
  measures: [],
  conditions: [],
  captions: [],
  engine: 'authored answer key (not a model)',
  ms: 0,
  ...over,
});

export const SCOPE_CASES: ScopeCase[] = [
  {
    id: 's1-end-of-lease-2bed',
    jobTypeHint: 'move_out_clean',
    notes: 'Two-bed terrace, end of lease, they want the deposit back. Cat hair everywhere.',
    client: 'Nadia',
    photoCount: 4,
    site: eyes({
      seen: 'Lounge and bedroom with soiled carpet and pet hair; kitchen with a greasy hob and stained splashback; carpeted stairs with a worn handrail.',
      observations: ['beige carpet with traffic marks', 'crumbs on sofa', 'pet hair on risers', 'greasy gas hob', 'stained tiled splashback', 'dusty roller blinds', 'worn wooden handrail'],
      measures: ['2 bedrooms', '1 lounge', 'approx 12 stairs', '4 windows'],
      conditions: ['heavy pet hair', 'built-on grease in kitchen', 'narrow stair turn', 'deposit-return standard'],
      captions: ['lounge: stained carpet, crumbs on sofa', 'bedroom: soaled carpet, dusty blinds', 'kitchen: greasy hob, stained splashback', 'stairs: pet hair on carpet, worn handrail'],
    }),
    key: {
      jobType: 'move_out_clean',
      must: [
        ['carpet', 'steam'],
        ['hob', 'oven', 'cooktop', 'appliance'],
        ['splashback', 'tile', 'grout', 'worktop', 'cabinet', 'kitchen'],
        ['blind', 'window', 'glass', 'track'],
        ['skirting', 'dust', 'cornice', 'web', 'wall', 'socket', 'handle'],
        ['stair', 'banister', 'handrail', 'riser'],
        ['sofa', 'upholster', 'pet hair', 'lint'],
        ['bathroom', 'shower', 'toilet', 'suite'],
      ],
      forbidden: ['garden', 'driveway', 'soffit', 'roof', 'carpet shampoo machine hire', 'exterior wall', 'loft'],
      hours: [6, 11.5],
      minTasks: 6,
      maxTasks: 12,
      expectPhotoRefs: true,
    },
  },
  {
    id: 's2-3bed-deep-clean',
    jobTypeHint: 'deep_clean',
    notes: 'Three-bed semi, first deep clean in two years. Two cats, no parking outside, third floor with a lift that does not work.',
    client: 'Okafor',
    photoCount: 3,
    site: eyes({
      seen: 'Bathroom with limescaled shower glass and pink mould in the silicone; lounge with marked carpet and dusty soft furnishing; kitchen worktops cluttered and greasy.',
      observations: ['limescale on shower glass', 'mould in silicone seam', 'limescaled tap', 'stained toilet rim', 'marked carpet', 'dusty windowsill', 'greasy worktop'],
      measures: ['3 bedrooms', '2 bathrooms', '1 lounge', '1 kitchen'],
      conditions: ['limescale build-up', 'mould in wet seals', 'no parking', 'lift out of service', 'occupied home'],
      captions: ['bathroom: limescaled glass, mould in seal', 'lounge: marked carpet, dust on sills', 'kitchen: greasy worktops'],
    }),
    key: {
      jobType: 'deep_clean',
      must: [
        ['limescale', 'descale', 'glass', 'shower', 'screen'],
        ['mould', 'mold', 'silicone', 'seal', 'grout'],
        ['toilet', 'bathroom', 'suite', 'sanitary'],
        ['carpet', 'upholster', 'sofa'],
        ['dust', 'sill', 'skirting', 'ledge'],
        ['kitchen', 'worktop', 'grease', 'degrease'],
        ['access', 'stairs', 'lift', 'parking'],
      ],
      forbidden: ['garden', 'driveway', 'soffit', 'chimney', 'loft', 'exterior rendering', 'asbestos'],
      hours: [7, 13],
      minTasks: 6,
      maxTasks: 12,
      expectPhotoRefs: true,
    },
  },
  {
    id: 's3-oven-only',
    jobTypeHint: 'deep_clean',
    notes: 'Just the oven. Five years of Sunday roasts, the landlord is inspecting on Friday.',
    client: 'Whitfield',
    photoCount: 1,
    site: eyes({
      seen: 'Open fan oven with thick burnt-on grease baked to the roof, back wall and floor; two coated wire racks; the door glass splattered and baked.',
      observations: ['burnt-on grease on cavity roof', 'baked spillage on floor element', 'grease-coated wire racks', 'splattered door glass', 'fan vent at the back'],
      measures: ['one single oven', '2 racks', '1 door'],
      conditions: ['built-on grease, several years', 'baked-on spillage on element', 'inspection deadline'],
      captions: ['oven: thick baked-on grease on cavity and racks'],
    }),
    key: {
      jobType: 'deep_clean',
      must: [
        ['oven', 'cavity'],
        ['rack', 'shelf', 'grid'],
        ['door', 'glass', 'seal'],
        ['degrease', 'degrea', 'caustic', 'soak', 'apply'],
        ['element', 'fan', 'grill'],
      ],
      forbidden: ['carpet', 'window', 'bathroom', 'whole kitchen', 'fridge', 'hob', 'floor of the kitchen', 'loft'],
      hours: [1.5, 4],
      minTasks: 3,
      maxTasks: 9,
      expectPhotoRefs: true,
    },
  },
  {
    id: 's4-handyman-run',
    jobTypeHint: 'handyman_medium',
    notes: 'Flat-pack wardrobe to assemble in the box room, mount a 55-inch TV on a plasterboard wall, the kitchen tap drips, and one gutter bracket came off the fence.',
    client: 'Bello',
    photoCount: 0,
    site: null,
    key: {
      jobType: 'handyman_medium',
      must: [
        ['wardrobe', 'flat-pack', 'flatpack', 'assembl', 'build'],
        ['tv', 'television', 'mount', 'bracket'],
        ['plasterboard', 'anchor', 'stud', 'wall'],
        ['tap', 'washer', 'drip', 'leak'],
        ['gutter', 'bracket', 'fence'],
      ],
      forbidden: ['carpet', 'oven', 'window clean', 'deep clean', 'bathroom', 'mould'],
      hours: [2.5, 6],
      minTasks: 4,
      maxTasks: 10,
      expectPhotoRefs: false,
    },
  },
  {
    id: 's5-carpet-and-stairs',
    jobTypeHint: 'carpet_clean',
    notes: 'Three rooms of carpet and the whole stair, dog shed everywhere, one red wine spot on the landing.',
    client: 'Rahman',
    photoCount: 0,
    site: null,
    key: {
      jobType: 'carpet_clean',
      must: [
        ['carpet', 'steam', 'extraction'],
        ['stair', 'riser', 'landing'],
        ['pet', 'dog', 'hair', 'dander'],
        ['spot', 'stain', 'pretreat', 'pre-spray', 'wine'],
        ['dry', 'ventilat', 'speed dry'],
        ['vacuum', 'dry soil', 'agitate'],
      ],
      forbidden: ['oven', 'window', 'bathroom', 'kitchen cabinet', 'hard floor', 'mop'],
      hours: [2.5, 5.5],
      minTasks: 4,
      maxTasks: 10,
      expectPhotoRefs: false,
    },
  },
  {
    id: 's6-windows-inside-out',
    jobTypeHint: 'window_clean',
    notes: 'Every window in and out, two storeys, the venetian blinds need degreasing in the bath, and one downstairs pane has misting between the glass.',
    client: 'Chua',
    photoCount: 0,
    site: null,
    key: {
      jobType: 'window_clean',
      must: [
        ['window', 'pane', 'glass'],
        ['inside', 'internal'],
        ['outside', 'external', 'reach', 'ladder', 'pole'],
        ['frame', 'sill', 'track', 'ledge'],
        ['blind', 'venetian', 'degrease'],
        ['mist', 'sealed unit', 'condensation', 'failed seal', 'replace'],
      ],
      forbidden: ['carpet', 'oven', 'gutter clean', 'soffit wash', 'roof', 'wall wash'],
      hours: [2, 5],
      minTasks: 4,
      maxTasks: 10,
      expectPhotoRefs: false,
    },
  },
];

/* ── scoring ────────────────────────────────────────────────────────────── */

const hay = (parts: (string | undefined)[]): string => ` ${parts.filter(Boolean).join(' ').toLowerCase()} `;

function groupHits(groups: string[][], text: string): number {
  return groups.filter((g) => g.some((alt) => text.includes(alt.toLowerCase()))).length;
}

export type VisionScore = {
  recall: number;
  seen: number;
  of: number;
  /**
   * Recall measured on the raw reply text, before the parser. The gap between
   * `recall` and `textRecall` is the difference between a model that understood
   * the photo and a model that answered in a shape the product can use.
   */
  textRecall: number;
  hallucinations: string[];
  captionCount: number;
  captionCountOk: boolean;
  schemaValid: boolean;
};

export function scoreVision(read: SiteRead | null, photos: number, c: VisionCase, rawText = ''): VisionScore {
  const textHay = hay([read?.seen, ...(read?.observations ?? []), ...(read?.measures ?? []), ...(read?.conditions ?? []), ...(read?.captions ?? [])]);
  const rawHay = read ? textHay : hay([rawText]);
  if (!read) {
    return {
      recall: 0,
      seen: 0,
      of: c.mustSee.length,
      textRecall: c.mustSee.length ? groupHits(c.mustSee, rawHay) / c.mustSee.length : 0,
      hallucinations: [],
      captionCount: 0,
      captionCountOk: false,
      schemaValid: false,
    };
  }
  const hallucinations = c.forbidden.filter((f) => textHay.includes(f.toLowerCase()));
  const seen = groupHits(c.mustSee, textHay);
  return {
    recall: c.mustSee.length ? seen / c.mustSee.length : 0,
    seen,
    of: c.mustSee.length,
    textRecall: c.mustSee.length ? groupHits(c.mustSee, rawHay) / c.mustSee.length : 0,
    hallucinations,
    captionCount: read.captions.length,
    captionCountOk: read.captions.length === photos,
    schemaValid: true,
  };
}

export type ScopeScore = {
  jobTypeOk: boolean;
  recall: number;
  matched: number;
  of: number;
  /** recall over the raw reply — see the note on VisionScore.textRecall */
  textRecall: number;
  invented: string[];
  precision: number;
  hoursOk: boolean;
  hours: number;
  taskCount: number;
  photoRefsOk: boolean;
  schemaValid: boolean;
};

export function scoreScope(scope: JobScope | null, c: ScopeCase, rawText = ''): ScopeScore {
  const k = c.key;
  const textRecall = k.must.length ? groupHits(k.must, hay([rawText])) / k.must.length : 0;
  if (!scope) {
    return { jobTypeOk: false, recall: 0, matched: 0, of: k.must.length, textRecall, invented: [], precision: 0, hoursOk: false, hours: 0, taskCount: 0, photoRefsOk: false, schemaValid: false };
  }
  const labels = scope.tasks.map((t) => `${t.label} ${t.unit}`.toLowerCase());
  const text = hay(labels);
  const matched = groupHits(k.must, text);
  // A task is "invented" when it names work this walkthrough does not support.
  const invented = labels.filter((l) => k.forbidden.some((f) => l.includes(f.toLowerCase())));
  const referenced = scope.tasks.filter((t) => typeof t.photo === 'number').length;
  return {
    jobTypeOk: canonicalJobType(scope.jobType) === k.jobType,
    recall: k.must.length ? matched / k.must.length : 0,
    matched,
    of: k.must.length,
    textRecall,
    invented,
    precision: labels.length ? 1 - invented.length / labels.length : 0,
    hoursOk: scope.totalHours >= k.hours[0] && scope.totalHours <= k.hours[1],
    hours: scope.totalHours,
    taskCount: scope.tasks.length,
    photoRefsOk: k.expectPhotoRefs ? referenced >= Math.min(2, scope.tasks.length) : true,
    schemaValid: scope.tasks.length > 0,
  };
}

/* ── the calls ──────────────────────────────────────────────────────────── */

export type CallResult = {
  ok: boolean;
  ms: number;
  inTokens: number;
  outTokens: number;
  status: number;
  error?: string;
  text?: string;
};

/** One pinned call. Deliberately does NOT walk the chain — pinning is the point. */
async function call(arm: Arm, model: string, messages: unknown[], maxTokens: number, timeoutMs: number): Promise<CallResult> {
  const t0 = performance.now();
  try {
    const res = await fetch(`${arm.baseURL.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(arm.apiKey ? { authorization: `Bearer ${arm.apiKey}` } : {}) },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: maxTokens,
        messages,
        // Ollama unloads after five minutes by default; reloading 4.6 GB of
        // weights between cases would measure the disk, not the model.
        ...(arm.where === 'device' ? { keep_alive: '20m' } : {}),
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const ms = Math.round(performance.now() - t0);
    if (!res.ok) {
      const body = (await res.text()).slice(0, 200).replace(/\s+/g, ' ');
      return { ok: false, ms, inTokens: 0, outTokens: 0, status: res.status, error: body };
    }
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const text = stripThinking(data.choices?.[0]?.message?.content ?? '');
    return {
      ok: text.length > 0,
      ms,
      inTokens: data.usage?.prompt_tokens ?? 0,
      outTokens: data.usage?.completion_tokens ?? 0,
      status: 200,
      error: text.length ? undefined : 'empty',
      text,
    };
  } catch (e) {
    return { ok: false, ms: Math.round(performance.now() - t0), inTokens: 0, outTokens: 0, status: 0, error: e instanceof Error ? e.message : 'threw' };
  }
}

function parseRaw(text: string): RawRead | null {
  const start = text.indexOf('{');
  if (start === -1) return null;
  try {
    return JSON.parse(text.slice(start, text.lastIndexOf('}') + 1)) as RawRead;
  } catch {
    return null;
  }
}

/** data-url of a fixture, resolved from the repo so the eval is reproducible anywhere. */
export async function fixtureDataUrl(name: string): Promise<string> {
  const { readFile } = await import('node:fs/promises');
  const { resolve, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const here = dirname(fileURLToPath(import.meta.url));
  const p = resolve(here, '..', '..', '..', '..', 'eval', 'fixtures', `${name}.jpg`);
  const buf = await readFile(p);
  return `data:image/jpeg;base64,${buf.toString('base64')}`;
}

export type ArmRun = {
  arm: string;
  case: string;
  ok: boolean;
  ms: number;
  inTokens: number;
  outTokens: number;
  cost: number | null;
  error?: string;
  score?: VisionScore | ScopeScore;
  detail?: { tasks?: string[]; observations?: string[]; totalHours?: number; jobType?: string; photoRefs?: number };
};

const costOf = (arm: Arm, r: CallResult): number | null =>
  arm.price === null ? null : (r.inTokens * arm.price.in + r.outTokens * arm.price.out) / 1e6;

/** Score the eyes on one photo set. No repair pass — a quote gets one honest try. */
export async function runVisionArm(arm: Arm, c: VisionCase): Promise<ArmRun> {
  const model = arm.vision?.model ?? arm.model;
  const images = await Promise.all(c.photos.map((p) => fixtureDataUrl(p)));
  const prompt = buildPrompt(c.jobType, c.notes, c.photos.length);
  const r = await call(arm, model, [{ role: 'user', content: [{ type: 'text', text: prompt }, ...images.map((u) => ({ type: 'image_url', image_url: { url: u } }))] }], Math.max(arm.maxTokens, 2200), arm.where === 'device' ? 420_000 : 180_000);
  if (!r.ok || !r.text) return { arm: arm.id, case: c.id, ok: false, ms: r.ms, inTokens: r.inTokens, outTokens: r.outTokens, cost: costOf(arm, r), error: r.error ?? `HTTP ${r.status}`, score: scoreVision(null, c.photos.length, c, r.text ?? '') };
  const read = normalize(parseRaw(r.text) ?? ({} as RawRead), model, r.ms);
  return {
    arm: arm.id,
    case: c.id,
    ok: read !== null,
    ms: r.ms,
    inTokens: r.inTokens,
    outTokens: r.outTokens,
    cost: costOf(arm, r),
    error: read ? undefined : 'unparseable',
    score: scoreVision(read, c.photos.length, c, r.text),
    detail: read ? { observations: read.observations.slice(0, 8) } : { observations: [r.text.slice(0, 240)] },
  };
}

/** Score the estimator on one walkthrough, with the authored site read pinned. */
export async function runScopeArm(arm: Arm, c: ScopeCase): Promise<ArmRun> {
  const input: ScopeInput = { site: c.site, notes: c.notes, jobTypeHint: c.jobTypeHint, client: c.client, photoCount: c.photoCount };
  const prompt = `${SYSTEM}\n\nWALKTHROUGH:\n${scopeReport(input)}\n\nReturn the scope JSON now.`;
  const r = await call(arm, arm.model, [
    { role: 'system', content: 'You output only minified JSON. No prose, no code fences.' },
    { role: 'user', content: prompt },
  ], arm.maxTokens, arm.where === 'device' ? 420_000 : 180_000);
  if (!r.ok || !r.text) return { arm: arm.id, case: c.id, ok: false, ms: r.ms, inTokens: r.inTokens, outTokens: r.outTokens, cost: costOf(arm, r), error: r.error ?? `HTTP ${r.status}`, score: scoreScope(null, c, r.text ?? '') };
  const parsed = ScopeDraft.safeParse(parseRaw(r.text) ?? looseJson(r.text));
  const scope = parsed.success ? normalizeScope(parsed.data, input) : null;
  return {
    arm: arm.id,
    case: c.id,
    ok: scope !== null,
    ms: r.ms,
    inTokens: r.inTokens,
    outTokens: r.outTokens,
    cost: costOf(arm, r),
    error: scope ? undefined : 'schema miss',
    score: scoreScope(scope, c, r.text),
    detail: scope
      ? { tasks: scope.tasks.map((t) => `${t.label} (${t.hours}h)`), totalHours: scope.totalHours, jobType: scope.jobType, photoRefs: scope.tasks.filter((t) => t.photo).length }
      : { tasks: [r.text.slice(0, 240)] },
  };
}

/** The deterministic floor every model is compared against — no model at all. */
export function heuristicScopeRun(c: ScopeCase): ArmRun {
  const input: ScopeInput = { site: c.site, notes: c.notes, jobTypeHint: c.jobTypeHint, client: c.client, photoCount: c.photoCount };
  const scope = heuristicScope(input);
  return { arm: 'none-heuristic', case: c.id, ok: true, ms: 0, inTokens: 0, outTokens: 0, cost: 0, score: scoreScope(scope, c), detail: { tasks: scope.tasks.map((t) => `${t.label} (${t.hours}h)`), totalHours: scope.totalHours, jobType: scope.jobType, photoRefs: 0 } };
}

/**
 * The stored run, if there is one. Read from disk rather than imported so the
 * repo keeps the raw evidence as data; when it is missing the panel says so
 * instead of showing a table nobody produced. Same rule as every other layer.
 */
export type StoredReport = {
  available: boolean;
  ranAt?: string;
  summary?: { vision: ArmSummary[]; scope: ArmSummary[] };
  runs?: ArmRun[];
  /** credential-free by type: a report is a published artifact */
  arms?: Omit<Arm, 'apiKey'>[];
  reproduce?: string;
};

export async function loadReport(): Promise<StoredReport> {
  const { readFile } = await import('node:fs/promises');
  const { resolve, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    // bundled beside the compiled agent — the only path that exists on Vercel
    resolve(here, '..', 'eval', 'results.json'),
    resolve(here, '..', '..', '..', '..', 'eval', 'results.json'),
    resolve(here, '..', '..', 'eval', 'results.json'),
    resolve(process.cwd(), 'eval', 'results.json'),
    resolve(process.cwd(), '..', '..', 'eval', 'results.json'),
  ];
  for (const p of candidates) {
    try {
      const parsed = JSON.parse(await readFile(p, 'utf8')) as {
        ranAt?: string;
        runs?: ArmRun[];
        arms?: (Omit<Arm, 'apiKey'> & { apiKey?: string })[];
        summary?: { vision?: ArmSummary[]; scope?: ArmSummary[] };
      };
      if (!parsed.runs) continue;
      return {
        available: true,
        ranAt: parsed.ranAt,
        runs: parsed.runs,
        // Stripped again on the way out: a report written by an older build
        // still sitting in eval/ must not be able to serve a key to a browser.
        arms: (parsed.arms ?? []).map(({ apiKey: _k, ...rest }) => rest),
        summary: { vision: parsed.summary?.vision ?? [], scope: parsed.summary?.scope ?? [] },
        reproduce: 'node services/agent/scripts/benchmark.mjs',
      };
    } catch {
      /* try the next candidate */
    }
  }
  return { available: false, reproduce: 'node services/agent/scripts/benchmark.mjs' };
}

export type BenchmarkReport = {
  ranAt: string;
  arms: Arm[];
  runs: ArmRun[];
};

export type ArmSummary = {
  arm: string;
  cases: number;
  answered: number;
  recall: number;
  textRecall: number;
  /** invented facts for the eyes, invented line items for the estimator */
  inventions: number;
  hoursInBand: number;
  captionCountsOk: number;
  photoRefsOk: number;
  p50ms: number;
  tokensPerCase: number;
  costPerCase: number | null;
};

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/** One honest row per arm. Vision and scope are summarised apart — they are different claims. */
export function summarise(runs: ArmRun[], kind: 'vision' | 'scope'): ArmSummary[] {
  const arms = [...new Set(runs.map((r) => r.arm))];
  return arms.map((arm) => {
    const rs = runs.filter((r) => r.arm === arm);
    const vs = rs.map((r) => r.score as VisionScore | undefined).filter((s): s is VisionScore => !!s && !('precision' in s));
    const ss = rs.map((r) => r.score as ScopeScore | undefined).filter((s): s is ScopeScore => !!s && 'precision' in s);
    const scores = kind === 'vision' ? vs : ss;
    const n = scores.length || 1;
    const priced = rs.every((r) => r.cost !== null);
    return {
      arm,
      cases: rs.length,
      answered: rs.filter((r) => r.ok).length,
      recall: scores.reduce((s, x) => s + x.recall, 0) / n,
      textRecall: scores.reduce((s, x) => s + x.textRecall, 0) / n,
      inventions: kind === 'vision' ? vs.reduce((s, x) => s + x.hallucinations.length, 0) : ss.reduce((s, x) => s + x.invented.length, 0),
      hoursInBand: kind === 'scope' ? ss.filter((x) => x.hoursOk).length / n : 1,
      captionCountsOk: kind === 'vision' ? vs.filter((x) => x.captionCountOk).length / n : 1,
      photoRefsOk: kind === 'scope' ? ss.filter((x) => x.photoRefsOk).length / n : 1,
      p50ms: median(rs.map((r) => r.ms)),
      tokensPerCase: Math.round(rs.reduce((s, r) => s + r.inTokens + r.outTokens, 0) / (rs.length || 1)),
      costPerCase: priced ? rs.reduce((s, r) => s + (r.cost ?? 0), 0) / (rs.length || 1) : null,
    };
  });
}
