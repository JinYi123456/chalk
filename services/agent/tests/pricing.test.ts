import { describe, expect, it } from 'vitest';
import { canonicalJobType, seedHistory } from '../src/lib/history.js';
import { accessScore, bandFromProbs, features, heuristicPricing, priceBand, saneRange, underchargeWarning, usableBand, usualPrice } from '../src/lib/pricing.js';
import { buildLines, sumLines } from '../src/lib/lines.js';
import { heuristicScope, normalizeScope, ScopeDraft } from '../src/lib/scope.js';
import { looseJson } from '../src/lib/util.js';
import type { JobScope } from '../src/lib/types.js';

const scope: JobScope = {
  jobType: 'deep_clean',
  headline: '3-bed deep clean',
  rooms: [{ name: 'kitchen', condition: 'greasy' }],
  tasks: [
    { label: 'Deep clean kitchen', qty: 1, unit: 'kitchen', hours: 2.5, complexity: 4 },
    { label: 'Clean bathrooms', qty: 2, unit: 'bath', hours: 1.5, complexity: 3 },
    { label: 'Floors and dusting', qty: 3, unit: 'room', hours: 2, complexity: 2 },
  ],
  materials: [{ label: 'Supplies', cost: 18 }],
  access: ['third-floor walk-up'],
  risks: ['grease'],
  totalHours: 6,
  confidence: 0.8,
  seen: 'a greasy kitchen and two bathrooms',
  basis: ['pro notes'],
};

describe('canonicalJobType', () => {
  it('maps phrases to slugs', () => {
    expect(canonicalJobType('end of lease clean')).toBe('move_out_clean');
    expect(canonicalJobType('gutter clearing')).toBe('gutter_clear');
    expect(canonicalJobType('assemble a wardrobe')).toBe('handyman_medium');
    expect(canonicalJobType('')).toBe('standard_clean');
  });
});

describe('seedHistory', () => {
  it('is deterministic', () => {
    expect(seedHistory()).toEqual(seedHistory());
    expect(seedHistory().length).toBe(42);
  });
  it('every job is priced and typed', () => {
    for (const j of seedHistory()) {
      expect(j.price).toBeGreaterThan(0);
      expect(j.totalHours).toBeGreaterThan(0);
    }
  });
});

describe('features / accessScore', () => {
  it('reads access difficulty', () => {
    expect(accessScore([])).toBe(0);
    expect(accessScore(['third-floor walk-up'])).toBe(2);
    expect(accessScore(['no parking nearby'])).toBe(1);
    expect(accessScore(['third-floor walk-up', 'no parking nearby'])).toBe(3);
  });
  it('extracts numeric features', () => {
    const f = features(scope);
    expect(f.totalHours).toBe(6);
    expect(f.tasks).toBe(3);
    expect(f.materialsCost).toBe(18);
    expect(f.complexityMax).toBe(4);
  });
});

describe('priceBand', () => {
  it('is a rising ladder with falling odds', () => {
    const band = priceBand(300, 0.7);
    const prices = band.map((b) => b.at);
    expect(prices).toEqual([...prices].sort((a, b) => a - b));
    const wins = band.map((b) => b.win);
    expect(wins).toEqual([...wins].sort((a, b) => b - a));
  });
});

describe('heuristicPricing', () => {
  const history = seedHistory();
  it('prices a job inside a sane band', () => {
    const out = heuristicPricing(features(scope), history);
    expect(out.price).toBeGreaterThan(50);
    expect(out.price).toBeLessThan(1500);
    expect(out.low).toBeLessThan(out.price);
    expect(out.high).toBeGreaterThan(out.price);
    expect(out.served).toBe('heuristic');
  });
  it('knows the pro\u2019s usual price for the trade', () => {
    const u = usualPrice(scope, history);
    expect(u).not.toBeNull();
    expect(u!).toBeGreaterThan(0);
  });
  it('flags a quote below the pro\u2019s own average', () => {
    const warning = underchargeWarning(80, 260, scope);
    expect(warning).toBeTruthy();
    expect(underchargeWarning(255, 260, scope)).toBeNull();
  });
});

