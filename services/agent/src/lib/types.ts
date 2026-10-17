export type ScopeTask = {
  label: string;
  qty: number;
  unit: string;
  hours: number;
  complexity: number; // 1 easy .. 5 brutal
  /** 1-based walkthrough photo that shows this task, when one does */
  photo?: number;
};

export type JobScope = {
  jobType: string; // canonical slug, e.g. "deep_clean"
  headline: string; // human title, e.g. "2-bed end-of-lease deep clean"
  rooms: { name: string; condition: string }[];
  tasks: ScopeTask[];
  materials: { label: string; cost: number }[];
  access: string[];
  risks: string[];
  totalHours: number;
  confidence: number; // 0..1
  seen: string; // what the vision model actually reported
  basis: string[]; // which layers informed the scope
};

/** One row of the pro's own job history — the tabular training context. */
export type PastJob = {
  dateKey: string;
  jobType: string;
  totalHours: number;
  tasks: number;
  rooms: number;
  complexityAvg: number;
  complexityMax: number;
  materialsCost: number;
  accessDifficulty: number; // 0..3
  riskCount: number;
  price: number;
  won: boolean;
  daysToAccept: number | null;
};

export type PriceBand = { label: string; at: number; win: number };

export type PricingResult = {
  price: number;
  low: number;
  high: number;
  winProbability: number;
  served: 'model' | 'precomputed' | 'heuristic';
  basis: string;
  band: PriceBand[];
  /**
   * 'model' when the ladder is the classifier's own answer for each candidate
   * price; 'modelled' when it is the linear fallback around a single estimate.
   * The UI says which, because they are not the same claim.
   */
  bandSource?: 'model' | 'modelled';
  /** what the pro has historically charged for this kind of job */
  usualPrice: number | null;
  historyUsed: number;
};

export type QuoteLine = {
  label: string;
  detail: string;
  qty: number;
  unit: string;
  unitPrice: number;
  total: number;
  kind: 'labor' | 'materials' | 'fee';
  /** 1-based walkthrough photo this line is priced against — the client's evidence */
  photo?: number;
};

export type QuoteEngine = {
  scope: string;
  pricing: string;
  writing: string;
  voice?: string;
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
  /** which ladder the card is showing: the classifier's, or a drawn shape */
  bandSource?: 'model' | 'modelled';
  usualPrice: number | null;
  underchargeWarning: string | null;
  marketBenchmark: { low: number; high: number; source: string; note: string } | null;
  priceRationale: string;
  clientMessage: string;
  assumptions: string[];
  validDays: number;
  engine: QuoteEngine;
  /** milliseconds each stage actually took — the demo is honest about it */
  timings?: { vision: number; scope: number; pricing: number; words: number; total: number };
  followUp: { scheduled: boolean; workflowId?: string; nudges: string[]; reason?: string };
  audioUrl: string | null;
  currency: string;
  outcome?: 'won' | 'lost' | null;
  /**
   * The walkthrough itself. Downscaled on the phone before upload, stored with
   * the quote, and shown on the client's link as the evidence behind the
   * numbers — the pro's camera is the proof the price is not a guess.
   */
  photos?: string[];
  photoCaptions?: string[];
};
