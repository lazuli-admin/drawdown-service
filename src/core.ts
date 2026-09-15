import "dotenv/config";
import { createClient } from "@libsql/client";
import { newSt, step, percentile } from "./math.ts";

const FMP = "https://financialmodelingprep.com/stable";
const KEY = process.env.FMP_API_KEY;
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
  drawdown_start TEXT, age_days INTEGER, recency_weight REAL, last_date TEXT, updated_at TEXT,
  sector TEXT DEFAULT '', industry TEXT DEFAULT '');
`);

// self-migrate: add columns missing from pre-existing state tables (SQLite has no ADD COLUMN IF NOT EXISTS)
const cols = new Set(((await db.execute("PRAGMA table_info(state)")).rows as any[]).map((r) => r.name));
for (const c of ["sector", "industry"]) {
  if (!cols.has(c)) await db.execute(`ALTER TABLE state ADD COLUMN ${c} TEXT DEFAULT ''`);
}

// the watchlist IS the state table — a ticker exists iff it has a state row
export const watchlist = async (): Promise<string[]> =>
  (await db.execute("SELECT ticker FROM state ORDER BY ticker")).rows.map((r: any) => r.ticker);

// FMP signals errors as HTTP 200 + {"Error Message": ...} — sniff the body
async function fmp(path: string, params: Record<string, string>): Promise<any> {
  if (!KEY) throw new Error("set FMP_API_KEY (npm run env:pull)");
  const r = await fetch(`${FMP}/${path}?${new URLSearchParams({ ...params, apikey: KEY })}`);
  const j: any = await r.json();
  if (j["Error Message"]) throw new Error(j["Error Message"]);
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return j;
}

const fmt = (d: Date) => d.toISOString().slice(0, 10);
const asc = (a: any, b: any) => String(a.date).localeCompare(String(b.date));

// pct optional: backfill holds the distribution in memory and passes it in.
async function persist(t: string, s: ReturnType<typeof newSt>, date: string, close: number, pct?: number, sector = "", industry = "") {
  const dd = close / s.peak - 1;
  const vol = Math.sqrt(s.ewmaVar);
  if (pct === undefined) {
    const n = (await db.execute({ sql: "SELECT count(*) n FROM history WHERE ticker=? AND date < ?", args: [t, date] })).rows[0]!.n as number;
    const below = (await db.execute({ sql: "SELECT count(*) n FROM history WHERE ticker=? AND date < ? AND abs(dd) <= ?", args: [t, date, Math.abs(dd)] })).rows[0]!.n as number;
    pct = n ? below / n : 0;
  }
  const recency = Math.exp(-Math.LN2 * s.age / HALF_LIFE);
  await db.execute({
    sql: "INSERT OR REPLACE INTO state VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    args: [t, close, s.peak, dd, pct, s.ewmaVar, vol, vol ? Math.abs(dd) / vol : 0, s.peakDate, s.age, recency, date, new Date().toISOString(), sector, industry],
  });
}

// Once per ticker: 30y of split-adjusted daily bars from FMP, computed fully in
// memory, written in batches. INSERT OR REPLACE makes a partial write self-heal.
export async function backfill(t: string) {
  const to = fmt(new Date());
  const from = fmt(new Date(Date.now() - YEARS * 365.25 * 864e5));
  const bars = await fmp("historical-price-eod/full", { symbol: t, from, to });
  const sorted = [...(Array.isArray(bars) ? bars : [])].sort(asc);
  const s = newSt();
  const rows: [string, number][] = [];
  for (const b of sorted) {
    const { dd } = step(s, String(b.date), b.close);
    rows.push([String(b.date), dd]);
  }
  if (!rows.length) throw new Error(`no price history from FMP for ${t}`);
  const dist = rows.slice(0, -1).map(([, dd]) => Math.abs(dd)); // percentile excludes the last day
  const pct = percentile(dist, Math.abs(rows[rows.length - 1][1]));

  // sector/industry: best-effort — a missing label must not fail the add
  let sector = "", industry = "";
  try {
    const p = await fmp("profile", { symbol: t });
    if (p[0]) ({ sector = "", industry = "" } = p[0]);
  } catch {}

  for (let i = 0; i < rows.length; i += 500) {
    await db.batch(
      rows.slice(i, i + 500).map(([date, dd]) => ({ sql: "INSERT OR REPLACE INTO history VALUES (?,?,?)", args: [t, date, dd] })),
      "write",
    );
  }
  await persist(t, s, rows[rows.length - 1][0], s.prevClose, pct, sector, industry);
  console.log(`backfilled ${t} through ${rows[rows.length - 1][0]} [${sector}/${industry}]`);
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

// Daily flow: per-ticker incremental range fetch (each ticker pulls bars after
// its own last_date — no shared cursor needed). FMP batch endpoints are paid, so
// one call per watchlist ticker per run.
// ponytail: N calls/day vs FMP free tier 250/day — fine under ~200 tickers; the daily cron post-close also limits accidental reruns
export async function daily() {
  const today = fmt(new Date());
  let n = 0;
  let lastDs = "";
  for (const t of await watchlist()) {
    const row = (
      await db.execute({
        sql: "SELECT last_close, running_peak, ewma_variance, drawdown_start, age_days, last_date, sector, industry FROM state WHERE ticker=?",
        args: [t],
      })
    ).rows[0] as any;
    if (!row || row.last_date >= today) continue;
    const bars = await fmp("historical-price-eod/full", { symbol: t, from: String(row.last_date), to: today });
    for (const b of [...(Array.isArray(bars) ? bars : [])].sort(asc)) {
      const ds = String(b.date);
      if (ds <= row.last_date) continue; // already processed
      const s = {
        prevClose: row.last_close, peak: row.running_peak, peakDate: row.drawdown_start,
        age: row.age_days, ewmaVar: row.ewma_variance,
      };
      const { dd } = step(s, ds, b.close);
      await db.execute({ sql: "INSERT OR REPLACE INTO history VALUES (?,?,?)", args: [t, ds, dd] });
      await persist(t, s, ds, b.close, undefined, row.sector, row.industry);
      n++;
      lastDs = ds;
    }
  }
  if (n) console.log(`updated ${n} bars through ${lastDs}`);
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