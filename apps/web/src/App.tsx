import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type Benchmark, type Health, type MarginPoint, type Profile, type Quote, type QuoteInput } from './api.ts';
import { Walk } from './screens/Walk.tsx';
import { QuoteView } from './screens/QuoteView.tsx';
import { Jobs } from './screens/Jobs.tsx';
import { ProfileView } from './screens/Profile.tsx';

export type Tab = 'jobs' | 'walk' | 'quote' | 'profile';

export const STEPS = [
  'Reading the site photos',
  'Sizing the work into billable tasks',
  'Pricing it against your own job history',
  'Writing the quote in your voice',
];

/** Drawn in the same stroke language as the brand mark, and it inherits the tab colour. */
function TabIcon({ kind }: { kind: 'jobs' | 'walk' | 'you' }) {
  return (
    <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {kind === 'jobs' && (
        <>
          <path d="M6 3.5h12v17l-3-2-3 2-3-2-3 2z" />
          <path d="M9.5 8.5h5M9.5 12.5h5" />
        </>
      )}
      {kind === 'walk' && (
        <>
          <path d="M3.5 8.5h3l1.5-2.5h6L15.5 8.5h5v11h-17z" />
          <circle cx="12" cy="13.5" r="3.5" />
        </>
      )}
      {kind === 'you' && (
        <>
          <circle cx="12" cy="8" r="3.8" />
          <path d="M5 20c1.2-3.6 3.8-5.4 7-5.4s5.8 1.8 7 5.4" />
        </>
      )}
    </svg>
  );
}

export function App() {
  const [tab, setTab] = useState<Tab>('jobs');
  const [health, setHealth] = useState<Health | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [jobs, setJobs] = useState<Quote[]>([]);
  const [margin, setMargin] = useState<MarginPoint[]>([]);
  const [bench, setBench] = useState<Benchmark | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const stepTimer = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    const [h, p, j, m, b] = await Promise.allSettled([api.health(), api.profile(), api.jobs(), api.margin(30), api.benchmark()]);
    if (h.status === 'fulfilled') setHealth(h.value);
    if (p.status === 'fulfilled') setProfile(p.value);
    if (j.status === 'fulfilled') setJobs(j.value.jobs);
    if (m.status === 'fulfilled' && m.value.enabled) setMargin(m.value.series);
    if (b.status === 'fulfilled') setBench(b.value);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 2200);
    return () => window.clearTimeout(t);
  }, [toast]);

  const startQuote = useCallback(
    async (input: QuoteInput) => {
      setBusy(true);
      setError(null);
      setStep(0);
      // The pipeline is one request; this walks the steps so the pro can see it work.
      if (stepTimer.current) window.clearInterval(stepTimer.current);
      stepTimer.current = window.setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), 1700);
      try {
        const q = await api.quote(input);
        if (stepTimer.current) window.clearInterval(stepTimer.current);
        setStep(STEPS.length);
        setQuote(q);
        setTab('quote');
        void refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (stepTimer.current) window.clearInterval(stepTimer.current);
        setBusy(false);
      }
    },
    [refresh]
  );

  const openJob = useCallback(async (id: string) => {
    try {
      const q = await api.job(id);
      setQuote(q);
      setTab('quote');
    } catch {
      setToast('could not open that quote');
    }
  }, []);

  const markOutcome = useCallback(
    async (outcome: 'won' | 'lost') => {
      if (!quote) return;
      try {
        await api.outcome(quote.id, outcome);
        setQuote({ ...quote, outcome });
        setToast(outcome === 'won' ? 'logged as won' : 'logged as lost');
        void refresh();
      } catch {
        setToast('could not log that outcome');
      }
    },
    [quote, refresh]
  );

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <img className="mark" src="/icon.svg" alt="" />
          <div>
            Chalk
            <small>quote the job before you leave the driveway</small>
          </div>
        </div>
        <div className="engine-pill" title={health?.engine}>
          {health ? health.engine.replace(' · open weights', '') : 'connecting…'}
        </div>
      </header>

      {error && (
        <div className="warn" role="alert">
          {error}
        </div>
      )}

      {tab === 'jobs' && (
        <Jobs
          jobs={jobs}
          profile={profile}
          onNew={() => setTab('walk')}
          onOpen={openJob}
        />
      )}

      {tab === 'walk' && <Walk busy={busy} step={step} onPrice={startQuote} onCancel={() => setTab('jobs')} />}

      {tab === 'quote' && quote && (
        <QuoteView quote={quote} onOutcome={markOutcome} onToast={setToast} onBack={() => setTab('jobs')} />
      )}

      {tab === 'quote' && !quote && <div className="empty">No quote open yet. Walk a job first.</div>}

      {tab === 'profile' && <ProfileView profile={profile} health={health} margin={margin} bench={bench} />}

      <nav className="nav">
        <button className={tab === 'jobs' ? 'active' : ''} onClick={() => setTab('jobs')}>
          <TabIcon kind="jobs" />
          Jobs
        </button>
        <button className={tab === 'walk' ? 'active' : ''} onClick={() => setTab('walk')}>
          <TabIcon kind="walk" />
          Walk
        </button>
        <button className={tab === 'profile' ? 'active' : ''} onClick={() => setTab('profile')}>
          <TabIcon kind="you" />
          You
        </button>
      </nav>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
