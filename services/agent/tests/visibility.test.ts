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
    { label: 'Scrub kitchen floor tiles', detail: 'tiles and grout', qty: 1, unit: 'area', hours: 1.5, complexity: 4, total: 74, photo: 1 },
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
    expect(view.lines[0]).toEqual({ label: 'Scrub kitchen floor tiles', detail: 'tiles and grout', total: 74, photo: 1 });
  });

  it('never sends the odds, the usual price, the market check or the hours', () => {
    const serialized = JSON.stringify(clientQuoteView(proQuote));
    for (const privateOf of ['winProbability', 'band', 'usualPrice', 'undercharge', 'marketBenchmark', 'hours', 'complexity', 'engine', 'timings', 'followUp']) {
      expect(serialized, `the client link must not carry ${privateOf}`).not.toContain(privateOf);
    }
  });

  it('answers a missing id with an empty record rather than a stack of defaults', () => {
    expect(clientQuoteView({ id: 'gone' })).toEqual({ id: 'gone', lines: [] });
  });
});
