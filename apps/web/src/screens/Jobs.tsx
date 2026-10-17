import { money, timeAgo, type Profile, type Quote } from '../api.ts';

export function Jobs({
  jobs,
  profile,
  onNew,
  onOpen,
}: {
  jobs: Quote[];
  profile: Profile | null;
  onNew: () => void;
  onOpen: (id: string) => void;
}) {
  const won = jobs.filter((j) => j.outcome === 'won');
  const thisMonth = jobs.filter((j) => Date.now() - j.createdAt < 30 * 86_400_000);
  const wonValue = won.reduce((s, j) => s + j.total, 0);

  return (
    <div>
      <h1>
        Price the job
        <br />
        while you're still standing in it.
      </h1>
      <p className="lead">
        Walk it, photograph it, talk it through. Chalk prices it against the jobs you've already won and writes the
        quote in your voice.
      </p>

      <button className="btn primary" style={{ marginTop: 14 }} onClick={onNew}>
        Walk a new job
      </button>

      <h2>Your numbers</h2>
      <div className="stats">
        <div className="stat">
          <div className="n">{profile ? `${Math.round(profile.winRate * 100)}%` : '—'}</div>
          <div className="l">win rate</div>
        </div>
        <div className="stat">
          <div className="n">{profile ? money(profile.avgTicket) : '—'}</div>
          <div className="l">avg ticket</div>
        </div>
        <div className="stat">
          <div className="n">{profile ? money(profile.hourly) : '—'}</div>
          <div className="l">per hour</div>
        </div>
        <div className="stat">
          <div className="n">{profile ? profile.jobs : '—'}</div>
          <div className="l">jobs priced</div>
        </div>
      </div>

      <h2>Quotes on your phone</h2>
      {jobs.length === 0 ? (
        <div className="empty">
          No quotes yet. Walk your next job and it lands here — with what you quoted, what you won, and what to follow
          up.
        </div>
      ) : (
        <div>
          {jobs.map((j) => (
            <button className="job-row" key={j.id} onClick={() => onOpen(j.id)}>
              <div className="grow">
                <div className="t">{j.headline}</div>
                <div className="m">
                  {j.client ? `${j.client} · ` : ''}
                  {timeAgo(j.createdAt)} · {Math.round(j.winProbability * 100)}% odds
                  {j.outcome ? ' ·' : ''} {j.outcome && <span className={`badge ${j.outcome}`}>{j.outcome}</span>}
                </div>
              </div>
              <div className="amt">{money(j.total)}</div>
            </button>
          ))}
        </div>
      )}

      {thisMonth.length > 0 && (
        <p className="small-note">
          {thisMonth.length} quote{thisMonth.length === 1 ? '' : 's'} in the last 30 days
          {won.length > 0 ? ` · ${won.length} won, ${money(wonValue)} of work` : ''}.
        </p>
      )}
    </div>
  );
}
