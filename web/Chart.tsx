import { useEffect, useState } from "react";

const API = (import.meta.env.DEV ? "/" : import.meta.env.BASE_URL) + "api";
const TFS: [string, number][] = [["1M", 21], ["3M", 63], ["6M", 126], ["1Y", 252], ["5Y", 1260], ["10Y", 2520], ["MAX", Infinity]];
const big = (v: number) => (Math.abs(v) >= 1e12 ? (v / 1e12).toFixed(1) + "T" : (v / 1e9).toFixed(1) + "B");

export function Chart({ ticker, onClose }: { ticker: string; onClose: () => void }) {
  const [data, setData] = useState<{ bars: [string, number][]; sales: [string, number][] }>();
  const [err, setErr] = useState("");
  const [tf, setTf] = useState("MAX");
  const [hover, setHover] = useState<number>(); // bar index under cursor

  useEffect(() => {
    setData(undefined);
    setErr("");
    fetch(`${API}/chart/${ticker}`)
      .then((r) => r.json())
      .then((d) => (d.error ? setErr(d.error) : setData(d)))
      .catch((e) => setErr(String(e)));
  }, [ticker]);

  const n = TFS.find(([k]) => k === tf)![1];
  const bars = data ? (n === Infinity ? data.bars : data.bars.slice(-n)) : [];
  const closes = bars.map(([, c]) => c);
  const min = Math.min(...closes), max = Math.max(...closes);
  const W = 1000, H = 320, pad = 6;
  const y = (v: number, lo: number, hi: number) => H - pad - ((v - lo) / (hi - lo || 1)) * (H - 2 * pad);
  const pts = closes.map((c, i) =>
    `${(i / Math.max(closes.length - 1, 1)) * W},${y(c, min, max)}`,
  ).join(" ");

  // sales: map each quarterly date to a bar index, draw as a step line on its own scale
  const first = bars[0]?.[0] ?? "", last = bars[bars.length - 1]?.[0] ?? "";
  const sales = data ? (data.sales ?? []).filter(([, v], i) => {
    const d = data.sales[i][0];
    return d <= last && (d >= first || data.sales[i + 1]?.[0] >= first); // keep one point before the window for continuity
  }) : [];
  const stepPts = sales.length > 1 && bars.length > 1
    ? sales.flatMap(([d, v], i) => {
        const j = Math.max(bars.findIndex(([bd]) => bd >= d), 0); // bar index at or after the report date
        const x = (j / Math.max(bars.length - 1, 1)) * W;
        const yy = y(v, Math.min(...sales.map(([, s]) => s)), Math.max(...sales.map(([, s]) => s)));
        const nx = sales[i + 1] && bars.findIndex(([bd]) => bd >= sales[i + 1][0]);
        return nx ? [`${x},${yy}`, `${Math.max(nx!, 0) / Math.max(bars.length - 1, 1) * W},${yy}`] : [`${x},${yy}`];
      }).join(" ")
    : "";
  const salesAt = hover != null && bars[hover] ? sales.findLast(([d]) => d <= bars[hover!][0]) : undefined;

  return (
    <>
      <header>
        <button className="x" onClick={onClose}>← back</button>{" "}
        <h1>{ticker} <span className="muted">{data ? `${data.bars.length}d` : ""}</span></h1>
      </header>
      {err && <p className="neg">{err}</p>}
      {!data && !err && <p className="muted">loading…</p>}
      {bars.length > 1 && (
        <>
          <div className="muted scale">
            <span>{max.toFixed(2)}</span>
            <span>{bars[0][0]} → {bars[bars.length - 1][0]}</span>
            <span>{min.toFixed(2)}</span>
          </div>
          <div className="chartwrap">
            <svg
              viewBox={`0 0 ${W} ${H}`}
              preserveAspectRatio="none"
              className="chart"
              onMouseMove={(e) => setHover(Math.min(Math.max(Math.round((e.nativeEvent.offsetX / e.currentTarget.clientWidth) * (bars.length - 1)), 0), bars.length - 1))}
              onMouseLeave={() => setHover(undefined)}
            >
              <polyline points={pts} fill="none" stroke="#e66" strokeWidth="1.5" />
              {stepPts && (
                <polyline points={stepPts} fill="none" stroke="#777" strokeWidth="1" strokeDasharray="4 3" />
              )}
              {hover != null && bars[hover] && (
                <line x1={(hover / Math.max(bars.length - 1, 1)) * W} y1={0} x2={(hover / Math.max(bars.length - 1, 1)) * W} y2={H} stroke="#555" strokeWidth="0.5" />
              )}
            </svg>
            {hover != null && bars[hover] && (
              <div className="tip">
                <b>{bars[hover][0]}</b> · close {bars[hover][1].toFixed(2)}
                {salesAt && <> · sales {big(salesAt[1])}</>}
              </div>
            )}
          </div>
          <div className="tfs">
            {TFS.map(([k]) => (
              <button key={k} onClick={() => setTf(k)} style={k === tf ? { background: "#555" } : undefined}>{k}</button>
            ))}
            {sales.length > 1 && (
              <span className="muted">sales (dashed): {big(Math.min(...sales.map(([, v]) => v)))} – {big(Math.max(...sales.map(([, v]) => v)))}</span>
            )}
          </div>
        </>
      )}
    </>
  );
}