import "dotenv/config";
import { createClient } from "@libsql/client";
import { newSt, step, percentile } from "./math.ts";

const KEY = process.env.MASSIVE_API_KEY ?? process.env.POLYGON_API_KEY;
const BASE = "https://api.massive.com";
const YEARS = 30;
const HALF_LIFE = 120; // days, matches ewma half-life

const url = process.env.TURSO_DATABASE_URL;
const token = process.env.TURSO_AUTH_TOKEN;
if (!url || !token) throw new Error("TURSO_DATABASE_URL and TURSO_AUTH_TOKEN are required");

const db = createClient({ url, authToken: token });

await db.executeMultiple(`
CREATE TABLE IF NOT EXISTS history (ticker TEXT, date TEXT, dd REAL, PRIMARY KEY (ticker, date));
CREATE TABLE IF NOT EXISTS state (
  ticker TEXT PRIMARY KEY, last_close REAL, running_peak REAL, current_drawdown REAL,
  drawdown_percentile REAL, ewma_variance REAL, ewma_vol REAL, normalized_drawdown REAL,
  drawdown_start TEXT, age_days INTEGER, recency_weight REAL, last_date TEXT, updated_at TEXT);
`);

// the watchlist IS the state table — a ticker exists iff it has a state row
export const watchlist = async (): Promise<string[]> =>
  (await db.execute("SELECT ticker FROM state ORDER BY ticker")).rows.map((r: any) => r.ticker);

async function get(url2: string): Promise<any> {
  if (!KEY) throw new Error("set MASSIVE_API_KEY (or POLYGON_API_KEY)");
  const r = await fetch(url2 + (url2.includes("?") ? "&" : "?") + "apiKey=" + KEY);
  const j: any = await r.json();
  if (!r.ok) throw new Error(`${url2}\n${JSON.stringify(j)}`);
  return j;
}

const fmt = (d: Date) => d.toISOString().slice(0, 10);

// pct optional: callers holding the distribution in memory (backfill) pass it in.
async function persist(t: string, s: ReturnType<typeof newSt>, date: string, close: number, pct?: number) {
  const dd = close / s.peak - 1;
  const vol = Math.sqrt(s.ewmaVar);
  if (pct === undefined) {
    const n = (await db.execute({ sql: "SELECT count(*) n FROM history WHERE ticker=? AND date < ?", args: [t, date] })).rows[0]!.n as number;
    const below = (await db.execute({ sql: "SELECT count(*) n FROM history WHERE ticker=? AND date < ? AND abs(dd) <= ?", args: [t, date, Math.abs(dd)] })).rows[0]!.n as number;
    pct = n ? below / n : 0;
  }
  const recency = Math.exp(-Math.LN2 * s.age / HALF_LIFE);
  await db.execute({
    sql: "INSERT OR REPLACE INTO state VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
    args: [t, close, s.peak, dd, pct, s.ewmaVar, vol, vol ? Math.abs(dd) / vol : 0, s.peakDate, s.age, recency, date, new Date().toISOString()],
  });
}

// Once per ticker: 30y of split-adjusted daily bars. Computed fully in memory,
// then written in batches — no per-row round trips. INSERT OR REPLACE makes a
// partial write self-heal on retry.
export async function backfill(t: string) {
  const to = fmt(new Date());
  const from = fmt(new Date(Date.now() - YEARS * 365.25 * 864e5));
  let url2 = `${BASE}/v2/aggs/ticker/${t}/range/1/day/${from}/${to}?adjusted=true&sort=asc&limit=50000`;
  const s = newSt();
  let lastDate = "";
  let lastDD = 0;
  const rows: [string, number][] = [];
  while (url2) {
    const page = await get(url2);
    for (const b of page.results ?? []) {
      const date = fmt(new Date(b.t));
      const { dd } = step(s, date, b.c);
      rows.push([date, dd]);
      lastDate = date;
      lastDD = dd;
    }
    url2 = page.next_url;
  }
  const dist = rows.slice(0, -1).map(([, dd]) => Math.abs(dd)); // percentile excludes the last day
  const pct = percentile(dist, Math.abs(lastDD));
  for (let i = 0; i < rows.length; i += 500) {
    await db.batch(
      rows.slice(i, i + 500).map(([date, dd]) => ({ sql: "INSERT OR REPLACE INTO history VALUES (?,?,?)", args: [t, date, dd] })),
      "write",
    );
  }
  await persist(t, s, lastDate, s.prevClose, pct);
  console.log(`backfilled ${t} through ${lastDate}`);
}

export async function addTicker(t: string) {
  t = t.trim().toUpperCase();
  if (!/^[A-Z.]{1,10}$/.test(t)) throw new Error(`bad ticker: ${t}`);
  if (!(await db.execute({ sql: "SELECT 1 FROM state WHERE ticker=?", args: [t] })).rows.length) await backfill(t);
}

export async function removeTicker(t: string) {
  await db.execute({ sql: "DELETE FROM state WHERE ticker=?", args: [t] });
  await db.execute({ sql: "DELETE FROM history WHERE ticker=?", args: [t] });
}

// Daily flow: grouped OHLCV -> filter watchlist -> update state -> persist.
// Cursor is derived (min over state.last_date); the per-ticker guard makes
// re-fetching old days safe when cursors are heterogeneous (e.g. a fresh
// backfill behind the others).
export async function daily() {
  const today = fmt(new Date());
  const cursor = (await db.execute("SELECT min(last_date) v FROM state")).rows[0]?.v;
  if (!cursor) return;
  const d = new Date(String(cursor) + "T00:00:00Z");
  while (true) {
    d.setUTCDate(d.getUTCDate() + 1);
    const ds = fmt(d);
    if (ds > today) break;
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
    const j = await get(`${BASE}/v2/aggs/grouped/${ds}?adjusted=true`);
    if (!j.results?.length) {
      if (ds === today) break; // today not closed yet; retry next run
      continue; // holiday
    }
    const watched = new Set(await watchlist());
    let n = 0;
    let lastDs = "";
    for (const b of j.results) {
      const t: string = b.T;
      if (!watched.has(t)) continue;
      const row = (
        await db.execute({
          sql: "SELECT last_close, running_peak, ewma_variance, drawdown_start, age_days, last_date FROM state WHERE ticker=?",
          args: [t],
        })
      ).rows[0] as any;
      if (!row || row.last_date >= ds) continue; // already processed this day
      const s = {
        prevClose: row.last_close, peak: row.running_peak, peakDate: row.drawdown_start,
        age: row.age_days, ewmaVar: row.ewma_variance,
      };
      const { dd } = step(s, ds, b.c);
      await db.execute({ sql: "INSERT OR REPLACE INTO history VALUES (?,?,?)", args: [t, ds, dd] });
      await persist(t, s, ds, b.c);
      n++;
      lastDs = ds;
    }
    if (n) console.log(`updated ${n} bars through ${lastDs}`);
  }
}

export async function stats() {
  return (await db.execute("SELECT * FROM state ORDER BY drawdown_percentile DESC")).rows;
}

export async function history(): Promise<Record<string, [string, number][]>> {
  const out: Record<string, [string, number][]> = {};
  for (const r of (await db.execute("SELECT ticker, date, dd FROM history ORDER BY date")).rows as any[])
    (out[r.ticker] ??= []).push([r.date, r.dd]);
  return out;
}