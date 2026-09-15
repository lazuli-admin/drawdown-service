import { useEffect, useState } from "react";

type Row = {
  ticker: string;
  last_close: number;
  current_drawdown: number;
  sector: string;
  industry: string;
  drawdown_percentile: number;
  ewma_vol: number;
  normalized_drawdown: number;
  age_days: number;
  recency_weight: number;
  drawdown_start: string;
};
type Data = { stats: Row[]; history: Record<string, [string, number][]> };

// API paths honor the vite base when built (proxied under /labs/drawdowns in prod);
// dev server stays at root paths
const API = (import.meta.env.DEV ? "/" : import.meta.env.BASE_URL) + "api";

const pct = (v: number, d = 1) => (v * 100).toFixed(d);

function Spark({ dd }: { dd: [string, number][] }) {
  if (dd.length < 2) return null;
  const min = Math.min(...dd.map((p) => p[1]));
  const pts = dd
    .map((p, i) => `${(i / (dd.length - 1)) * 100},${(p[1] / min) * 28 + 1}`)
    .join(" ");
  return (
    <svg
      width="120"
      height="30"
      viewBox="0 0 100 30"
      preserveAspectRatio="none"
    >
      <polygon points={`0,1 ${pts} 100,1`} fill="#c33344" opacity=".4" />
      <polyline points={pts} fill="none" stroke="#e66" strokeWidth="1" />
    </svg>
  );
}

export function App() {
  const [data, setData] = useState<Data>();
  const [sym, setSym] = useState("");
  const [err, setErr] = useState("");

  // read = pure DB read, never touches the upstream API
  const load = async () => {
    try {
      setData(await (await fetch(API + "/stats")).json());
      setErr("");
    } catch (e) {
      setErr("api down: " + e);
    }
  };
  useEffect(() => {
    load();
  }, []);

  // explicit daily pull: grouped fetch -> recompute -> returns fresh stats
  const update = async () => {
    setErr("");
    try {
      const r = await fetch(API + "/update", { method: "POST" });
      if (!r.ok) setErr((await r.json()).error);
      else setData(await r.json());
    } catch (e) {
      setErr(String(e));
    }
  };

  const add = async () => {
    setErr("");
    try {
      const r = await fetch(API + "/tickers", {
        method: "POST",
        body: JSON.stringify({ ticker: sym }),
      });
      if (!r.ok) setErr((await r.json()).error);
      else {
        setSym("");
        await load();
      }
    } catch (e) {
      setErr(String(e));
    }
  };

  return (
    <>
      <header>
        <h1>drawdown scanner</h1>
        <input
          value={sym}
          placeholder="TICKER"
          onChange={(e) => setSym(e.target.value.toUpperCase())}
          onKeyDown={(e) => e.key === "Enter" && sym && add()}
        />
        <button onClick={add} disabled={!sym}>
          add
        </button>{" "}
        <button onClick={update}>update</button>
        {err && <p className="neg">{err}</p>}
      </header>
      <table>
        <thead>
          <tr>
            <th></th>
            <th>close</th>
            <th>dd</th>
            <th>pct</th>
            <th>sector</th>
            <th>normDD</th>
            <th>vol</th>
            <th>age</th>
            <th>recency</th>
            <th>since</th>
            <th>30y dd</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {(data?.stats ?? []).map((r) => (
            <tr key={r.ticker}>
              <td>
                <b>{r.ticker}</b>
              </td>
              <td>{r.last_close.toFixed(2)}</td>
              <td className="neg">{pct(r.current_drawdown, 2)}%</td>
              <td>
                <div
                  className="bar"
                  style={{ width: pct(r.drawdown_percentile, 0) + "px" }}
                />{" "}
                {pct(r.drawdown_percentile, 0)}%
              </td>
              <td className="muted sector" title={r.sector}>{r.industry || "—"}</td>
              <td>{r.normalized_drawdown.toFixed(2)}</td>
              <td>{r.ewma_vol.toFixed(4)}</td>
              <td>{r.age_days}d</td>
              <td>{r.recency_weight.toFixed(2)}</td>
              <td className="muted">{r.drawdown_start}</td>
              <td>
                <Spark dd={data?.history[r.ticker] ?? []} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {data && data.stats.length === 0 && (
        <p className="muted">no tickers yet — add one above</p>
      )}
    </>
  );
}
