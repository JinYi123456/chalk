import { describe, expect, it } from 'vitest';
import { clientQuoteView } from '../src/lib/visibility.js';

const proQuote = {
  id: 'q1',
  client: 'Mrs. Adeyemi',
  headline: 'End-of-lease clean, two bedroom terrace',
  jobType: 'move_out_clean',
  currency: 'USD',
  total: 318,
  range: { low: 254, high: 394 },
  validDays: 7,
  outcome: 'sent',
  clientMessage: 'Hi — here is the quote for the flat…',
  assumptions: ['Carpets are accessible and not glued down'],
  photos: ['data:image/jpeg;base64,…'],
  photoCaptions: ['kitchen: greasy hob, tiled splashback'],
  lines: [
    { label: 'Scrub kitchen floor tiles', detail: '1.5h · complexity 4/5', qty: 1, unit: 'area', hours: 1.5, complexity: 4, total: 74, photo: 1 },
    { label: 'Materials and consumables', kind: 'materials', total: 26 },
  ],
  // everything below is the pro's side of the desk
  winProbability: 0.67,
  band: [{ label: 'Fair', at: 221, win: 0.81 }],
  bandSource: 'drawn',
  usualPrice: 421,
  underchargeWarning: { amount: 103 },
  marketBenchmark: { low: 863, high: 1438 },
  engine: { pricing: 'model · TabPFN-3.5' },
  timings: { total: 24729 },
  followUpLive: { status: 'running' },
};

describe('clientQuoteView (what a stranger holding the link can read)', () => {
  it('carries the work, the price, the assumptions and the photographs', () => {
    const view = clientQuoteView(proQuote);
    expect(view.client).toBe('Mrs. Adeyemi');
    expect(view.total).toBe(318);
    expect(view.clientMessage).toContain('here is the quote');
    expect(view.assumptions).toHaveLength(1);
    expect(view.photos).toHaveLength(1);
    expect(view.photoCaptions).toHaveLength(1);
    expect(view.lines).toHaveLength(2);
    expect(view.lines[0]).toEqual({ label: 'Scrub kitchen floor tiles', detail: '1.5h · complexity 4/5', total: 74, photo: 1 });
  });

  it('never sends the odds, the usual price, the market check or the model wiring', () => {
    const serialized = JSON.stringify(clientQuoteView(proQuote));
    for (const privateOf of ['winProbability', 'band', 'usualPrice', 'undercharge', 'marketBenchmark', 'engine', 'timings', 'followUp']) {
      expect(serialized, `the client link must not carry ${privateOf}`).not.toContain(privateOf);
    }
  });

  it('shares the work but not the pricing inputs, field for field', () => {
    // `detail` is a sentence the pro authored for this quote and the client is
    // meant to read it — "1.5h · complexity 2/5" is the argument for the price.
    // What stays server-side are the structured inputs the line is priced from.
    const [first] = clientQuoteView(proQuote).lines;
    expect(first.detail).toContain('1.5h');
    expect(first).not.toHaveProperty('hours');
    expect(first).not.toHaveProperty('complexity');
    expect(first).not.toHaveProperty('qty');
    expect(first).not.toHaveProperty('unit');
  });

  it('answers a missing id with an empty record rather than a stack of defaults', () => {
    expect(clientQuoteView({ id: 'gone' })).toEqual({ id: 'gone', lines: [] });
  });
});
