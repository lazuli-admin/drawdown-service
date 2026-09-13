export const LAMBDA = Math.exp(-Math.LN2 / 120);

export type St = {
  prevClose: number;
  peak: number;
  peakDate: string;
  age: number;
  ewmaVar: number;
};

export function newSt(): St {
  return { prevClose: NaN, peak: -Infinity, peakDate: "", age: 0, ewmaVar: 0 };
}

/** Advance one daily bar in place. Returns the day's (absolute) drawdown. */
export function step(s: St, date: string, close: number): { dd: number; absDD: number } {
  if (Number.isFinite(s.prevClose)) {
    const r = Math.log(close / s.prevClose);
    s.ewmaVar = LAMBDA * s.ewmaVar + (1 - LAMBDA) * r * r;
  }
  s.prevClose = close;
  if (close >= s.peak) {
    s.peak = close;
    s.peakDate = date;
    s.age = 0;
  } else {
    s.age++;
  }
  const dd = close / s.peak - 1;
  return { dd, absDD: Math.abs(dd) };
}

/** Fraction of the ticker's historical |drawdown| distribution at or below x. */
export function percentile(dist: number[], x: number): number {
  if (dist.length === 0) return 0;
  return dist.filter((v) => v <= x).length / dist.length;
}
