import { MongoClient, type Collection, type Db } from 'mongodb';
import { config } from '../config.js';
import type { Quote } from './types.js';
import { sha1 } from './util.js';

type QuoteDoc = Quote & { embedding?: number[] };

let client: MongoClient | null = null;
let db: Db | null = null;
let connectFailed = false;

/**
 * A test run must never reach a real database, however it was invoked — one
 * `vitest` call that skipped the setup file once wrote fixture quotes into the
 * live Atlas project, and those rows showed up in the app's job history.
 */
export function inTestRun(): boolean {
  return process.env.VITEST === 'true' || process.env.NODE_ENV === 'test';
}

async function collection(): Promise<Collection<QuoteDoc> | null> {
  if (inTestRun() || !config.mongoUri || connectFailed) return null;
  if (db) return db.collection<QuoteDoc>('quotes');
  try {
    client = new MongoClient(config.mongoUri, { serverSelectionTimeoutMS: 4000 });
    await client.connect();
    db = client.db(config.mongoDb);
    return db.collection<QuoteDoc>('quotes');
  } catch {
    connectFailed = true;
    return null;
  }
}

const ram = new Map<string, QuoteDoc>();

export async function memoryKind(): Promise<'mongodb' | 'memory'> {
  return (await collection()) ? 'mongodb' : 'memory';
}

/** Tiny deterministic bag-of-words embedding — $vectorSearch when Atlas is on, still useful otherwise. */
export function embed(text: string, dims = 64): number[] {
  const v = new Array(dims).fill(0);
  for (const word of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
    const h = parseInt(sha1(word).slice(0, 8), 16);
    v[h % dims] += 1;
  }
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / norm);
}

export async function rememberQuote(quote: Quote): Promise<void> {
  const text = `${quote.headline} ${quote.scope.seen} ${quote.scope.tasks.map((t) => t.label).join(' ')}`;
  const doc: QuoteDoc = { ...quote, embedding: embed(text) };
  const col = await collection();
  if (!col) {
    ram.set(quote.id, doc);
    return;
  }
  try {
    await col.updateOne({ id: quote.id }, { $set: doc }, { upsert: true });
  } catch {
    ram.set(quote.id, doc);
  }
}

// Photos are the heaviest thing on a quote and only two screens need them: the
// pro's open quote and the client's link. Lists never carry them.
const LIGHT_PROJECTION = { embedding: 0, photos: 0, photoCaptions: 0 } as const;

export async function recentQuotes(limit = 12): Promise<Quote[]> {
  const col = await collection();
  if (!col) {
    return [...ram.values()]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit)
      .map(({ photos, photoCaptions, ...rest }) => rest as Quote);
  }
  try {
    const rows = await col.find({}, { projection: LIGHT_PROJECTION }).sort({ createdAt: -1 }).limit(limit).toArray();
    return rows.map(({ _id, embedding, ...q }) => q as Quote);
  } catch {
    return [...ram.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
  }
}

/** Closest past quotes to a free-text query — real memory, not a list. */
export async function similarQuotes(query: string, limit = 5): Promise<Quote[]> {
  const q = embed(query);
  const col = await collection();
  const rows = (col
    ? await col.find({}, { projection: LIGHT_PROJECTION }).limit(200).toArray().catch(() => [...ram.values()])
    : [...ram.values()]) as QuoteDoc[];
  if (rows.length === 0) return [];
  const cos = (a: number[] | undefined, b: number[]): number => {
    if (!a) return 0;
    let s = 0;
    for (let i = 0; i < Math.min(a.length, b.length); i++) s += a[i] * b[i];
    return s;
  };
  return rows
    .map((r) => ({ r, s: cos(r.embedding, q) }))
    .sort((x, y) => y.s - x.s)
    .slice(0, limit)
    .map(({ r }) => {
      const rest: Record<string, unknown> = { ...r };
      delete rest.embedding;
      delete rest._id;
      return rest as unknown as Quote;
    });
}

export async function quoteById(id: string): Promise<Quote | null> {
  const col = await collection();
  if (!col) return (ram.get(id) as Quote) ?? null;
  // The detail read keeps the photos: the pro's quote view and the client's
  // link both need them.
  const row = await col.findOne({ id }, { projection: { embedding: 0 } }).catch(() => null);
  return row ? (row as unknown as Quote) : null;
}

export async function memoryStatus(): Promise<{ kind: 'mongodb' | 'memory'; count: number }> {
  const col = await collection();
  const count = col ? await col.estimatedDocumentCount().catch(() => ram.size) : ram.size;
  return { kind: col ? 'mongodb' : 'memory', count };
}

export function forgetAll(): void {
  ram.clear();
}
