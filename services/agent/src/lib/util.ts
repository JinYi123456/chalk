import { createHash } from 'node:crypto';

export function sha1(s: string): string {
  return createHash('sha1').update(s).digest('hex');
}

export async function fetchWithTimeout(url: string, init: RequestInit = {}, ms = 8000): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(ms) });
}

function extract(text: string): string | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  return candidate.slice(start, end + 1);
}

/** Drop model narration: closed blocks, then any unclosed trailing block. */
export function stripThinking(text: string): string {
  return text
    .replace(/<(?:thought|thinking|reasoning)>[\s\S]*?<\/(?:thought|thinking|reasoning)>/gi, '')
    .replace(/<\/?(?:thought|thinking|reasoning)>[\s\S]*$/i, '');
}

/** Parse JSON from a small model that may wrap it in prose or code fences. */
export function looseJson<T = unknown>(text: string): T | null {
  if (!text) return null;
  const stripped = stripThinking(text);
  for (const candidate of stripped === text ? [text] : [stripped, text]) {
    const json = extract(candidate);
    if (!json) continue;
    try {
      return JSON.parse(json) as T;
    } catch {
      continue;
    }
  }
  return null;
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/** Round money to the nearest whole unit, never below 1. */
export function money(n: number): number {
  const v = Number.isFinite(n) ? n : 0;
  return Math.max(1, Math.round(v));
}

export function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Deterministic 32-bit rng — same seed, same result. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Stable JSON — key order independent, used for hashing identical inputs. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

/**
 * The writer model likes to invent a validity window (it said seven days on a
 * quote that expires in fourteen). The quote has exactly one truth, so any
 * stated window in the client's message is rewritten to it.
 */
export function fixValidity(message: string, validDays: number): string {
  return message.replace(
    /\b((?:valid|good|holds?|expires?|expiring)(?:\s+(?:for|until|through|in))?\s*)(\d+)(\s*days?)/gi,
    `$1${validDays}$3`
  );
}

export function titleCase(s: string): string {
  return s
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');
}
