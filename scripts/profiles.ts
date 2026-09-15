// One-off: fill sector/industry for existing tickers (added before the FMP
// profile fetch existed). Usage: node scripts/profiles.ts
import "dotenv/config";
import { createClient } from "@libsql/client";

const db = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN!,
});
const KEY = process.env.FMP_API_KEY;
if (!KEY) throw new Error("set FMP_API_KEY (npm run env:pull)");

const rows = (await db.execute("SELECT ticker FROM state WHERE sector='' OR industry=''")).rows as any[];
console.log(`${rows.length} tickers missing profile data`);

for (const { ticker } of rows) {
  const r = await fetch(`https://financialmodelingprep.com/stable/profile?symbol=${ticker}&apikey=${KEY}`);
  const j: any = await r.json();
  if (j["Error Message"]) throw new Error(j["Error Message"]);
  const p = j[0] ?? {};
  await db.execute({
    sql: "UPDATE state SET sector=?, industry=? WHERE ticker=?",
    args: [p.sector ?? "", p.industry ?? "", ticker],
  });
  console.log(`${ticker}: [${p.sector}/${p.industry}]`);
}
console.log("done");