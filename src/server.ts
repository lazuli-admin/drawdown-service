import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import cron from "node-cron";
import { addTicker, removeTicker, stats, history, daily, chart, metricOptions } from "./core.ts";

const json = (res: any, code: number, body: any) => {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};
const readBody = (req: any) => new Promise<string>((ok) => { let b = ""; req.on("data", (c: string) => (b += c)); req.on("end", () => ok(b)); });

const server = createServer(async (req, res) => {
  const { pathname, method } = new URL(req.url!, "http://x");
  try {
    if (pathname === "/api/stats") return json(res, 200, { stats: await stats(), history: await history() });
    if (pathname === "/api/tickers" && req.method === "POST") {
      const { ticker } = JSON.parse(await readBody(req));
      await addTicker(ticker);
      return json(res, 200, { ok: true, ticker: ticker.trim().toUpperCase() });
    }
    const del = pathname.match(/^\/api\/tickers\/([A-Z.]+)$/);
    if (del && req.method === "DELETE") return json(res, 200, { ok: removeTicker(del[1]) });
    const ch = pathname.match(/^\/api\/chart\/([A-Z.]+)$/);
    if (ch) return json(res, 200, await chart(ch[1]));
    if (pathname === "/api/metrics") return json(res, 200, metricOptions());
    if (pathname === "/api/log" && req.method === "POST") {
      const { error, stack } = JSON.parse(await readBody(req));
      console.error("[web]", error, "\n", stack);
      return json(res, 200, { ok: true });
    }
    if (pathname === "/api/update" && req.method === "POST") {
      await daily();
      return json(res, 200, { ok: true, stats: await stats(), history: await history() });
    }
    // static SPA with fallback
    let f = "dist" + (pathname === "/" ? "/index.html" : pathname);
    if (!existsSync(f) || f === "dist/") f = "dist/index.html";
    res.writeHead(200, { "content-type": f.endsWith(".css") ? "text/css" : f.endsWith(".js") ? "text/javascript" : "text/html" });
    res.end(readFileSync(f));
  } catch (e: any) {
    json(res, 500, { error: String(e.message ?? e) });
  }
}).listen(8787, () => console.log("http://localhost:8787"));

// daily pull after market close — runs in-process. 00:30 ET Tue-Sat = the prior
// weekday's close, giving Massive ~13h to finalize the grouped day (their grouped
// endpoint can lag on the evening itself).
// ponytail: single in-memory scheduler; if it ever dies with the server, that's fine — restart = catch-up via min(last_date) cursor
cron.schedule("30 0 * * 2-6", () => {
  daily().catch((e) => console.error("scheduled daily failed:", e));
}, { timezone: "America/New_York" });
server.on("error", (e: any) => {
  console.error(e.code === "EADDRINUSE" ? "port 8787 busy — kill the old server first" : e);
  process.exit(1);
});