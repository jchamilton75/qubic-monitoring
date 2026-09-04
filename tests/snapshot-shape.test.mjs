import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const snapshot = JSON.parse(
  await readFile(new URL("../public/data/monitoring-snapshot.json", import.meta.url), "utf8"),
);

test("records the Python analysis contract used for the snapshot", () => {
  assert.equal(snapshot.analysis?.engine, "python");
  assert.equal(snapshot.analysis?.schemaVersion, 1);
  assert.ok(Number.isFinite(snapshot.analysis?.generatedAtMs));
});

test("exports an extrema pair for every plotted channel", () => {
  const populated = snapshot.channels.filter((channel) => channel.points.length);
  assert.ok(populated.length > 0, "snapshot contains no plotted channels");
  for (const channel of populated) {
    for (const point of channel.points) {
      assert.ok(point.length >= 4, `${channel.id} point is missing min/max values`);
      assert.ok(Number.isFinite(point[2]), `${channel.id} point has a non-finite minimum`);
      assert.ok(Number.isFinite(point[3]), `${channel.id} point has a non-finite maximum`);
      assert.ok(point[2] <= point[3], `${channel.id} point extrema are inverted`);
    }
  }
});

test("publishes the complete requested telemetry catalogue", () => {
  const bySourceName = new Map(snapshot.channels.map((channel) => [channel.sourceName, channel]));
  const requiredInstrumentSources = [
    ...Array.from({ length: 8 }, (_, index) => `AVS47_1_ch${index}`),
    ...Array.from({ length: 8 }, (_, index) => `AVS47_2_ch${index}`),
    ...Array.from({ length: 18 }, (_, index) => `TEMPERATURE${String(index + 1).padStart(2, "0")}`),
    "PRESSURE1",
  ];

  for (const sourceName of requiredInstrumentSources) {
    assert.ok(bySourceName.has(sourceName), `missing catalogue entry ${sourceName}`);
  }

  assert.equal(bySourceName.get("AVS47_1_ch0").category, "touch");
  assert.equal(bySourceName.get("PRESSURE1").category, "pressure");
  assert.equal(bySourceName.get("TEMPERATURE18").category, "temperature");
});

test("publishes compressor and site-weather telemetry", () => {
  const ids = new Set(snapshot.channels.map((channel) => channel.id));
  for (const id of [
    "compressor1_the", "compressor1_pin", "compressor1_online",
    "compressor2_the", "compressor2_pin", "compressor2_online",
    "site_temperature", "site_humidity", "site_pressure",
    "site_wind_speed", "site_wind_direction",
  ]) {
    assert.ok(ids.has(id), `missing telemetry series ${id}`);
  }
});

test("preserves brief Touch openings with per-bucket maxima", () => {
  const touch = snapshot.channels.find((channel) => channel.id === "avs47_1_ch0");
  assert.ok(touch, "missing Touch channel");
  assert.ok(touch.points.every((point) => Number.isFinite(point[1])), "Touch export contains a non-finite value");
  assert.ok(Math.max(...touch.points.map((point) => point[1])) > 1, "Touch maxima were averaged away or filtered out");
  assert.ok(snapshot.touchEvents.length >= 20, "small MHS open/close operations were not detected");
  assert.ok(snapshot.touchEvents.every((event) => event.endMs > event.startMs), "invalid MHS operation duration");
  assert.ok(snapshot.touchEvents.every((event) => event.peakValue >= event.threshold), "MHS event below its detection threshold");
  assert.ok(snapshot.touchEvents.every((event) => event.peakRatio >= 1.08), "MHS event below the relative detection threshold");
  assert.ok(snapshot.touchEvents.every((event) => touch.points.some((point) => point[0] === event.peakMs && point[1] === event.peakValue)), "MHS marker is not aligned with its plotted Touch peak");
});

test("preserves fridge-cycle peaks at a uniform resolution", () => {
  const oneKelvinFridge = snapshot.channels.find((channel) => channel.id === "avs47_1_ch4");
  const fridge300mK = snapshot.channels.find((channel) => channel.id === "avs47_1_ch6");
  for (const channel of [oneKelvinFridge, fridge300mK]) {
    assert.ok(channel, "missing fridge cold-head channel");
    assert.equal(channel.aggregation, "bucket_max_10m", "fridge channel is not peak-preserving");
    assert.ok(channel.points.every(([timeMs]) => timeMs % 600_000 === 0), "fridge points do not use uniform 10-minute buckets");
  }
  const dailyPeak = (day) => {
    const startMs = Date.parse(`${day}T00:00:00+02:00`);
    const values = fridge300mK.points.filter(([timeMs]) => timeMs >= startMs && timeMs < startMs + 86_400_000).map(([, value]) => value);
    return Math.max(...values);
  };
  assert.ok(dailyPeak("2026-07-31") > 3.4, "historical 300 mK fridge peak was averaged away");
  assert.ok(dailyPeak("2026-08-06") > 3.4, "recent 300 mK fridge peak is missing");
});

test("publishes the complete cryogenic timeline", () => {
  const events = new Map(snapshot.events.map((event) => [event.id, event]));
  const requiredEvents = [
    "beginning-of-data",
    "pumping",
    "ptc1-on",
    "ptc2-on",
    "pt1-s2-260k",
    "pt2-s2-260k",
    "pt1-s1-50k",
    "pt2-s1-50k",
    "pt1-s2-4p5k",
    "pt2-s2-4p5k",
    "main-cooldown-complete",
    "300mk-fridge-below-3k",
    "300mk-fridge-below-350mk",
    "1k-fridge-below-3k",
    "1k-fridge-below-1k",
    "base-1k",
  ];

  for (const id of requiredEvents) assert.ok(events.has(id), `missing cryogenic event ${id}`);

  assert.equal(
    events.get("main-cooldown-complete").timeMs,
    Math.max(events.get("pt1-s2-4p5k").timeMs, events.get("pt2-s2-4p5k").timeMs),
  );
});
