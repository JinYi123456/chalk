import { money, type Benchmark, type BenchRow, type Health, type MarginPoint, type Profile } from '../api.ts';

function Live({ on }: { on: boolean }) {
  return <span className={`dot-live ${on ? 'on' : ''}`} />;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

function BenchGroup({ title, note, rows, bench }: { title: string; note: string; rows: BenchRow[]; bench: Benchmark }) {
  if (!rows.length) return null;
  return (
    <div className="card">
      <div className="bench-h">
        <span>{title}</span>
        <small>{note}</small>
      </div>
      {rows.map((r) => {
        const arm = bench.arms?.find((a) => a.id === r.arm);
        return (
          <div className="bench-row" key={r.arm}>
            <div className="bench-top">
              <span className="bench-name">{arm?.label ?? r.arm}</span>
              <span className="bench-usable">{pct(r.recall)}</span>
            </div>
            <div className="bench-meta">
              <span>{arm?.weights === 'closed' ? 'closed weights' : arm?.weights === 'none' ? 'no model' : 'open weights'}</span>
              <span> · {arm?.where === 'device' ? 'this laptop' : arm?.vendor ?? r.arm}</span>
            </div>
            <div className="bench-nums">
              <span title="work the model identified in its own prose">found {pct(r.textRecall)}</span>
              <span title="how many answers survived the product parser">{r.answered}/{r.cases} usable</span>
              <span title="facts or line items invented that the walkthrough does not support">{r.inventions} invented</span>
              <span>{(r.p50ms / 1000).toFixed(1)}s</span>
              <span title="USD per call at the provider's published list price; n/a where none is published">
                {r.costPerCase === null ? 'no list price' : r.costPerCase === 0 ? '$0.0000' : `$${r.costPerCase.toFixed(4)}`}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function ProfileView({
  profile,
  health,
  margin,
  bench,
}: {
  profile: Profile | null;
  health: Health | null;
  margin: MarginPoint[];
  bench: Benchmark | null;
}) {
  const byType = profile ? Object.entries(profile.byType).sort((a, b) => b[1].jobs - a[1].jobs) : [];
  const maxRev = Math.max(1, ...margin.map((m) => m.revenue));

  return (
    <div>
      <h1>Your numbers.</h1>
      <p className="lead">
        Chalk prices every job off this record. The more you tell it what you won, the sharper it gets — and none of it
        ever leaves this machine.
      </p>

      <div className="stats">
        <div className="stat">
          <div className="n">{profile ? profile.jobs : '—'}</div>
          <div className="l">jobs priced</div>
        </div>
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
      </div>

      <h2>What you charge, by job</h2>
      {byType.length === 0 ? (
        <div className="empty">No priced jobs yet.</div>
      ) : (
        <div className="card">
          {byType.map(([slug, row]) => (
            <div className="li" key={slug}>
              <div>
                <div className="l">{row.label}</div>
                <div className="d">
                  {row.jobs} jobs · {Math.round(row.winRate * 100)}% won
                </div>
              </div>
              <div className="amt">{money(row.avg)}</div>
            </div>
          ))}
        </div>
      )}

      <h2>The margin log</h2>
      <div className="card">
        {margin.length === 0 ? (
          <p className="small-note" style={{ margin: 0 }}>
            Nothing logged yet. Won and lost jobs land here as a time-series — so "did I make money this month?" is a
            chart, not a feeling.
          </p>
        ) : (
          <>
            <div className="bars">
              {margin.map((m) => (
                <div
                  className={`bar ${m.won > 0 ? 'on' : ''}`}
                  key={m.day}
                  style={{ height: `${Math.max(6, (m.revenue / maxRev) * 100)}%` }}
                  title={`${m.day}: ${money(m.revenue)} won of ${m.quoted} quoted`}
                />
              ))}
            </div>
            <p className="small-note">
              {margin.reduce((s, m) => s + m.won, 0)} won of {margin.reduce((s, m) => s + m.quoted, 0)} quoted ·{' '}
              {money(margin.reduce((s, m) => s + m.revenue, 0))} of work booked.
            </p>
          </>
        )}
      </div>

      <h2>What's running</h2>
      <div className="card engine-list">
        <div>
          <Live on={Boolean(health)} />
          <span className="k">Model</span>
          {health ? health.engine : 'connecting…'}
        </div>
        <div>
          <Live on={Boolean(health?.tabpfn)} />
          <span className="k">Pricing</span>
          {health?.tabpfnCloud
            ? 'TabPFN-3.5, hosted (in-context over your history)'
            : health?.tabpfn
              ? 'TabPFN, this machine'
              : 'heuristic over your own rows (no model reachable)'}
        </div>
        <div>
          <Live on={Boolean(health?.storage === 'mongodb-atlas')} />
          <span className="k">Memory</span>
          {health?.storage === 'mongodb-atlas' ? `MongoDB Atlas · ${health.storedQuotes} quotes` : `on-device · ${health?.storedQuotes ?? 0} quotes`}
        </div>
        <div>
          <Live on={Boolean(health?.tts)} />
          <span className="k">Voice</span>
          {health?.tts ? 'ElevenLabs read-back' : 'not configured'}
        </div>
        <div>
          <Live on={Boolean(health?.serpapi)} />
          <span className="k">Market</span>
          {health?.serpapi ? 'SerpApi live rates' : 'not configured'}
        </div>
        <div>
          <Live on={Boolean(health?.temporalConnected)} />
          <span className="k">Follow-ups</span>
          {health?.temporalConnected ? 'Temporal durable timers' : health?.temporal ? 'Temporal configured, not connected' : 'not configured'}
        </div>
        <div>
          <Live on={Boolean(health?.sentry)} />
          <span className="k">Tracing</span>
          {health?.sentry ? 'Sentry agent traces' : 'not configured'}
        </div>
        <div>
          <Live on={Boolean(health?.tigerConnected)} />
          <span className="k">Margin log</span>
          {health?.tigerConnected ? 'Tiger Data time-series' : health?.tiger ? 'Tiger configured, not connected' : 'not configured'}
        </div>
        <div>
          <Live on={Boolean(health?.tinker)} />
          <span className="k">Quote voice</span>
          {health?.tinker ? 'Tinker fine-tuned sampler' : 'built-in voice'}
        </div>
      </div>

      <h2>Open vs closed, measured</h2>
      {!bench?.available ? (
        <div className="card">
          <p className="small-note" style={{ margin: 0 }}>
            No benchmark run stored on this build. Reproduce it with{' '}
            <code>{bench?.reproduce ?? 'node services/agent/scripts/benchmark.mjs'}</code> — the same walkthrough sent
            to closed models, hosted open-weight models, and a model running with no network at all.
          </p>
        </div>
      ) : (
        <>
          <p className="lead">
            The honest question is not whether open weights are nicer, it is whether they answer in a form a quote can
            ship. <strong>found</strong> is work the model named anywhere in its reply; <strong>usable</strong> is the
            same score after the product parser. The gap is a model that understood the job and still could not price it.
          </p>
          <BenchGroup title="Eyes — read the photos" note="keyword recall against the answer key" rows={bench.summary?.vision ?? []} bench={bench} />
          <BenchGroup title="Brain — itemize the scope" note="one authored site read, so the eyes are not blamed" rows={bench.summary?.scope ?? []} bench={bench} />
          <p className="small-note">
            Ran {bench.ranAt ? new Date(bench.ranAt).toUTCString().replace(':00 GMT', ' GMT') : '—'}. Scores are
            keyword-set recall against a hand-written key in <code>services/agent/src/lib/benchmark.ts</code>, so no
            model judges a model and every number here can be recomputed. Reproduce: <code>{bench.reproduce}</code>.
          </p>
        </>
      )}

      <p className="small-note">
        Every layer above is optional. Pull any of them out and Chalk keeps quoting — it just tells you which one
        answered, instead of pretending.
      </p>
    </div>
  );
}