describe('buildLines', () => {
  it('sums exactly to the total', () => {
    const lines = buildLines(scope, 317, 18);
    expect(sumLines(lines)).toBe(317);
  });
  it('always includes the materials line when there are materials', () => {
    const lines = buildLines(scope, 300, 18);
    expect(lines.some((l) => l.kind === 'materials')).toBe(true);
  });
  it('handles a zero-material job', () => {
    const noMat: JobScope = { ...scope, materials: [] };
    const lines = buildLines(noMat, 200, 0);
    expect(sumLines(lines)).toBe(200);
  });
});

describe('heuristicScope', () => {
  it('produces a priced scope from words alone, without a model', () => {
    const s = heuristicScope({ site: null, notes: 'deep clean a 3 bed house, very greasy kitchen' });
    expect(s.tasks.length).toBeGreaterThan(0);
    expect(s.totalHours).toBeGreaterThan(0);
    expect(s.jobType).toBe('deep_clean');
    expect(s.basis.join(' ')).toMatch(/no model/);
  });
});

describe('saneRange', () => {
  const history = seedHistory();
  const f = features(scope);

  it('pulls a nonsense model interval back to something a pro would say out loud', () => {
    // The hosted model returned $53–$744 on a $400 job over a mixed ledger.
    const r = saneRange(400, 53, 744, f, history);
    expect(r.low).toBeGreaterThan(150);
    expect(r.high).toBeLessThan(700);
  });

  it('never returns a band that excludes the price it belongs to', () => {
    for (const [low, high] of [[50, 100], [900, 1200], [380, 420], [400, 400]]) {
      const r = saneRange(400, low, high, f, history);
      expect(r.low).toBeLessThan(400);
      expect(r.high).toBeGreaterThan(400);
      expect(r.low).toBeGreaterThanOrEqual(Math.round(400 * 0.55) - 1);
      expect(r.high).toBeLessThanOrEqual(Math.round(400 * 1.6) + 1);
    }
  });

  it('leaves a credible model band alone', () => {
    expect(saneRange(400, 350, 460, f, history)).toEqual({ low: 350, high: 460 });
  });
});

describe('walkthrough photo evidence', () => {
  it('carries the task photo onto the line item it justifies, and leaves the rest alone', () => {
    const withPhoto: JobScope = {
      ...scope,
      tasks: [{ ...scope.tasks[0], photo: 2 }, scope.tasks[1], scope.tasks[2]],
    };
    const lines = buildLines(withPhoto, 400, 18);
    expect(lines[0].photo).toBe(2);
    expect(lines[1].photo).toBeUndefined();
    expect(lines.filter((l) => l.kind === 'materials')[0]?.photo).toBeUndefined();
  });

  it('drops a photo index the pro never took instead of pointing at nothing', () => {
    const draft = {
      jobType: 'deep_clean',
      headline: 'kitchen deep clean',
      rooms: [],
      tasks: [{ label: 'Degrease kitchen', qty: 1, unit: 'kitchen', hours: 2, complexity: 4, photo: 2 }],
      materials: [],
      access: [],
      risks: [],
      confidence: 0.6,
    };
    const one = normalizeScope(draft, { site: null, notes: '', photoCount: 1 });
    expect(one.tasks[0].photo).toBeUndefined();
    const two = normalizeScope(draft, { site: null, notes: '', photoCount: 2 });
    expect(two.tasks[0].photo).toBe(2);
  });

  it('keeps a scope whose nulls say "no photo shows this", the way the model actually answers', () => {
    // Verbatim shape of a Qwen3-30B-A3B reply on the deployed build: a perfect
    // scope with "photo": null on every task. The schema asked for an omitted
    // key; the model answered null instead, and the whole answer was discarded
    // for a three-line deterministic estimate.
    const reply =
      '{"jobType":"move_out_clean","headline":"End-of-lease deep clean","rooms":[{"name":"Kitchen","condition":"tiles need scrubbing"}],' +
      '"tasks":[{"label":"Scrub kitchen floor tiles","qty":1,"unit":"area","hours":2.5,"complexity":3,"photo":null},' +
      '{"label":"Clean oven interior and exterior","qty":1,"unit":"unit","hours":2,"complexity":4,"photo":null}],' +
      '"materials":[{"label":"Degreaser","cost":12}],"access":["Stairs only, no lift"],"risks":[],"confidence":0.9}';
    const parsed = ScopeDraft.safeParse(looseJson(reply));
    expect(parsed.success).toBe(true);
    const scoped = normalizeScope(parsed.success ? parsed.data : null!, { site: null, notes: '', photoCount: 0 });
    expect(scoped.tasks).toHaveLength(2);
    expect(scoped.tasks.every((t) => t.photo === undefined)).toBe(true);
    expect(scoped.totalHours).toBe(4.5);
  });
});

