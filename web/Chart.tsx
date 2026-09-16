import { useEffect, useState } from "react";

const API = (import.meta.env.DEV ? "/" : import.meta.env.BASE_URL) + "api";
const TFS: [string, number][] = [["1M", 21], ["3M", 63], ["6M", 126], ["1Y", 252], ["5Y", 1260], ["10Y", 2520], ["MAX", Infinity]];

export function Chart({ ticker, onClose }: { ticker: string; onClose: () => void }) {
  const [data, setData] = useState<{ bars: [string, number][]; series: Record<string, [string, number][]> }>();
  const [options, setOptions] = useState<{ key: string; label: string }[]>();
  const [err, setErr] = useState("");
  const [tf, setTf] = useState("MAX");
  const [metric, setMetric] = useState("revenue");
  const [hover, setHover] = useState<number>(); // bar index under cursor

  useEffect(() => {
    setData(undefined);
    setErr("");
    Promise.all([
      fetch(`${API}/chart/${ticker}`).then((r) => r.json()),
      fetch(`${API}/metrics`).then((r) => r.json()),
    ])
      .then(([d, o]) => {
        if (d.error) setErr(d.error);
        else {
          setData(d);
          setOptions(o);
        }
      })
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

  const label = options?.find((o) => o.key === metric)?.label ?? metric;
  const isPct = metric.endsWith("Margin");
  const fmtV = (v: number) => (isPct ? (v * 100).toFixed(1) + "%" : Math.abs(v) >= 1e9 ? (v / 1e9).toFixed(1) + "B" : Math.abs(v) >= 1e6 ? (v / 1e6).toFixed(1) + "M" : v.toFixed(2));

  // selected metric: quarterly points mapped onto bar indices, step line on its own scale
  const first = bars[0]?.[0] ?? "", last = bars[bars.length - 1]?.[0] ?? "";
  const series = data ? (data.series[metric] ?? []).filter(([, v], i) => {
    const d = data.series[metric][i][0];
    return d <= last && (d >= first || data.series[metric][i + 1]?.[0] >= first); // keep one point before the window for continuity
  }) : [];
  const stepPts = series.length > 1 && bars.length > 1
    ? series.flatMap(([d, v], i) => {
        const j = Math.max(bars.findIndex(([bd]) => bd >= d), 0); // bar index at or after the report date
        const x = (j / Math.max(bars.length - 1, 1)) * W;
        const yy = y(v, Math.min(...series.map(([, s]) => s)), Math.max(...series.map(([, s]) => s)));
        const nx = series[i + 1] && bars.findIndex(([bd]) => bd >= series[i + 1][0]);
        return nx ? [`${x},${yy}`, `${Math.max(nx!, 0) / Math.max(bars.length - 1, 1) * W},${yy}`] : [`${x},${yy}`];
      }).join(" ")
    : "";
  const seriesAt = hover != null && bars[hover] ? series.findLast(([d]) => d <= bars[hover!][0]) : undefined;

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
                {seriesAt && <> · {label} {fmtV(seriesAt[1])}</>}
              </div>
            )}
          </div>
          <div className="tfs">
            {TFS.map(([k]) => (
              <button key={k} onClick={() => setTf(k)} style={k === tf ? { background: "#555" } : undefined}>{k}</button>
            ))}
            {series.length > 1 && (
              <span className="muted">{label} (dashed): {fmtV(Math.min(...series.map(([, v]) => v)))} – {fmtV(Math.max(...series.map(([, v]) => v)))}</span>
            )}
          </div>
          <div className="tfs">
            {(options ?? []).map((o) => (
              <button key={o.key} onClick={() => setMetric(o.key)} style={o.key === metric ? { background: "#555" } : undefined}>{o.label}</button>
            ))}
          </div>
        </>
      )}
    </>
  );
}