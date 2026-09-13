import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { addTicker, removeTicker, stats, history, daily } from "./core.ts";

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
server.on("error", (e: any) => {
  console.error(e.code === "EADDRINUSE" ? "port 8787 busy — kill the old server first" : e);
  process.exit(1);
});