describe('bandFromProbs (the classifier’s own ladder)', () => {
  it('maps one probability per candidate price, recommendation in the middle', () => {
    const band = bandFromProbs(400, [0.91, 0.78, 0.67, 0.53, 0.35]);
    expect(band).not.toBeNull();
    expect(band!.map((b) => b.at)).toEqual([340, 380, 400, 440, 488]);
    expect(band![2]).toEqual({ label: 'Recommended', at: 400, win: 0.67 });
    expect(band![0].win).toBe(0.91);
    expect(band![4].win).toBe(0.35);
  });

  it('refuses a half-filled ladder rather than inventing the missing rungs', () => {
    expect(bandFromProbs(400, [0.9, 0.8, 0.7])).toBeNull();
    expect(bandFromProbs(400, [])).toBeNull();
  });

  it('clamps nonsense probabilities into a range a person could act on', () => {
    const band = bandFromProbs(400, [1.4, 0.5, -0.2, 0.5, 0.5])!;
    expect(band[0].win).toBe(0.98);
    expect(band[2].win).toBe(0.02);
  });
});

describe('usableBand (should the model’s ladder be shown?)', () => {
  it('rejects the flat ladder the classifier actually produced on 42 jobs', () => {
    // Measured: 66 · 67 · 67 · 65 · 67 % across 219→315. Real answer, useless card.
    const flat = [
      { label: 'Win the job', at: 219, win: 0.66 },
      { label: 'Fair', at: 245, win: 0.67 },
      { label: 'Recommended', at: 258, win: 0.67 },
      { label: 'Strong', at: 284, win: 0.65 },
      { label: 'Max', at: 315, win: 0.67 },
    ];
    expect(usableBand(flat)).toBe(false);
  });

  it('accepts a ladder that slopes, and tolerates classifier jitter', () => {
    const good = [
      { label: 'Win the job', at: 340, win: 0.88 },
      { label: 'Fair', at: 380, win: 0.79 },
      { label: 'Recommended', at: 400, win: 0.7 },
      { label: 'Strong', at: 440, win: 0.55 },
      { label: 'Max', at: 488, win: 0.38 },
    ];
    expect(usableBand(good)).toBe(true);
    const jittery = good.map((b, i) => (i === 2 ? { ...b, win: 0.76 } : b));
    expect(usableBand(jittery)).toBe(true);
    const backwards = good.map((b, i) => (i === 4 ? { ...b, win: 0.95 } : b));
    expect(usableBand(backwards)).toBe(false);
  });

  it('rejects a missing or half-built ladder', () => {
    expect(usableBand(undefined)).toBe(false);
    expect(usableBand([])).toBe(false);
    expect(usableBand([{ label: 'Max', at: 400, win: 0.4 }])).toBe(false);
  });
});
