import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type Health, type MarginPoint, type Profile, type Quote, type QuoteInput } from './api.ts';
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

export function App() {
  const [tab, setTab] = useState<Tab>('jobs');
  const [health, setHealth] = useState<Health | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [jobs, setJobs] = useState<Quote[]>([]);
  const [margin, setMargin] = useState<MarginPoint[]>([]);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const stepTimer = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    const [h, p, j, m] = await Promise.allSettled([api.health(), api.profile(), api.jobs(), api.margin(30)]);
    if (h.status === 'fulfilled') setHealth(h.value);
    if (p.status === 'fulfilled') setProfile(p.value);
    if (j.status === 'fulfilled') setJobs(j.value.jobs);
    if (m.status === 'fulfilled' && m.value.enabled) setMargin(m.value.series);
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

      {tab === 'profile' && <ProfileView profile={profile} health={health} margin={margin} />}

      <nav className="nav">
        <button className={tab === 'jobs' ? 'active' : ''} onClick={() => setTab('jobs')}>
          <span className="dot" />
          Jobs
        </button>
        <button className={tab === 'walk' ? 'active' : ''} onClick={() => setTab('walk')}>
          <span className="dot" />
          Walk
        </button>
        <button className={tab === 'profile' ? 'active' : ''} onClick={() => setTab('profile')}>
          <span className="dot" />
          You
        </button>
      </nav>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
