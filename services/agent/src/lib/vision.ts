import { config, llmEndpoints, type LlmEndpoint } from '../config.js';
import { withSpan } from './sentry.js';
import { fetchWithTimeout, stripThinking } from './util.js';

export type SiteRead = {
  /** one line describing what is actually visible */
  seen: string;
  /** observable facts the quote can lean on */
  observations: string[];
  /** rough sizes / quantities the photos imply, in plain words */
  measures: string[];
  /** condition and access notes that change the price */
  conditions: string[];
  /** one line per photo, in order — the caption the client sees on the quote */
  captions: string[];
  engine: string;
  ms: number;
};

export type RawRead = {
  seen?: string;
  observations?: string[];
  measures?: string[];
  conditions?: string[];
  captions?: string[];
};

let _visionWinner: LlmEndpoint | null = null;

const STRICT_JSON =
  'Answer with ONLY minified JSON, no prose, no code fences: ' +
  '{"seen":"one line, what is actually visible","observations":["..."],"measures":["..."],"conditions":["..."],"captions":["..."]}';

/** The exact prompt a quote sends — exported so the benchmark cannot drift from it. */
export function buildPrompt(jobType: string, notes: string, photoCount: number): string {
  return [
    'You are Chalk, reading a home-service job site from photos so a pro can price it fairly.',
    `The pro says this job is: ${jobType || 'a home-service job'}.`,
    notes ? `The pro's own words about the job: "${notes}"` : 'The pro gave no words — read only the photos.',
    `You are looking at ${photoCount} photo${photoCount === 1 ? '' : 's'} of the site.`,
    'Report only what you can actually see. Never invent a size you cannot gauge.',
    'observations: 3-6 short noun phrases naming real visible things and surfaces (e.g. "tiled kitchen floor", "double-hung windows", "pet hair on sofa").',
    'measures: 0-4 rough quantities the photos imply, hedged honestly (e.g. "2 small rooms", "approx 8 windows", "one flight of stairs").',
    'conditions: 0-4 price-changing conditions (e.g. "heavy grease", "carpet stains", "no parking nearby", "third-floor walk-up").',
    `captions: exactly ${photoCount} short captions, one per photo IN ORDER, each naming the room and the one thing that matters for price (e.g. "kitchen: greasy hob, tiled splashback"). The pro sends these to the client as evidence, so write only what the photo shows.`,
    STRICT_JSON,
  ].join('\n');
}

export function normalize(raw: RawRead, engine: string, ms: number): SiteRead | null {
  const seen = (raw.seen ?? '').toString().trim();
  if (!seen) return null;
  const clean = (a: unknown): string[] => (Array.isArray(a) ? a.map((x) => String(x).trim()).filter(Boolean).slice(0, 8) : []);
  return {
    seen: seen.slice(0, 200),
    observations: clean(raw.observations),
    measures: clean(raw.measures),
    conditions: clean(raw.conditions),
    captions: clean(raw.captions).map((c) => c.slice(0, 120)),
    engine,
    ms,
  };
}

/** One image call to one endpoint; a raw Response lets probes report why it failed. */
export async function visionAttempt(
  p: Pick<LlmEndpoint, 'baseURL' | 'apiKey'>,
  model: string,
  images: string[],
  prompt: string,
  timeoutMs = 150_000
): Promise<Response | null> {
  try {
    return await fetchWithTimeout(
      `${p.baseURL.replace(/\/$/, '')}/chat/completions`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(p.apiKey ? { authorization: `Bearer ${p.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model,
          temperature: 0.2,
          // Thinking models narrate before they answer — leave room for both.
          max_tokens: 3200,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: prompt },
                ...images.slice(0, 4).map((url) => ({ type: 'image_url', image_url: { url } })),
              ],
            },
          ],
        }),
      },
      timeoutMs
    );
  } catch {
    return null;
  }
}

async function readVia(p: LlmEndpoint, images: string[], jobType: string, notes: string): Promise<SiteRead | null> {
  const prompt = buildPrompt(jobType, notes, images.length);
  const candidates = [p.visionModel, p.model, config.visionModel, process.env.CHALK_VISION_MODEL_COMPAT]
    .filter((m): m is string => Boolean(m))
    .filter((m, i, a) => a.indexOf(m) === i);
  const t0 = performance.now();
  for (const model of candidates) {
    const res = await visionAttempt(p, model, images, prompt);
    if (!res || !res.ok) continue;
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const text = stripThinking(data.choices?.[0]?.message?.content ?? '');
    const start = text.indexOf('{');
    if (start === -1) continue;
    try {
      const raw = JSON.parse(text.slice(start, text.lastIndexOf('}') + 1)) as RawRead;
      const read = normalize(raw, `${model} · ${p.name} (hosted, open weights)`, Math.round(performance.now() - t0));
      if (read) {
        _visionWinner = p;
        return read;
      }
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Read a site from photos, walking the endpoint chain. Returns null when no
 * vision-capable model can be reached — the caller then quotes from the pro's
 * words alone, and says so.
 */
export async function readSite(images: string[], jobType: string, notes: string): Promise<SiteRead | null> {
  if (images.length === 0) return null;
  const all = llmEndpoints().filter((p) => p.vision);
  // The endpoint that read the last photo first — but never let a vision model
  // hijack the text chain, so this stays local to vision.
  const chain = _visionWinner ? [_visionWinner, ...all.filter((p) => p !== _visionWinner)] : all;
  return withSpan(
    'site.read',
    'gen_ai.chat',
    async () => {
      for (const p of chain) {
        const read = await readVia(p, images, jobType, notes);
        if (read) return read;
      }
      return null;
    },
    { 'gen_ai.system': chain[0]?.name ?? 'none', 'gen_ai.request.model': chain[0]?.model ?? 'none', 'chalk.photos': images.length }
  );
}
