// CLI: run the daily flow once and print the ranked table.
import { watchlist, backfill, daily, stats } from "./core.ts";

const have = new Set(((await stats()) as any[]).map((r) => r.ticker));
for (const t of await watchlist()) {
  if (!have.has(t)) await backfill(t);
}
await daily();

const h = "ticker  close      peak       dd        pct     vol      normDD  age  recency  since";
console.log(h);
const all = await stats();
for (const r of all as any[]) {
  console.log(
    `${r.ticker.padEnd(8)}${r.last_close.toFixed(2).padEnd(11)}${r.running_peak.toFixed(2).padEnd(11)}` +
    `${(r.current_drawdown * 100).toFixed(2).padEnd(10)}${r.drawdown_percentile.toFixed(3).padEnd(8)}` +
    `${r.ewma_vol.toFixed(4).padEnd(9)}${r.normalized_drawdown.toFixed(2).padEnd(8)}` +
    `${String(r.age_days).padEnd(5)}${r.recency_weight.toFixed(3).padEnd(9)}${r.drawdown_start}`,
  );
}