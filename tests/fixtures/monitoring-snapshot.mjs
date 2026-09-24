const point = (timeMs, value, minimum = value, maximum = value) => [timeMs, value, minimum, maximum];

const touchEvents = Array.from({ length: 20 }, (_, index) => {
  const startMs = 1_700_000_000_000 + index * 10_000;
  return {
    id: `mhs-operation-${index + 1}`,
    startMs,
    peakMs: startMs + 1_000,
    endMs: startMs + 2_000,
    peakValue: 2,
    peakRatio: 2,
    baseline: 1,
    threshold: 1.5,
  };
});

const touchPoints = touchEvents.map((event) => point(event.peakMs, event.peakValue));
const ordinaryPoint = point(1_700_000_000_000, 1, 0.5, 1.5);
const fridgePoints = [
  point(Date.parse("2026-07-31T12:00:00Z"), 4, 3, 4),
  point(Date.parse("2026-08-06T12:00:00Z"), 4, 3, 4),
];

const instrumentSourceNames = [
  ...Array.from({ length: 8 }, (_, index) => `AVS47_1_ch${index}`),
  ...Array.from({ length: 8 }, (_, index) => `AVS47_2_ch${index}`),
  ...Array.from({ length: 18 }, (_, index) => `TEMPERATURE${String(index + 1).padStart(2, "0")}`),
  "PRESSURE1",
];

const channels = instrumentSourceNames.map((sourceName) => {
  const id = sourceName.toLowerCase();
  const isTouch = sourceName === "AVS47_1_ch0";
  const isFridge = sourceName === "AVS47_1_ch4" || sourceName === "AVS47_1_ch6";
  return {
    id,
    sourceName,
    category: isTouch ? "touch" : sourceName === "PRESSURE1" ? "pressure" : "temperature",
    aggregation: isFridge ? "bucket_max_10m" : isTouch ? "bucket_max" : "mean",
    points: isTouch ? touchPoints : isFridge ? fridgePoints : [ordinaryPoint],
  };
});

for (const id of [
  "compressor1_the", "compressor1_tin", "compressor1_tout", "compressor1_pin", "compressor1_online",
  "compressor2_the", "compressor2_tin", "compressor2_tout", "compressor2_pin", "compressor2_online",
  "site_temperature", "site_humidity", "site_pressure", "site_wind_speed", "site_wind_direction",
]) {
  channels.push({ id, sourceName: id, category: id.startsWith("site_") ? "weather" : "compressor", points: [ordinaryPoint] });
}

const eventIds = [
  "beginning-of-data", "pumping", "ptc1-on", "ptc2-on", "pt1-s2-260k", "pt2-s2-260k",
  "pt1-s1-50k", "pt2-s1-50k", "pt1-s2-4p5k", "pt2-s2-4p5k", "main-cooldown-complete",
  "300mk-fridge-below-3k", "300mk-fridge-below-350mk", "1k-fridge-below-3k", "1k-fridge-below-1k", "base-1k",
];
const eventTimes = Object.fromEntries(eventIds.map((id, index) => [id, 1_700_000_000_000 + index * 1_000]));
eventTimes["pt1-s2-4p5k"] = 1_700_000_020_000;
eventTimes["pt2-s2-4p5k"] = 1_700_000_021_000;
eventTimes["main-cooldown-complete"] = eventTimes["pt2-s2-4p5k"];

export default {
  analysis: { engine: "python", schemaVersion: 1, generatedAtMs: 1_700_000_000_000 },
  channels,
  touchEvents,
  events: eventIds.map((id) => ({ id, timeMs: eventTimes[id] })),
};
