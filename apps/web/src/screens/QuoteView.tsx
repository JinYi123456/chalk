import { useState } from 'react';
import { api, money, ms, timeAgo, type Quote } from '../api.ts';

export function QuoteView({
  quote,
  onOutcome,
  onToast,
  onBack,
}: {
  quote: Quote;
  onOutcome: (o: 'won' | 'lost') => void;
  onToast: (s: string) => void;
  onBack: () => void;
}) {
  const [audio, setAudio] = useState<string | null>(quote.audioUrl);
  const [reading, setReading] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const readAloud = async () => {
    if (audio) {
      new Audio(audio).play();
      return;
    }
    setReading(true);
    try {
      const { url } = await api.tts(quote.clientMessage);
      setAudio(url);
      new Audio(url).play();
    } catch {
      onToast('voice is unavailable right now');
    } finally {
      setReading(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(quote.clientMessage);
      onToast('message copied — paste it into your text thread');
    } catch {
      onToast('could not copy');
    }
  };

  // The link is the whole point: the pro's phone has the quote, the client's
  // phone has to get it too. Same record, client-safe face.
  const shareUrl = `${window.location.origin}/q/${quote.id}`;
  const canShare = typeof navigator !== 'undefined' && 'share' in navigator;

  const del = async () => {
    if (!window.confirm(`Delete this quote, its ${quote.photos?.length ?? 0} photograph(s) and the client link?`)) return;
    setDeleting(true);
    const gone = await fetch(`/api/jobs/${quote.id}`, { method: 'DELETE' })
      .then((r) => r.ok)
      .catch(() => false);
    setDeleting(false);
    if (gone) {
      onToast('quote and its photos deleted');
      onBack();
    } else {
      onToast('that did not delete — the quote is still there');
    }
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      onToast(`link copied — text it to ${quote.client || 'your client'}`);
    } catch {
      onToast('could not copy the link');
    }
  };

  const shareIt = async () => {
    try {
      await navigator.share({ title: quote.headline, text: quote.clientMessage.slice(0, 280), url: shareUrl });
    } catch {
      /* they closed the share sheet — nothing to report */
    }
  };

  const recommended = quote.band.find((b) => Math.abs(b.at - quote.total) <= Math.max(4, quote.total * 0.03)) ?? quote.band[2];
  const walkthrough = quote.photos ?? [];
  const captions = quote.photoCaptions ?? [];
  const shotsAttached = quote.lines.filter((l) => l.photo).length;

  return (
    <div>
      <button className="btn ghost small" onClick={onBack} style={{ marginBottom: 14 }}>
        ← All jobs
      </button>

      <div className="paper">
        <div className="x-hair">
          <div style={{ flex: 1 }}>
            <h3>{quote.headline}</h3>
            <div className="sub">
              {quote.client ? `Prepared for ${quote.client} · ` : ''}
              {new Date(quote.createdAt).toLocaleDateString()} · valid {quote.validDays} days
            </div>
          </div>
        </div>

        <div style={{ marginTop: 16 }}>
          {quote.lines.map((l, i) => (
            <div className="li" key={i}>
              <div>
                <div className="l">{l.label}</div>
                {l.detail && <div className="d">{l.detail}</div>}
              </div>
              <div className="amt">{money(l.total)}</div>
            </div>
          ))}
        </div>

        <div className="total">
          <span>Total</span>
          <span>
            <span className="big">{money(quote.total)}</span>
          </span>
        </div>
        <p style={{ margin: '4px 0 0', color: '#6a6f79', fontSize: 13 }}>
          Fair range for this job: {money(quote.range.low)}–{money(quote.range.high)}.
          {quote.marketBenchmark ? ` ${quote.marketBenchmark.note}` : ''}
        </p>

        {quote.assumptions.length > 0 && (
          <>
            <p style={{ marginTop: 14, marginBottom: 4, fontWeight: 600, fontSize: 13 }}>What I assumed</p>
            <ul style={{ margin: 0, paddingLeft: 18, color: '#4a4f58', fontSize: 13, lineHeight: 1.6 }}>
              {quote.assumptions.map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ul>
          </>
        )}

        <p style={{ marginTop: 16, whiteSpace: 'pre-wrap', fontSize: 14.5, lineHeight: 1.6 }}>{quote.clientMessage}</p>

        <div className="btn-row" style={{ marginTop: 16 }}>
          <button className="btn ghost small" onClick={readAloud} disabled={reading}>
            {reading ? 'Voicing…' : audio ? '▶ Play again' : '🔊 Read it to me'}
          </button>
          <button className="btn small" onClick={copy}>
            Copy message
          </button>
        </div>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <strong style={{ fontSize: 14 }}>Send it</strong>
        <p className="small-note" style={{ marginTop: 4 }}>
          One link for {quote.client || 'your client'}: the itemised quote, your words, and what you assumed. Your win
          odds and your usual price never appear on it.
        </p>
        <div className="linkbox">{shareUrl}</div>
        <div className="btn-row">
          <button className="btn small" onClick={copyLink}>
            Copy link
          </button>
          {canShare && (
            <button className="btn ghost small" onClick={shareIt}>
              Share…
            </button>
          )}
          <a className="btn ghost small" href={shareUrl} target="_blank" rel="noreferrer">
            Preview
          </a>
        </div>
        {quote.outcome && (
          <p className="small-note">
            {quote.client || 'Your client'} answered on that link: they{' '}
            {quote.outcome === 'won' ? 'accepted' : 'said not this time'}.
          </p>
        )}
      </div>

      {walkthrough.length > 0 && (
        <div className="card" style={{ marginTop: 12 }}>
          <strong style={{ fontSize: 14 }}>What {quote.client || 'your client'} sees with the quote</strong>
          <p className="small-note" style={{ marginTop: 4 }}>
            {shotsAttached} of {quote.lines.length} line items point at the photo that justifies them — the pictures you
            took on the walk, with the vision model's caption.
          </p>
          <div className="strip dark">
            {walkthrough.map((p, i) => (
              <figure key={i}>
                <img src={p} alt={captions[i] ?? `walkthrough photo ${i + 1}`} />
                <figcaption>{captions[i] ?? `photo ${i + 1}`}</figcaption>
              </figure>
            ))}
          </div>
        </div>
      )}

      <h2>Your side of the desk</h2>
      <div className="stats">
        <div className="stat">
          <div className="n">{Math.round(quote.winProbability * 100)}%</div>
          <div className="l">win odds</div>
        </div>
        <div className="stat">
          <div className="n">{quote.usualPrice ? money(quote.usualPrice) : '—'}</div>
          <div className="l">your usual</div>
        </div>
        <div className="stat">
          <div className="n">{quote.scope.totalHours}h</div>
          <div className="l">on site</div>
        </div>
        <div className="stat">
          <div className="n">{money(Math.round(quote.total / Math.max(quote.scope.totalHours, 1)))}</div>
          <div className="l">per hour</div>
        </div>
      </div>

      {quote.underchargeWarning && <div className="warn">⚠ {quote.underchargeWarning}</div>}

      <div className="card" style={{ marginTop: 12 }}>
        <strong style={{ fontSize: 14 }}>What different asks would do</strong>
        <p className="small-note" style={{ marginTop: 2 }}>
          {quote.bandSource === 'model'
            ? 'Same work, different price — and every rung is the classifier’s own answer for that price, from the fit that priced this job.'
            : 'Same work, different price. The rungs are a shape drawn through your win rate at this price: over this ledger the classifier could not see a price effect, and a flat line pretending otherwise would be worse.'}
        </p>
        <div className="band">
          {quote.band.map((b) => (
            <div className={`b ${b === recommended ? 'on' : ''}`} key={b.label}>
              <span className="p">{money(b.at)}</span>
              {b.label}
              <span className="w">{Math.round(b.win * 100)}%</span>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <strong style={{ fontSize: 14 }}>Why this number</strong>
        <p style={{ marginTop: 8, color: 'var(--chalk-dim)', fontSize: 14 }}>{quote.priceRationale}</p>
        {quote.marketBenchmark && (
          <p className="small-note">
            Market check:{' '}
            {quote.marketBenchmark.low === quote.marketBenchmark.high
              ? money(quote.marketBenchmark.low)
              : `${money(quote.marketBenchmark.low)}–${money(quote.marketBenchmark.high)}`}{' '}
            ·{' '}
            <a href={quote.marketBenchmark.source} target="_blank" rel="noreferrer" style={{ color: 'var(--amber)' }}>
              source
            </a>
          </p>
        )}
      </div>

      <div className="card">
        <strong style={{ fontSize: 14 }}>How Chalk read this job</strong>
        <p style={{ marginTop: 8, color: 'var(--chalk-dim)', fontSize: 14 }}>{quote.scope.seen}</p>
        <div className="chips">
          {quote.scope.tasks.map((t, i) => (
            <span className="chip" key={i}>
              {t.label} · {t.hours}h
            </span>
          ))}
        </div>
        {quote.scope.access.length > 0 && (
          <div className="chips">
            {quote.scope.access.map((a, i) => (
              <span className="chip" key={i}>
                {a}
              </span>
            ))}
          </div>
        )}
        <p className="small-note">
          scope: {quote.engine.scope}
          <br />
          pricing: {quote.engine.pricing}
          <br />
          writing: {quote.engine.writing}
          {quote.engine.voice ? ` · voice: ${quote.engine.voice}` : ''}
          {quote.timings ? (
            <>
              <br />
              {(quote.timings.total / 1000).toFixed(1)}s end to end — eyes {ms(quote.timings.vision)}, scope{' '}
              {ms(quote.timings.scope)}, price {ms(quote.timings.pricing)}, words {ms(quote.timings.words)}
            </>
          ) : null}
        </p>
      </div>

      <div className="card">
        <strong style={{ fontSize: 14 }}>Keep the promise</strong>
        <p className="small-note">
          {quote.followUp.scheduled
            ? `A durable follow-up is running (${quote.followUp.workflowId}). It nudges you if ${quote.client || 'the client'} hasn't replied, and expires the quote on schedule.`
            : 'Follow-ups are off on this build (no Temporal worker attached). The plan below is what it will do.'}
        </p>
        <div className="chips">
          {quote.followUp.nudges.map((n, i) => (
            <span className="chip" key={i}>
              {n}
            </span>
          ))}
        </div>
      </div>

      {quote.outcome ? (
        <div className={quote.outcome === 'won' ? 'good' : 'warn'} style={{ marginTop: 14 }}>
          Logged as {quote.outcome}. The pricing model learns from this on your next job.
        </div>
      ) : (
        <div className="btn-row" style={{ marginTop: 14 }}>
          <button className="btn primary" onClick={() => onOutcome('won')}>
            They said yes
          </button>
          <button className="btn ghost" onClick={() => onOutcome('lost')}>
            They said no
          </button>
        </div>
      )}
      {/* A quote carries photographs of somebody's home, so the way to make them
          stop existing has to be in the product, not only in the README. */}
      <button className="btn ghost small" style={{ marginTop: 14 }} onClick={del} disabled={deleting}>
        {deleting ? 'Deleting…' : 'Delete this quote and its photos'}
      </button>
      <p className="small-note">Quoted {timeAgo(quote.createdAt)}.</p>
    </div>
  );
}
