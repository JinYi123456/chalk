import { Pool } from 'pg';
import { config } from '../config.js';

export type JobEvent = {
  id: string;
  ts: number;
  jobType: string;
  price: number;
  winProbability: number;
  outcome: 'quoted' | 'won' | 'lost';
};

let pool: Pool | null = null;
let ensured = false;
let failed = false;

export function tigerEnabled(): boolean {
  return Boolean(config.tigerUrl);
}

function getPool(): Pool | null {
  if (!config.tigerUrl || failed) return null;
  if (pool) return pool;
  try {
    pool = new Pool({
      connectionString: config.tigerUrl,
      ssl: /sslmode=require|tigerdata|timescale/.test(config.tigerUrl) ? { rejectUnauthorized: false } : undefined,
      max: 3,
      connectionTimeoutMillis: 5000,
    });
    pool.on('error', () => {
      /* a dropped idle client must not crash the agent */
    });
    return pool;
  } catch {
    failed = true;
    return null;
  }
}

async function ensure(): Promise<Pool | null> {
  const p = getPool();
  if (!p) return null;
  if (ensured) return p;
  try {
    await p.query(`
      CREATE TABLE IF NOT EXISTS job_events (
        id TEXT NOT NULL,
        ts TIMESTAMPTZ NOT NULL,
        job_type TEXT NOT NULL,
        price NUMERIC(10,2) NOT NULL,
        win_probability NUMERIC(5,3) NOT NULL,
        outcome TEXT NOT NULL
      )`);
    await p.query(`CREATE INDEX IF NOT EXISTS job_events_ts_idx ON job_events (ts DESC)`);
    ensured = true;
    return p;
  } catch {
    failed = true;
    return null;
  }
}

/** Fire-and-forget: the margin log must never block a quote. */
export async function recordJobEvent(ev: JobEvent): Promise<void> {
  const p = await ensure();
  if (!p) return;
  try {
    await p.query(
      `INSERT INTO job_events (id, ts, job_type, price, win_probability, outcome) VALUES ($1,$2,$3,$4,$5,$6)`,
      [ev.id, new Date(ev.ts).toISOString(), ev.jobType, ev.price, ev.winProbability, ev.outcome]
    );
  } catch {
    /* swallow — the log is a nice-to-have */
  }
}

export type MarginPoint = { day: string; quoted: number; won: number; revenue: number; winRate: number };

export async function marginSeries(days = 30): Promise<MarginPoint[] | null> {
  const p = await ensure();
  if (!p) return null;
  try {
    const res = await p.query<{ day: string; quoted: string; won: string; revenue: string }>(
      `SELECT to_char(date_trunc('day', ts), 'YYYY-MM-DD') AS day,
              count(*) AS quoted,
              count(*) FILTER (WHERE outcome = 'won') AS won,
              coalesce(sum(price) FILTER (WHERE outcome = 'won'), 0) AS revenue
         FROM job_events
        WHERE ts > now() - ($1 || ' days')::interval
        GROUP BY 1
        ORDER BY 1`,
      [String(days)]
    );
    return res.rows.map((r) => {
      const quoted = Number(r.quoted);
      const won = Number(r.won);
      return {
        day: r.day,
        quoted,
        won,
        revenue: Math.round(Number(r.revenue)),
        winRate: quoted ? Math.round((won / quoted) * 100) / 100 : 0,
      };
    });
  } catch {
    return null;
  }
}

export async function tigerStatus(): Promise<{ enabled: boolean; connected: boolean; total?: number }> {
  if (!tigerEnabled()) return { enabled: false, connected: false };
  const p = await ensure();
  if (!p) return { enabled: true, connected: false };
  try {
    const res = await p.query<{ n: string }>(`SELECT count(*) AS n FROM job_events`);
    return { enabled: true, connected: true, total: Number(res.rows[0]?.n ?? 0) };
  } catch {
    return { enabled: true, connected: false };
  }
}
