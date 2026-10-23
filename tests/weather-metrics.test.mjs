import test from "node:test";
import assert from "node:assert/strict";
import { estimateSurfacePwvProxy } from "../scripts/weather-metrics.mjs";

test("surface PWV proxy is zero for dry air and positive for humid air", () => {
  assert.equal(estimateSurfacePwvProxy(0, 0, 550), 0);
  const humid = estimateSurfacePwvProxy(-5, 50, 550);
  assert.ok(humid > 0);
  assert.ok(humid < 20);
});

test("surface PWV proxy rejects invalid inputs and clamps relative humidity", () => {
  assert.equal(estimateSurfacePwvProxy(Number.NaN, 50, 550), null);
  assert.equal(estimateSurfacePwvProxy(0, 50, 0), null);
  assert.equal(estimateSurfacePwvProxy(0, -20, 550), 0);
  assert.equal(estimateSurfacePwvProxy(0, 120, 550), estimateSurfacePwvProxy(0, 100, 550));
});
