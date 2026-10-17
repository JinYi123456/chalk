export type ScopeTask = {
  label: string;
  qty: number;
  unit: string;
  hours: number;
  complexity: number;
  /** 1-based walkthrough photo that shows this task */
  photo?: number;
};

export type JobScope = {
  jobType: string;
  headline: string;
  rooms: { name: string; condition: string }[];
  tasks: ScopeTask[];
  materials: { label: string; cost: number }[];
  access: string[];
  risks: string[];
  totalHours: number;
  confidence: number;
  seen: string;
  basis: string[];
};

export type PriceBand = { label: string; at: number; win: number };

export type QuoteLine = {
  label: string;
  detail: string;
  qty: number;
  unit: string;
  unitPrice: number;
  total: number;
  kind: 'labor' | 'materials' | 'fee';
  /** 1-based walkthrough photo this line is priced against */
  photo?: number;
};

export type Quote = {
  id: string;
  createdAt: number;
  jobType: string;
  client: string;
  headline: string;
  scope: JobScope;
  lines: QuoteLine[];
  subtotal: number;
  total: number;
  range: { low: number; high: number };
  winProbability: number;
  band: PriceBand[];
  /** 'model' = the classifier's own answer per price; 'modelled' = a drawn shape */
  bandSource?: 'model' | 'modelled';
  usualPrice: number | null;
  underchargeWarning: string | null;
  marketBenchmark: { low: number; high: number; source: string; note: string } | null;
  priceRationale: string;
  clientMessage: string;
  assumptions: string[];
  validDays: number;
  engine: { scope: string; pricing: string; writing: string; voice?: string };
  timings?: { vision: number; scope: number; pricing: number; words: number; total: number };
  followUp: { scheduled: boolean; workflowId?: string; nudges: string[]; reason?: string };
  audioUrl: string | null;
  currency: string;
  outcome?: 'won' | 'lost' | null;
  /** walkthrough photos (downscaled) — only on the detail reads */
  photos?: string[];
  photoCaptions?: string[];
};

export type Health = {
  ok: boolean;
  provider: string;
  model: string;
  visionModel: string;
  tabpfn: boolean;
  tabpfnCloud: boolean;
  tabpfnUrl: string;
  storage: string;
  storedQuotes: number;
  tts: boolean;
  serpapi: boolean;
  sentry: boolean;
  temporal: boolean;
  temporalConnected: boolean;
  tinker: boolean;
  tiger: boolean;
  tigerConnected: boolean;
  engine: string;
};

export type Profile = {
  jobs: number;
  won: number;
  winRate: number;
  avgTicket: number;
  hourly: number;
  byType: Record<string, { label: string; jobs: number; winRate: number; avg: number }>;
};

export type MarginPoint = { day: string; quoted: number; won: number; revenue: number; winRate: number };

export type BenchRow = {
  arm: string;
  cases: number;
  answered: number;
  recall: number;
  textRecall: number;
  inventions: number;
  hoursInBand: number;
  captionCountsOk: number;
  photoRefsOk: number;
  p50ms: number;
  tokensPerCase: number;
  costPerCase: number | null;
};

export type Benchmark = {
  available: boolean;
  ranAt?: string;
  reproduce?: string;
  arms?: { id: string; label: string; vendor: string; weights: string; where: string; price: { in: number; out: number } | null }[];
  summary?: { vision: BenchRow[]; scope: BenchRow[] };
};

export type QuoteInput = {
  photos: string[];
  notes: string;
  jobType?: string;
  client?: string;
  location?: string;
};

async function j<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`${res.status} ${detail.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

export const api = {
  health: () => j<Health>('/api/health'),
  profile: () => j<Profile>('/api/profile'),
  margin: (days = 30) => j<{ enabled: boolean; connected: boolean; total: number; series: MarginPoint[] }>(`/api/margin?days=${days}`),
  benchmark: () => j<Benchmark>('/api/benchmark'),
  jobs: () => j<{ kind: string; jobs: Quote[] }>('/api/jobs'),
  job: (id: string) => j<Quote & { followUpLive?: unknown }>(`/api/jobs/${id}`),
  quote: (input: QuoteInput) =>
    j<Quote>('/api/quote', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) }),
  outcome: (id: string, outcome: 'won' | 'lost') =>
    j<{ ok: boolean }>(`/api/jobs/${id}/outcome`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ outcome }),
    }),
  tts: (text: string) => j<{ url: string }>('/api/tts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) }),
};

export function ms(n: number): string {
  return n < 1000 ? `${n}ms` : `${(n / 1000).toFixed(1)}s`;
}

export function money(n: number): string {
  return `$${Math.round(n).toLocaleString()}`;
}

export function timeAgo(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}
