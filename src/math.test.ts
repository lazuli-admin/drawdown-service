import test from "node:test";
import assert from "node:assert";
import { LAMBDA, newSt, step, percentile } from "./math.ts";

test("first bar seeds peak, zero drawdown", () => {
  const s = newSt();
  const { dd } = step(s, "2024-01-02", 100);
  assert.equal(dd, 0);
  assert.equal(s.peak, 100);
});

test("drop updates ewma var, peak, age, drawdown", () => {
  const s = newSt();
  step(s, "2024-01-02", 100);
  step(s, "2024-01-03", 90);
  assert.equal(s.peak, 100);
  assert.equal(s.age, 1);
  assert.ok(Math.abs(s.ewmaVar - (1 - LAMBDA) * Math.log(0.9) ** 2) < 1e-12);
});

test("new peak resets age and drawdown start", () => {
  const s = newSt();
  step(s, "2024-01-02", 100);
  step(s, "2024-01-03", 90);
  const { dd } = step(s, "2024-01-04", 110);
  assert.equal(dd, 0);
  assert.equal(s.age, 0);
  assert.equal(s.peakDate, "2024-01-04");
});

test("percentile", () => {
  assert.equal(percentile([1, 2, 3, 4], 3), 0.75);
  assert.equal(percentile([], 5), 0);
});
