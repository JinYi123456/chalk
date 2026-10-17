import { config } from '../config.js';
import { bandFromProbs, bandPrices } from './band.js';
import { dropFitted, loadFitted, saveFitted } from './memory.js';
import type { PastJob, PriceBand } from './types.js';
import type { PriceFeatures } from './pricing.js';
import { fetchWithTimeout, hashStr, money } from './util.js';

/**
 * TabPFN-3.5 through Prior Labs' REST API. This is how the *real* model runs on
 * a host that cannot hold torch: we upload the pro's history once, fit it, and
 * then predict each new job against that fitted context. Every failure returns
 * null so the caller falls back to the local service, then the heuristic.
 *
 * Flow (per https://docs.priorlabs.ai/api/rest-quickstart):
 *   prepare_train_set_upload → PUT x/y CSVs → fit(regression) + fit(classification)
 *   prepare_test_set_upload  → PUT x_test.csv → predict
 */

const BASE = process.env.TABPFN_API_BASE || 'https://api.priorlabs.ai';
const MODEL_PATH = process.env.TABPFN_MODEL_PATH || 'v3.5_default';
const COLUMNS = [
  'jobType',
  'totalHours',
  'tasks',
  'rooms',
  'complexityAvg',
  'complexityMax',
  'materialsCost',
  'accessDifficulty',
  'riskCount',
] as const;

export type CloudPrediction = {
  price: number;
  low: number;
  high: number;
  winProbability: number;
  basis: string;
  /**
   * The win-odds ladder, asked of the classifier as five candidate prices in one
   * batch — so the odds at "$558" are the model's answer for $558, not a slope
   * drawn through a single estimate. Undefined when the classifier did not
   * answer for every rung.
   */
  band?: PriceBand[];
};

export function tabpfnCloudEnabled(): boolean {
  return Boolean(config.tabpfnToken) && process.env.TABPFN_CLOUD !== '0';
}

function headers(): Record<string, string> {
  return { authorization: `Bearer ${config.tabpfnToken}`, 'content-type': 'application/json' };
}

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function xRow(f: PriceFeatures): (string | number)[] {
  return [
    f.jobType,
    f.totalHours,
    f.tasks,
    f.rooms,
    f.complexityAvg,
    f.complexityMax,
    f.materialsCost,
    f.accessDifficulty,
    f.riskCount,
  ];
}

// The classifier is fitted with the price the pro charged as a feature, which is
// what lets it answer "and at $558?" instead of only "at my recommendation?".
// The regression head must NOT see it — predicting a price from the price is
// not a prediction.
const CLF_COLUMNS = [...COLUMNS, 'price'] as const;

function clfRow(f: PriceFeatures, price: number): (string | number)[] {
  return [...xRow(f), price];
}

function toCsv(rows: (string | number)[][], header: readonly string[]): string {
  return [header.join(','), ...rows.map((r) => r.map(csvCell).join(','))].join('\n');
}

async function put(url: string, body: string, extra: Record<string, string>): Promise<boolean> {
  try {
    const res = await fetchWithTimeout(url, { method: 'PUT', headers: extra, body }, 60_000);
    return res.ok;
  } catch {
    return false;
  }
}

