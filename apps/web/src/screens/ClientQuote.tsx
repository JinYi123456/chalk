import { useEffect, useState } from 'react';
import { api, money, type Quote } from '../api.ts';

/**
 * What the client sees. Deliberately a different face of the same record: the
 * itemised work, the words the pro wrote, what they assumed, and the price.
 * The split is enforced by the endpoint this calls — `/api/jobs/<id>/client`
 * never sends the win odds, the usual price or the hours behind a line — so
 * the page cannot leak them by rendering something it should not.
 */
export function ClientQuote({ id }: { id: string }) {
  const [quote, setQuote] = useState<Quote | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'gone'>('loading');
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .clientJob(id)
      .then((q) => {
        if (!alive) return;
        setQuote(q);
        setState('ready');
      })
      .catch(() => alive && setState('gone'));
    return () => {
      alive = false;
    };
  }, [id]);

  const answer = async (outcome: 'won' | 'lost') => {
    if (!quote || sending) return;
    setSending(true);
    setFailed(null);
    try {
      await api.outcome(quote.id, outcome);
      setQuote({ ...quote, outcome });
    } catch {
      setFailed('That did not reach your pro — try again, or just reply to their message.');
    } finally {
      setSending(false);
    }
  };

  if (state === 'loading') {
    return (
      <div className="client">
        <div className="from">Chalk</div>
        <div className="paper">
          <p className="sub">Opening your quote…</p>
        </div>
      </div>
    );
  }

  if (state === 'gone' || !quote) {
    return (
      <div className="client">
        <div className="from">Chalk</div>
        <div className="paper">
          <h3>This quote isn&apos;t here</h3>
          <p className="sub" style={{ marginTop: 8 }}>
            The link may have expired, or it was replaced by a newer quote. Ask your pro to send it again — it takes
            them about fifteen seconds.
          </p>
        </div>
      </div>
    );
  }

  const validUntil = new Date(quote.createdAt + quote.validDays * 86_400_000);
  const answered = quote.outcome === 'won' || quote.outcome === 'lost';
  const photos = quote.photos ?? [];
  const captions = quote.photoCaptions ?? [];
  // Index 1 is the first photo — the same numbering the scope used.
  const shot = (n?: number) => (n && n >= 1 && n <= photos.length ? photos[n - 1] : null);
  const captionOf = (n?: number) => (n && n >= 1 && n <= captions.length ? captions[n - 1] : '');
  const evidenceCount = quote.lines.filter((l) => shot(l.photo)).length;

  return (
    <div className="client">
      <div className="from">
        <img src="/icon.svg" alt="" />
        <span>Chalk · quote from your pro</span>
      </div>

      <div className="paper">
        <h3>{quote.headline}</h3>
        <div className="sub">
          {quote.client ? `Prepared for ${quote.client} · ` : ''}
          {validUntil.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
        </div>

        {photos.length > 0 && (
          <div className="saw">
            <p className="saw-h">
              What I saw when I priced this
              {evidenceCount > 0 ? ' — the photo behind each line is on it' : ''}
            </p>
            <div className="strip">
              {photos.map((p, i) => (
                <figure key={i} id={`shot-${i + 1}`}>
                  <img src={p} alt={captions[i] || `Walkthrough photo ${i + 1}`} />
                  {captions[i] && <figcaption>{captions[i]}</figcaption>}
                </figure>
              ))}
            </div>
          </div>
        )}

        <div style={{ marginTop: 18 }}>
          {quote.lines.map((l, i) => {
            const src = shot(l.photo);
            return (
              <div className={src ? 'li with-shot' : 'li'} key={i}>
                {src && (
                  <button
                    type="button"
                    className="shot-chip"
                    title={captionOf(l.photo) || 'the photo this line is priced against'}
                    onClick={() => document.getElementById(`shot-${l.photo}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
                  >
                    <img src={src} alt={captionOf(l.photo) || ''} />
                  </button>
                )}
                <div className="copy">
                  <div className="l">{l.label}</div>
                  {l.detail && <div className="d">{l.detail}</div>}
                </div>
                <div className="amt">{money(l.total)}</div>
              </div>
            );
          })}
        </div>

        <div className="total">
          <span>Total</span>
          <span>
            <span className="big">{money(quote.total)}</span>
          </span>
        </div>

        {quote.assumptions.length > 0 && (
          <>
            <p style={{ marginTop: 18, marginBottom: 4, fontWeight: 600, fontSize: 13 }}>What this price assumes</p>
            <ul style={{ margin: 0, paddingLeft: 18, color: '#4a4f58', fontSize: 13, lineHeight: 1.6 }}>
              {quote.assumptions.map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ul>
          </>
        )}

        <p className="msg">{quote.clientMessage}</p>

        <p className="terms">
          This price holds until {validUntil.toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}. If the
          job turns out different from the walkthrough — more rooms, hidden damage, no access — your pro will quote the
          difference before starting, never after.
        </p>
      </div>

      {answered ? (
        <div className={quote.outcome === 'won' ? 'card answered good' : 'card answered'}>
          {quote.outcome === 'won' ? (
            <>
              <strong>Booked. Your pro has been told.</strong>
              <p className="small-note" style={{ marginTop: 6 }}>
                The price is locked at {money(quote.total)} until{' '}
                {validUntil.toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}. They will confirm a day
                to start.
              </p>
            </>
          ) : (
            <>
              <strong>Thanks for letting them know.</strong>
              <p className="small-note" style={{ marginTop: 6 }}>
                Nothing is booked and nothing is owed. If you change your mind before{' '}
                {validUntil.toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}, this quote still stands.
              </p>
            </>
          )}
        </div>
      ) : (
        <div className="answer">
          <button className="btn primary" disabled={sending} onClick={() => void answer('won')}>
            {sending ? 'Sending…' : 'Accept this quote'}
          </button>
          <button className="btn ghost" disabled={sending} onClick={() => void answer('lost')}>
            Not right now
          </button>
          <p className="small-note">
            No payment now. Accepting tells your pro to book you in — and makes every future quote from them a little
            sharper.
          </p>
          {failed && <p className="small-note" style={{ color: 'var(--red)' }}>{failed}</p>}
        </div>
      )}

      <p className="small-note foot">
        Priced from this pro&apos;s own past jobs and live local rates — not a national average.
      </p>
    </div>
  );
}
