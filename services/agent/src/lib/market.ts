import { config } from '../config.js';
import { JOB_TYPE_LABELS } from './history.js';
import { fetchWithTimeout, money } from './util.js';

export type MarketBenchmark = { low: number; high: number; source: string; note: string } | null;

export function serpApiEnabled(): boolean {
  return Boolean(config.serpApiKey);
}

/**
 * Ask the live web what this kind of job goes for near this client. Used as a
 * sanity rail against the pro's own history — never as the price itself.
 */
export async function marketRate(
  jobType: string,
  location: string,
  hours: number
): Promise<MarketBenchmark> {
  if (!serpApiEnabled()) return null;
  const label = JOB_TYPE_LABELS[jobType] ?? 'home service';
  const q = `${label} cost per hour ${location || ''} 2026 price average`.replace(/\s+/g, ' ').trim();
  try {
    const url = new URL('https://serpapi.com/search.json');
    url.searchParams.set('engine', 'google');
    url.searchParams.set('q', q);
    url.searchParams.set('num', '10');
    url.searchParams.set('api_key', config.serpApiKey);
    const res = await fetchWithTimeout(url.toString(), {}, 12_000);
    if (!res.ok) return null;
    const data = (await res.json()) as { organic_results?: { title?: string; snippet?: string; link?: string }[]; answer_box?: { snippet?: string } };
    const blobs = [
      data.answer_box?.snippet ?? '',
      ...(data.organic_results ?? []).map((r) => `${r.title ?? ''}. ${r.snippet ?? ''}`),
    ]
      .filter(Boolean)
      .join(' ');
    const rates = [...blobs.matchAll(/\$\s?(\d{2,4})(?:\.\d+)?(?:\s?(?:-|to|–)\s?\$?\s?(\d{2,4}))?/g)]
      .map((m) => [Number(m[1]), Number(m[2] ?? m[1])])
      .filter(([a, b]) => a >= 20 && a <= 300 && b >= a);
    if (rates.length === 0) return null;
    const lows = rates.map((r) => r[0]).sort((a, b) => a - b);
    const highs = rates.map((r) => r[1]).sort((a, b) => a - b);
    const midLow = lows[Math.floor(lows.length / 2)];
    const midHigh = highs[Math.floor(highs.length / 2)];
    const low = money(midLow * Math.max(hours, 1));
    const high = money(midHigh * Math.max(hours, 1));
    const source = (data.organic_results ?? [])[0]?.link ?? 'google';
    const rate = midLow === midHigh ? `about $${midLow}/hour` : `$${midLow}–$${midHigh}/hour`;
    return {
      low,
      high,
      source,
      note: `Live listings suggest ${rate} for this kind of work in ${location || 'your area'}.`,
    };
  } catch {
    return null;
  }
}
