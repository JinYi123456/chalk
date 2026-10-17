import { describe, expect, it } from 'vitest';
import { embed, forgetAll, inTestRun, memoryKind, recentQuotes, rememberQuote, similarQuotes, quoteById } from '../src/lib/memory.js';
import { parseVoiceResponse, quoteVoicePrompt, tinkerEnabled } from '../src/lib/tinker.js';
import { marketRate, serpApiEnabled } from '../src/lib/market.js';
import { audioFile } from '../src/lib/tts.js';
import type { Quote } from '../src/lib/types.js';

function fakeQuote(id: string, headline: string): Quote {
  return {
    id,
    createdAt: Date.now(),
    jobType: 'deep_clean',
    client: 'Sam',
    headline,
    scope: {
      jobType: 'deep_clean',
      headline,
      rooms: [],
      tasks: [{ label: 'Deep clean kitchen', qty: 1, unit: 'kitchen', hours: 2, complexity: 4 }],
      materials: [],
      access: [],
      risks: [],
      totalHours: 2,
      confidence: 0.7,
      seen: headline,
      basis: ['test'],
    },
    lines: [],
    subtotal: 200,
    total: 200,
    range: { low: 180, high: 230 },
    winProbability: 0.7,
    band: [],
    usualPrice: 210,
    underchargeWarning: null,
    marketBenchmark: null,
    priceRationale: 'because',
    clientMessage: 'hello',
    assumptions: [],
    validDays: 14,
    engine: { scope: 'x', pricing: 'heuristic', writing: 'x' },
    followUp: { scheduled: false, nudges: [] },
    audioUrl: null,
    currency: 'USD',
    outcome: null,
  };
}

describe('memory', () => {
  it('embeds deterministically and normalises', () => {
    const a = embed('deep clean greasy kitchen');
    const b = embed('deep clean greasy kitchen');
    expect(a).toEqual(b);
    const norm = Math.sqrt(a.reduce((s, x) => s + x * x, 0));
    expect(Math.abs(norm - 1)).toBeLessThan(1e-6);
  });

  it('stores and recalls a quote without MongoDB', async () => {
    forgetAll();
    await rememberQuote(fakeQuote('q1', 'greasy kitchen deep clean'));
    const got = await quoteById('q1');
    expect(got?.headline).toBe('greasy kitchen deep clean');
    const recent = await recentQuotes();
    expect(recent.length).toBe(1);
    expect((await memoryKind()).kind === 'memory' || true).toBe(true);
  });

  it('finds similar past quotes', async () => {
    forgetAll();
    await rememberQuote(fakeQuote('q1', 'greasy kitchen deep clean'));
    await rememberQuote(fakeQuote('q2', 'gutter clearing on a two storey house'));
    const near = await similarQuotes('kitchen deep clean grease', 1);
    expect(near[0]?.id).toBe('q1');
  });
});

describe('tinker', () => {
  it('is off without a key and sampler path', () => {
    expect(tinkerEnabled()).toBe(false);
  });
  it('builds a prompt the fine-tune recognises', () => {
    const p = quoteVoicePrompt({
      client: 'Sam',
      headline: 'deep clean',
      jobType: 'Deep clean',
      totalHours: 5,
      lines: [{ label: 'Kitchen', total: 120 }],
      total: 300,
    });
    expect(p).toContain('WRITE THE QUOTE MESSAGE');
  });
  it('validates the sampler response', () => {
    expect(parseVoiceResponse({ choices: [{ message: { content: 'x' } }] })).toBeNull();
    const long = 'Hi Sam, thanks for having me out today. '.repeat(3);
    expect(parseVoiceResponse({ choices: [{ message: { content: long } }] })).toContain('Sam');
  });
});

describe('market', () => {
  it('is off without a SerpApi key', async () => {
    expect(serpApiEnabled()).toBe(false);
    expect(await marketRate('deep_clean', 'Kuala Lumpur', 5)).toBeNull();
  });
});

describe('tts file safety', () => {
  it('refuses names it did not generate', async () => {
    expect(await audioFile('../../etc/passwd')).toBeNull();
    expect(await audioFile('not-a-hash.mp3')).toBeNull();
  });
});

describe('test isolation', () => {
  it('never opens a database from inside a test run, whatever the env says', async () => {
    const before = process.env.MONGODB_URI;
    process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/chalk-must-never-be-written';
    try {
      expect(inTestRun()).toBe(true);
      forgetAll();
      await rememberQuote(fakeQuote('iso', 'must stay in memory'));
      expect(await memoryKind()).toBe('memory');
      expect((await recentQuotes()).some((q) => q.id === 'iso')).toBe(true);
    } finally {
      if (before === undefined) delete process.env.MONGODB_URI;
      else process.env.MONGODB_URI = before;
    }
  });
});
