import { useState } from 'react';

/**
 * The public "would you pay for this" page. It is deliberately not gated: the
 * only way the claim "a real pro would pay" means anything is if the people
 * who could pay answer it themselves, in their own words, including no.
 */
const DEMO_QUOTE = '/q/0bb5db86-c2b2-44a3-851d-2611d21d4611';

export function Try() {
  const [trade, setTrade] = useState('');
  const [country, setCountry] = useState('');
  const [wouldPay, setWouldPay] = useState<'' | 'yes' | 'no' | 'maybe'>('');
  const [price, setPrice] = useState('');
  const [note, setNote] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');

  async function send() {
    if (!wouldPay) return;
    setState('sending');
    const ok = await fetch('/api/feedback', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ trade, country, wouldPay, price: price ? Number(price) : null, note, quoteId: DEMO_QUOTE.slice(3) }),
    })
      .then((r) => r.ok)
      .catch(() => false);
    setState(ok ? 'sent' : 'error');
  }

  if (state === 'sent') {
    return (
      <div className="client">
        <div className="paper">
          <h3>Thank you — that is genuinely useful.</h3>
          <p className="msg">
            A &ldquo;no&rdquo; with a reason is worth more to this build than an easy yes. Every answer here is read.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="client">
      <div className="from">
        <img src="/icon.svg" alt="" /> Chalk · a quote from a walk-through
      </div>

      <div className="paper">
        <h3>Two minutes, if you run a home-service business.</h3>
        <p className="msg">
          This is a real quote, produced by photographing four rooms and talking through the job — priced against the
          pro&rsquo;s own last 42 jobs rather than a national average.
        </p>
        <p style={{ margin: '14px 0 0' }}>
          <a className="btn primary" href={DEMO_QUOTE}>
            See the quote with its photos
          </a>
        </p>
        <p className="terms">
          Then answer three questions. There is no account, no email, and nothing here is used for anything except
          finding out whether this is worth building.
        </p>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="field">
          <label htmlFor="trade">What work do you do?</label>
          <input id="trade" value={trade} onChange={(e) => setTrade(e.target.value)} placeholder="cleaning, handyman, carpets…" maxLength={60} />
        </div>
        <div className="field">
          <label htmlFor="country">Country (optional)</label>
          <input id="country" value={country} onChange={(e) => setCountry(e.target.value)} placeholder="Malaysia" maxLength={60} />
        </div>

        <h2 style={{ marginTop: 4 }}>Would you pay about $15 a month for this?</h2>
        <div className="btn-row">
          {(['yes', 'maybe', 'no'] as const).map((v) => (
            <button key={v} className={`btn ${wouldPay === v ? 'primary' : 'ghost'}`} onClick={() => setWouldPay(v)}>
              {v === 'yes' ? 'Yes' : v === 'maybe' ? 'Maybe' : 'No'}
            </button>
          ))}
        </div>

        {wouldPay === 'yes' && (
          <div className="field" style={{ marginTop: 12 }}>
            <label htmlFor="price">What is the most you would actually pay, a month?</label>
            <input id="price" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^0-9.]/g, ''))} inputMode="decimal" placeholder="15" />
          </div>
        )}

        <div className="field" style={{ marginTop: 12 }}>
          <label htmlFor="note">What would make you say no — or what would you want it to do next?</label>
          <textarea id="note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={900} placeholder="Honest answer, any length." />
        </div>

        <button className="btn" onClick={send} disabled={!wouldPay || state === 'sending'}>
          {state === 'sending' ? 'Sending…' : 'Send answer'}
        </button>
        {state === 'error' && (
          <p className="warn" style={{ marginBottom: 0 }}>
            That did not save. Try once more, or tell me directly instead.
          </p>
        )}
      </div>
    </div>
  );
}
