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

/* ── willingness to pay ──────────────────────────────────────────────────
   The theme asks whether a real person would pay for this. An answer in a
   paragraph is a claim; an answer in a row is a countable thing. Both are
   kept — the note is the evidence, the tally is the headline. */

export type FeedbackDoc = {
  id: string;
  at: number;
  trade: string;
  country: string;
  wouldPay: 'yes' | 'no' | 'maybe';
  price: number | null;
  note: string;
  /** the quote they were looking at, when they came from one */
  quoteId: string | null;
};

let feedbackCol: Collection<FeedbackDoc> | null = null;
const ramFeedback: FeedbackDoc[] = [];

async function feedbackCollection(): Promise<Collection<FeedbackDoc> | null> {
  if (inTestRun() || !config.mongoUri || connectFailed) return null;
  if (feedbackCol) return feedbackCol;
  const base = await collection();
  if (!base) return null;
  feedbackCol = db!.collection<FeedbackDoc>('feedback');
  return feedbackCol;
}

export async function recordFeedback(doc: FeedbackDoc): Promise<void> {
  const col = await feedbackCollection();
  if (!col) {
    ramFeedback.push(doc);
    return;
  }
  try {
    await col.updateOne({ id: doc.id }, { $set: doc }, { upsert: true });
  } catch {
    ramFeedback.push(doc);
  }
}

export type FeedbackStats = {
  total: number;
  yes: number;
  no: number;
  maybe: number;
  /** the lowest price a person volunteered, which is the one worth reporting */
  prices: number[];
  notes: { at: number; trade: string; wouldPay: string; price: number | null; note: string }[];
  stored: 'mongodb' | 'memory';
};

export async function feedbackStats(): Promise<FeedbackStats> {
  const col = await feedbackCollection();
  let rows: FeedbackDoc[] = [];
  if (col) {
    rows = (await col.find({}, { projection: { _id: 0 } }).sort({ at: -1 }).limit(200).toArray().catch(() => ramFeedback)) as FeedbackDoc[];
  } else {
    rows = [...ramFeedback].sort((a, b) => b.at - a.at);
  }
  return {
    total: rows.length,
    yes: rows.filter((r) => r.wouldPay === 'yes').length,
    no: rows.filter((r) => r.wouldPay === 'no').length,
    maybe: rows.filter((r) => r.wouldPay === 'maybe').length,
    prices: rows.map((r) => r.price).filter((p): p is number => typeof p === 'number' && p > 0),
    notes: rows.map((r) => ({ at: r.at, trade: r.trade, wouldPay: r.wouldPay, price: r.price, note: r.note })),
    stored: col ? 'mongodb' : 'memory',
  };
}

/* ── durable fitted contexts ───────────────────────────────────────────
   Uploading the ledger and fitting it is the expensive half of a hosted
   TabPFN call, and Prior Labs hands back a reusable fitted_train_set_id.
   Keeping only the in-process copy meant every cold serverless instance paid
   that bill again, so the first quote of the day was the slow one forever. */

export type FittedDoc = { key: string; fittedId: string; rows: number; at: number };

async function fittedCollection(): Promise<Collection<FittedDoc> | null> {
  if (inTestRun() || !config.mongoUri || connectFailed) return null;
  const base = await collection();
  return base ? db!.collection<FittedDoc>('tabpfn_fits') : null;
}

export async function loadFitted(key: string): Promise<string | null> {
  const col = await fittedCollection();
  if (!col) return null;
  const row = await col.findOne({ key }, { projection: { _id: 0 } }).catch(() => null);
  return row?.fittedId ?? null;
}

export async function saveFitted(key: string, fittedId: string, rows: number): Promise<void> {
  const col = await fittedCollection();
  if (!col) return;
  await col
    .updateOne({ key }, { $set: { key, fittedId, rows, at: Date.now() } }, { upsert: true })
    .catch(() => undefined);
}

/** A fitted id that stops working is dropped, not retried forever. */
export async function dropFitted(key: string): Promise<void> {
  const col = await fittedCollection();
  if (!col) return;
  await col.deleteOne({ key }).catch(() => undefined);
}