async function postJson<T>(path: string, body: unknown, timeoutMs = 120_000): Promise<T | null> {
  try {
    const res = await fetchWithTimeout(
      `${BASE}${path}`,
      { method: 'POST', headers: headers(), body: JSON.stringify(body) },
      timeoutMs
    );
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

type Fitted = { regressionId: string | null; classificationId: string | null; rows: number };

const fitCache = new Map<string, Fitted>();
// Boot warm-up and the first quote ask for the same fit at the same time. Two
// concurrent uploads+fit are billed twice and can land 80s apart, so the second
// caller joins the first promise instead of starting its own.
const inflightFits = new Map<string, Promise<string | null>>();
let cloudFailedUntil = 0;

function historyKey(history: PastJob[], target: 'reg' | 'clf'): string {
  const tail = history.slice(-120);
  return `${target}:${hashStr(tail.map((j) => `${j.jobType}${j.totalHours}${j.price}${j.won ? 1 : 0}`).join('|'))}`;
}

/** Upload the pro's history and fit once; reuse the fitted context across quotes. */
async function ensureFitted(history: PastJob[], target: 'reg' | 'clf'): Promise<string | null> {
  const key = historyKey(history, target);
  const cached = fitCache.get(key);
  if (cached) return target === 'reg' ? cached.regressionId : cached.classificationId;
  const running = inflightFits.get(key);
  if (running) return running;
  // A fitted context outlives the process that made it, so a cold instance can
  // go straight to predicting instead of paying for the upload and fit again.
  const durable = await loadFitted(key).catch(() => null);
  if (durable) {
    const entry = fitCache.get(key) ?? { regressionId: null, classificationId: null, rows: history.length };
    if (target === 'reg') entry.regressionId = durable;
    else entry.classificationId = durable;
    fitCache.set(key, entry);
    return durable;
  }
  const work = fitOnce(history, target, key).finally(() => inflightFits.delete(key));
  inflightFits.set(key, work);
  return work;
}

/** A fitted id that no longer predicts is dropped so the next quote re-fits. */
export async function invalidateFit(history: PastJob[], target: 'reg' | 'clf' = 'reg'): Promise<void> {
  const key = historyKey(history, target);
  fitCache.delete(key);
  await dropFitted(key).catch(() => undefined);
}

async function fitOnce(history: PastJob[], target: 'reg' | 'clf', key: string): Promise<string | null> {

  const rows = history.map((j) => ({
    jobType: j.jobType,
    totalHours: j.totalHours,
    tasks: j.tasks,
    rooms: j.rooms,
    complexityAvg: j.complexityAvg,
    complexityMax: j.complexityMax,
    materialsCost: j.materialsCost,
    accessDifficulty: j.accessDifficulty,
    riskCount: j.riskCount,
    price: j.price,
  }));
  const x = target === 'reg' ? rows.map((r) => xRow(r)) : rows.map((r) => clfRow(r, r.price));
  const xColumns = target === 'reg' ? COLUMNS : CLF_COLUMNS;
  const y = history.map((j) => (target === 'reg' ? j.price : j.won ? 1 : 0));

  const prep = await postJson<{
    train_set_upload_id: string;
    x_train_info: { signed_urls: string[]; required_headers: Record<string, string> };
    y_train_info: { signed_urls: string[]; required_headers: Record<string, string> };
  }>('/tabpfn/prepare_train_set_upload', {
    x_train_info: { format: 'csv' },
    y_train_info: { format: 'csv' },
  });
  if (!prep?.train_set_upload_id) return null;

  const okX = await put(prep.x_train_info.signed_urls[0], toCsv(x, xColumns), prep.x_train_info.required_headers);
  // The label CSV needs a header row — without it the first label is eaten as one.
  const yHeader = target === 'reg' ? 'price' : 'won';
  const okY = await put(
    prep.y_train_info.signed_urls[0],
    `${yHeader}\n${y.join('\n')}\n`,
    prep.y_train_info.required_headers
  );
  if (!okX || !okY) return null;

  const fit = await postJson<{ fitted_train_set_id: string }>(
    '/tabpfn/fit',
    {
      train_set_upload_id: prep.train_set_upload_id,
      task_config: { task: target === 'reg' ? 'regression' : 'classification', tabpfn_config: { model_path: MODEL_PATH } },
    },
    300_000
  );
  if (!fit?.fitted_train_set_id) return null;

  const entry = fitCache.get(key) ?? { regressionId: null, classificationId: null, rows: history.length };
  if (target === 'reg') entry.regressionId = fit.fitted_train_set_id;
  else entry.classificationId = fit.fitted_train_set_id;
  fitCache.set(key, entry);
  if (fitCache.size > 8) fitCache.delete(fitCache.keys().next().value as string);
  await saveFitted(key, fit.fitted_train_set_id, history.length).catch(() => undefined);
  return fit.fitted_train_set_id;
}

type PredictResult = { prediction?: unknown };

function numbers(x: unknown): number[] {
  if (!Array.isArray(x)) return [];
  return x
    .flatMap((v) => (Array.isArray(v) ? v : [v]))
    .map((v) => (typeof v === 'number' ? v : Number(v)))
    .filter((v) => Number.isFinite(v));
}

type TestPrep = {
  test_set_upload_id: string;
  x_test_info: { signed_urls: string[]; required_headers: Record<string, string> };
};

async function predictRaw(
  fittedId: string,
  xTest: string,
  task: 'regression' | 'classification'
): Promise<unknown> {
  const prep = await postJson<TestPrep>('/tabpfn/prepare_test_set_upload', {
    fitted_train_set_id: fittedId,
    x_test_info: { format: 'csv' },
  });
  if (!prep?.test_set_upload_id) return null;
  const ok = await put(prep.x_test_info.signed_urls[0], xTest, prep.x_test_info.required_headers);
  if (!ok) return null;
  const res = await postJson<PredictResult>(
    '/tabpfn/predict',
    {
      test_set_upload_id: prep.test_set_upload_id,
      fitted_train_set_id: fittedId,
      task_config:
        task === 'regression'
          ? { task, predict_params: { output_type: 'quantiles', quantiles: [0.1, 0.5, 0.9] } }
          : { task, predict_params: { output_type: 'probas' } },
    },
    25_000
  );
  return res?.prediction ?? null;
}

async function predictAgainst(
  fittedId: string,
  xTest: string,
  task: 'regression' | 'classification'
): Promise<number[]> {
  return numbers(await predictRaw(fittedId, xTest, task));
}

/**
 * Probabilities per test row, tolerant of the shapes a batch predict comes back
 * in: a row per test row, one probability per row, or flat class pairs.
 */
function probRows(prediction: unknown, rows: number): number[][] {
  if (Array.isArray(prediction) && prediction.length > 0 && Array.isArray(prediction[0])) {
    return (prediction as unknown[][]).map((r) => numbers(r));
  }
  const flat = numbers(prediction);
  if (flat.length === rows) return flat.map((v) => [v]);
  if (flat.length === rows * 2) {
    const out: number[][] = [];
    for (let i = 0; i < rows; i++) out.push([flat[2 * i], flat[2 * i + 1]]);
    return out;
  }
  return [];
}

/**
 * Ask the classifier about every rung of the ladder in ONE batch call. This is
 * the difference between "my odds at $457 are 67%" (a line drawn through a
 * single estimate) and "my odds at $457 are 67%, and at $558 they are 35%"
 * (five answers from the same fit that priced the job).
 */
async function predictBand(fittedId: string, f: PriceFeatures, price: number): Promise<PriceBand[] | null> {
  const prices = bandPrices(price);
  const xTest = toCsv(
    prices.map((p) => clfRow(f, p)),
    CLF_COLUMNS
  );
  const rows = probRows(await predictRaw(fittedId, xTest, 'classification'), prices.length);
  if (rows.length !== prices.length) return null;
  // y was 1/0 for won/lost, so the class-1 probability is the last one in the row.
  const probs = rows.map((r) => (r.length >= 2 ? r[r.length - 1] : r[0]));
  return bandFromProbs(price, probs);
}

/**
 * Fit both heads once so the first real quote does not pay for the upload.
 * Called in the background at boot; safe to ignore.
 */
export async function warmTabpfnCloud(history: PastJob[]): Promise<void> {
  if (!tabpfnCloudEnabled() || history.length < 6) return;
  await Promise.all([ensureFitted(history, 'reg'), ensureFitted(history, 'clf')]).catch(() => null);
}

/**
 * Same features against the same fitted history is the same answer, and the
 * round trip to the API is the slowest part of a quote. Remember it briefly.
 */
const predictCache = new Map<string, { at: number; value: CloudPrediction }>();
const PREDICT_TTL = 15 * 60_000;

function predictKey(features: PriceFeatures, history: PastJob[]): string {
  return `${historyKey(history, 'reg')}:${hashStr(Object.values(features).join('|'))}`;
}

/** Ask the hosted TabPFN for a price, a range, and the odds this client says yes. */
export async function tabpfnCloudPredict(features: PriceFeatures, history: PastJob[]): Promise<CloudPrediction | null> {
  if (!tabpfnCloudEnabled() || history.length < 6) return null;
  if (Date.now() < cloudFailedUntil) return null;

  const key = predictKey(features, history);
  const hit = predictCache.get(key);
  if (hit && Date.now() - hit.at < PREDICT_TTL) return hit.value;

  const [regressionId, classificationId] = await Promise.all([
    ensureFitted(history, 'reg'),
    ensureFitted(history, 'clf'),
  ]);
  if (!regressionId) {
    cloudFailedUntil = Date.now() + 5 * 60_000; // never retry-storm a bad token
    return null;
  }

  const xTest = toCsv([xRow(features)], COLUMNS);
  const qs = await predictAgainst(regressionId, xTest, 'regression');
  if (qs.length < 2) {
    // A fitted id loaded from a previous instance may have expired on their
    // side. Drop it so the next quote fits again instead of failing forever.
    await invalidateFit(history, 'reg');
    return null;
  }
  const price = money(qs.length >= 3 ? qs[1] : (qs[0] + qs[qs.length - 1]) / 2);
  const low = money(Math.min(qs[0], price));
  const high = money(Math.max(qs[qs.length - 1], price));

  // The ladder needs the price first, so this is the one place the two heads
  // cannot run together: quantiles → recommended price → five candidate prices.
  const band = classificationId ? await predictBand(classificationId, features, price).catch(() => null) : null;
  const win = band ? band[2].win : 0.6;

  const value: CloudPrediction = {
    price,
    low,
    high,
    winProbability: Math.round(win * 100) / 100,
    // Whether the ladder is usable is a judgement about the data, so the caller
    // makes it — see usableBand(). This string only claims what it knows.
    basis: `TabPFN-3.5 (hosted, in-context over ${history.length} of your past jobs)`,
    band: band ?? undefined,
  };
  predictCache.set(key, { at: Date.now(), value });
  if (predictCache.size > 32) predictCache.delete(predictCache.keys().next().value as string);
  return value;
}
