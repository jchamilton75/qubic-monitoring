#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  closeSync,
  createReadStream,
  existsSync,
  mkdirSync,
  openSync,
  readSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectDirectory = resolve(scriptDirectory, "..");
const archiveDirectory = resolve(projectDirectory, "..");
const localDirectory = join(projectDirectory, ".local");
const sourceDirectoryName = process.env.QUBIC_COOLDOWN_DIR ?? "June2026";
const cooldownLabel = process.env.QUBIC_COOLDOWN_LABEL ?? "June 2026";
const cooldownId = sourceDirectoryName
  .replace(/([a-z])([A-Z])/g, "$1-$2")
  .replace(/[^a-zA-Z0-9]+/g, "-")
  .toLowerCase();
const databasePath = join(localDirectory, `qubic-monitoring-${cooldownId}-v2.sqlite`);
const snapshotPath = join(projectDirectory, "public", "data", "monitoring-snapshot.json");
const statusPath = join(projectDirectory, "public", "data", "monitoring-status.json");
const storageBucketMs = 30_000;
const fridgePeakBucketMs = 10 * 60_000;
const peakPreservingChannelIds = new Set(["avs47_1_ch4", "avs47_1_ch6"]);

const cooldown = {
  id: cooldownId,
  label: cooldownLabel,
  startTimeMs: Date.parse("2026-06-09T00:00:00Z"),
  status: "active",
};

const palette = [
  "#ffb44b", "#70d6c7", "#8fa7ff", "#e77dff", "#f87171", "#f9d56e",
  "#68b9ff", "#a7e36f", "#ff8fb3", "#a78bfa", "#fb923c", "#22d3ee",
];

const instrumentDefinitions = [
  ["AVS47_1_ch0", "Touch"],
  ["AVS47_1_ch1", "1K stage"],
  ["AVS47_1_ch2", "TES stage"],
  ["AVS47_1_ch3", "M1"],
  ["AVS47_1_ch4", "1K fridge CH"],
  ["AVS47_1_ch5", "Film breaker"],
  ["AVS47_1_ch6", "0.3K fridge CH"],
  ["AVS47_1_ch7", "M2"],
  ["AVS47_2_ch0", "PT2 S2 CH"],
  ["AVS47_2_ch1", "PT1 S2 CH"],
  ["AVS47_2_ch2", "Fridge plate MHS"],
  ["AVS47_2_ch3", "1K HS"],
  ["AVS47_2_ch4", "4K shield Cu braids"],
  ["AVS47_2_ch5", "AVS47_2 ch5"],
  ["AVS47_2_ch6", "AVS47_2 ch6"],
  ["AVS47_2_ch7", "AVS47_2 ch7"],
  ["TEMPERATURE01", "40K filters"],
  ["TEMPERATURE02", "40K sd"],
  ["TEMPERATURE03", "40K sr"],
  ["TEMPERATURE04", "PT2 s1"],
  ["TEMPERATURE05", "PT1 s1"],
  ["TEMPERATURE06", "4K filters"],
  ["TEMPERATURE07", "HWP1"],
  ["TEMPERATURE08", "HWP2"],
  ["TEMPERATURE09", "4K sd"],
  ["TEMPERATURE10", "4K PT2 CH"],
  ["TEMPERATURE11", "PT1 s2"],
  ["TEMPERATURE12", "PT2 s2"],
  ["TEMPERATURE13", "300mK-4CP-D-1"],
  ["TEMPERATURE14", "300mK-4HS-D-1"],
  ["TEMPERATURE15", "300mK-3CP-D-1"],
  ["TEMPERATURE16", "300mK-3HS-D-1"],
  ["TEMPERATURE17", "1K-4HS-D-1"],
  ["TEMPERATURE18", "1K-4CP-D-1"],
  ["PRESSURE1", "PRESSURE"],
];

function channelId(sourceName) {
  return sourceName.toLowerCase();
}

const channelDefinitions = instrumentDefinitions.map(([sourceName, label], index) => {
  const category = sourceName === "AVS47_1_ch0"
    ? "touch"
    : sourceName === "PRESSURE1"
      ? "pressure"
      : "temperature";
  return {
    id: channelId(sourceName),
    sourceName,
    source: `${sourceDirectoryName}/${sourceName}.txt`,
    label,
    shortLabel: label,
    group: category === "temperature" ? "Instrument temperatures" : category === "touch" ? "Touch" : "Vacuum",
    category,
    unit: category === "temperature" ? "K" : category === "pressure" ? "mbar" : "raw",
    color: palette[index % palette.length],
    validMin: category === "temperature" ? 0 : category === "pressure" ? 0 : -1,
    validMax: category === "temperature" ? 400 : category === "pressure" ? 2_000 : category === "touch" ? Number.MAX_VALUE : 1,
  };
});

const extraChannels = [
  ["inside_temperature", "Inside temperature", "inside_weather.txt", "weather", "°C", -50, 70, "#f9d56e"],
  ["inside_humidity", "Inside humidity", "inside_weather.txt", "weather", "%", 0, 100, "#68b9ff"],
  ["site_temperature", "Site temperature", "weather.txt", "weather", "°C", -60, 60, "#ffb44b"],
  ["site_humidity", "Site humidity", "weather.txt", "weather", "%", 0, 100, "#68b9ff"],
  ["site_pressure", "Site atmospheric pressure", "weather.txt", "weather", "mbar", 400, 800, "#a7e36f"],
  ["site_wind_speed", "Wind speed", "weather.txt", "weather", "km/h", 0, 250, "#e77dff"],
  ["site_wind_direction", "Wind direction", "weather.txt", "weather", "°", 0, 360, "#70d6c7"],
  ["compressor1_the", "Compressor 1 · THe", "compressor1_log.txt", "compressor", "K", 0, 150, "#ffb44b"],
  ["compressor1_tout", "Compressor 1 · Tout", "compressor1_log.txt", "compressor", "K", -40, 150, "#70d6c7"],
  ["compressor1_tin", "Compressor 1 · Tin", "compressor1_log.txt", "compressor", "K", -40, 150, "#8fa7ff"],
  ["compressor1_pin", "Compressor 1 · Pin", "compressor1_log.txt", "compressor", "bar", 0, 40, "#f87171"],
  ["compressor1_hours", "Compressor 1 · hours", "compressor1_log.txt", "compressor", "h", 0, 100_000, "#a7e36f"],
  ["compressor1_online", "Compressor 1 · online", "compressor1_log.txt", "compressor_status", "state", 0, 1, "#a7e36f"],
  ["compressor2_the", "Compressor 2 · THe", "compressor2_log.txt", "compressor", "K", 0, 150, "#fb923c"],
  ["compressor2_tout", "Compressor 2 · Tout", "compressor2_log.txt", "compressor", "K", -40, 150, "#22d3ee"],
  ["compressor2_tin", "Compressor 2 · Tin", "compressor2_log.txt", "compressor", "K", -40, 150, "#a78bfa"],
  ["compressor2_pin", "Compressor 2 · Pin", "compressor2_log.txt", "compressor", "bar", 0, 40, "#ff8fb3"],
  ["compressor2_hours", "Compressor 2 · hours", "compressor2_log.txt", "compressor", "h", 0, 100_000, "#a7e36f"],
  ["compressor2_online", "Compressor 2 · online", "compressor2_log.txt", "compressor_status", "state", 0, 1, "#a7e36f"],
].map(([id, label, fileName, category, unit, validMin, validMax, color]) => ({
  id,
  sourceName: fileName.replace(/\.txt$/, ""),
  source: `${sourceDirectoryName}/${fileName}`,
  label,
  shortLabel: label,
  group: category === "weather" ? "Environment" : "Compressors",
  category,
  unit,
  color,
  validMin,
  validMax,
}));

channelDefinitions.push(...extraChannels);
const channelsById = new Map(channelDefinitions.map((channel) => [channel.id, channel]));

function scalarSource(channel) {
  return {
    id: channel.id,
    revision: channel.category === "touch" ? 3 : 1,
    source: channel.source,
    channelIds: [channel.id],
    parse(line) {
      const fields = line.trim().split(/\s+/);
      return [{ channelId: channel.id, timeMs: Number(fields[0]) * 1000, value: Number(fields[1]) }];
    },
  };
}

const sourceDefinitions = channelDefinitions
  .filter((channel) => ["temperature", "touch", "pressure"].includes(channel.category))
  .map(scalarSource);

sourceDefinitions.push(
  {
    id: "inside_weather",
    source: `${sourceDirectoryName}/inside_weather.txt`,
    channelIds: ["inside_temperature", "inside_humidity"],
    parse(line) {
      const fields = line.trim().split(/\s+/).map(Number);
      const timeMs = fields[0] * 1000;
      return [
        { channelId: "inside_temperature", timeMs, value: fields[1] },
        { channelId: "inside_humidity", timeMs, value: fields[2] },
      ];
    },
  },
  {
    id: "site_weather",
    source: `${sourceDirectoryName}/weather.txt`,
    channelIds: ["site_temperature", "site_humidity", "site_pressure", "site_wind_speed", "site_wind_direction"],
    parse(line) {
      const fields = line.trim().split(/\s+/).map(Number);
      const timeMs = fields[0] * 1000;
      return [
        { channelId: "site_temperature", timeMs, value: fields[1] },
        { channelId: "site_humidity", timeMs, value: fields[2] },
        { channelId: "site_pressure", timeMs, value: fields[3] },
        { channelId: "site_wind_speed", timeMs, value: fields[4] },
        { channelId: "site_wind_direction", timeMs, value: fields[5] },
      ];
    },
  },
);

for (const compressorNumber of [1, 2]) {
  sourceDefinitions.push({
    id: `compressor${compressorNumber}`,
    source: `${sourceDirectoryName}/compressor${compressorNumber}_log.txt`,
    channelIds: ["the", "tout", "tin", "pin", "hours", "online"].map((name) => `compressor${compressorNumber}_${name}`),
    parse(line) {
      const match = line.match(/^(\S+)\s+UT\s+-\s+(.*)$/);
      if (!match) return [];
      const timeMs = Date.parse(`${match[1]}Z`);
      if (match[2].includes("OFFLINE")) {
        return [{ channelId: `compressor${compressorNumber}_online`, timeMs, value: 0 }];
      }
      const values = match[2].match(/T_He=([^\s]+)\s+Tout=([^\s]+)\s+Tin=([^\s]+)\s+Pin=([^\s]+)\s+Hours=([^\s]+)/);
      if (!values) return [];
      return [
        { channelId: `compressor${compressorNumber}_the`, timeMs, value: Number(values[1]) },
        { channelId: `compressor${compressorNumber}_tout`, timeMs, value: Number(values[2]) },
        { channelId: `compressor${compressorNumber}_tin`, timeMs, value: Number(values[3]) },
        { channelId: `compressor${compressorNumber}_pin`, timeMs, value: Number(values[4]) },
        { channelId: `compressor${compressorNumber}_hours`, timeMs, value: Number(values[5]) },
        { channelId: `compressor${compressorNumber}_online`, timeMs, value: 1 },
      ];
    },
  });
}

function initializeDatabase(database) {
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;

    CREATE TABLE IF NOT EXISTS cooldowns (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      start_time_ms INTEGER NOT NULL,
      status TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS channels (
      id TEXT PRIMARY KEY,
      cooldown_id TEXT NOT NULL,
      source_path TEXT NOT NULL,
      source_name TEXT NOT NULL,
      label TEXT NOT NULL,
      short_label TEXT NOT NULL,
      group_name TEXT NOT NULL,
      category TEXT NOT NULL,
      unit TEXT NOT NULL,
      color TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS aggregates (
      channel_id TEXT NOT NULL,
      bucket_ms INTEGER NOT NULL,
      first_at_ms INTEGER NOT NULL,
      last_at_ms INTEGER NOT NULL,
      sum_value REAL NOT NULL DEFAULT 0,
      min_value REAL,
      max_value REAL,
      max_at_ms INTEGER,
      sample_count INTEGER NOT NULL DEFAULT 0,
      suspect_count INTEGER NOT NULL DEFAULT 0,
      invalid_count INTEGER NOT NULL DEFAULT 0,
      last_value REAL,
      PRIMARY KEY (channel_id, bucket_ms)
    ) WITHOUT ROWID;

    CREATE INDEX IF NOT EXISTS idx_aggregates_channel_time
    ON aggregates(channel_id, bucket_ms);

    CREATE TABLE IF NOT EXISTS ingestion_state (
      source_id TEXT PRIMARY KEY,
      source_generation INTEGER NOT NULL DEFAULT 0,
      source_revision INTEGER NOT NULL DEFAULT 1,
      source_offset INTEGER NOT NULL DEFAULT 0,
      source_size INTEGER NOT NULL DEFAULT 0,
      source_head_hash TEXT NOT NULL,
      last_seen_ms INTEGER NOT NULL,
      malformed_lines INTEGER NOT NULL DEFAULT 0,
      invalid_values INTEGER NOT NULL DEFAULT 0
    );
  `);

  const ingestionColumns = new Set(database.prepare("PRAGMA table_info(ingestion_state)").all().map((column) => column.name));
  if (!ingestionColumns.has("source_revision")) {
    database.exec("ALTER TABLE ingestion_state ADD COLUMN source_revision INTEGER NOT NULL DEFAULT 1");
  }

  const aggregateColumns = new Set(database.prepare("PRAGMA table_info(aggregates)").all().map((column) => column.name));
  if (!aggregateColumns.has("max_at_ms")) {
    database.exec("ALTER TABLE aggregates ADD COLUMN max_at_ms INTEGER");
  }

  database.prepare(`
    INSERT INTO cooldowns (id, label, start_time_ms, status)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET label=excluded.label, start_time_ms=excluded.start_time_ms, status=excluded.status
  `).run(cooldown.id, cooldown.label, cooldown.startTimeMs, cooldown.status);

  const upsert = database.prepare(`
    INSERT INTO channels (id, cooldown_id, source_path, source_name, label, short_label, group_name, category, unit, color)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      source_path=excluded.source_path, source_name=excluded.source_name, label=excluded.label,
      short_label=excluded.short_label, group_name=excluded.group_name, category=excluded.category,
      unit=excluded.unit, color=excluded.color
  `);
  for (const channel of channelDefinitions) {
    upsert.run(channel.id, cooldown.id, channel.source, channel.sourceName, channel.label,
      channel.shortLabel, channel.group, channel.category, channel.unit, channel.color);
  }
}

function hashFileHead(path, size) {
  const descriptor = openSync(path, "r");
  try {
    const buffer = Buffer.alloc(Math.min(65_536, size));
    const bytesRead = readSync(descriptor, buffer, 0, buffer.length, 0);
    return createHash("sha256").update(buffer.subarray(0, bytesRead)).digest("hex");
  } finally {
    closeSync(descriptor);
  }
}

async function* completeLines(path, startOffset) {
  const stream = createReadStream(path, { start: startOffset });
  let carry = Buffer.alloc(0);
  let position = startOffset;
  for await (const chunk of stream) {
    const data = carry.length ? Buffer.concat([carry, chunk]) : chunk;
    let lineStart = 0;
    let newlineIndex = data.indexOf(10, lineStart);
    while (newlineIndex !== -1) {
      let lineBuffer = data.subarray(lineStart, newlineIndex);
      if (lineBuffer.at(-1) === 13) lineBuffer = lineBuffer.subarray(0, -1);
      const consumedBytes = newlineIndex - lineStart + 1;
      yield { line: lineBuffer.toString("utf8"), nextOffset: position + consumedBytes };
      position += consumedBytes;
      lineStart = newlineIndex + 1;
      newlineIndex = data.indexOf(10, lineStart);
    }
    carry = data.subarray(lineStart);
  }
}

async function ingestSource(database, source) {
  const sourcePath = join(archiveDirectory, source.source);
  if (!existsSync(sourcePath)) return { sourceId: source.id, status: "missing", inserted: 0 };

  const fileStat = statSync(sourcePath);
  const headHash = hashFileHead(sourcePath, fileStat.size);
  const previous = database.prepare("SELECT * FROM ingestion_state WHERE source_id = ?").get(source.id);
  const revision = Number(source.revision ?? 1);
  let generation = Number(previous?.source_generation ?? 0);
  let startOffset = Number(previous?.source_offset ?? 0);

  if (previous && (fileStat.size < startOffset || previous.source_head_hash !== headHash || Number(previous.source_revision ?? 1) !== revision)) {
    generation += 1;
    startOffset = 0;
    const placeholders = source.channelIds.map(() => "?").join(",");
    database.prepare(`DELETE FROM aggregates WHERE channel_id IN (${placeholders})`).run(...source.channelIds);
  }
  if (startOffset === fileStat.size) return { sourceId: source.id, status: "unchanged", inserted: 0 };

  const upsertAggregate = database.prepare(`
    INSERT INTO aggregates (
      channel_id, bucket_ms, first_at_ms, last_at_ms, sum_value, min_value, max_value, max_at_ms,
      sample_count, suspect_count, invalid_count, last_value
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(channel_id, bucket_ms) DO UPDATE SET
      first_at_ms=MIN(aggregates.first_at_ms, excluded.first_at_ms),
      last_at_ms=MAX(aggregates.last_at_ms, excluded.last_at_ms),
      sum_value=aggregates.sum_value + excluded.sum_value,
      min_value=CASE WHEN aggregates.min_value IS NULL THEN excluded.min_value WHEN excluded.min_value IS NULL THEN aggregates.min_value ELSE MIN(aggregates.min_value, excluded.min_value) END,
      max_at_ms=CASE
        WHEN aggregates.max_value IS NULL THEN excluded.max_at_ms
        WHEN excluded.max_value IS NULL THEN aggregates.max_at_ms
        WHEN excluded.max_value > aggregates.max_value THEN excluded.max_at_ms
        ELSE aggregates.max_at_ms
      END,
      max_value=CASE WHEN aggregates.max_value IS NULL THEN excluded.max_value WHEN excluded.max_value IS NULL THEN aggregates.max_value ELSE MAX(aggregates.max_value, excluded.max_value) END,
      sample_count=aggregates.sample_count + excluded.sample_count,
      suspect_count=aggregates.suspect_count + excluded.suspect_count,
      invalid_count=aggregates.invalid_count + excluded.invalid_count,
      last_value=CASE WHEN excluded.last_at_ms >= aggregates.last_at_ms AND excluded.last_value IS NOT NULL THEN excluded.last_value ELSE aggregates.last_value END
  `);
  const updateState = database.prepare(`
    INSERT INTO ingestion_state (source_id, source_generation, source_revision, source_offset, source_size, source_head_hash, last_seen_ms, malformed_lines, invalid_values)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_id) DO UPDATE SET
      source_generation=excluded.source_generation, source_revision=excluded.source_revision, source_offset=excluded.source_offset,
      source_size=excluded.source_size, source_head_hash=excluded.source_head_hash,
      last_seen_ms=excluded.last_seen_ms,
      malformed_lines=ingestion_state.malformed_lines + excluded.malformed_lines,
      invalid_values=ingestion_state.invalid_values + excluded.invalid_values
  `);

  const pending = new Map();
  let finalOffset = startOffset;
  let malformed = 0;
  let invalid = 0;
  let inserted = 0;

  function addRecord(record) {
    const channel = channelsById.get(record.channelId);
    if (!channel || !Number.isFinite(record.timeMs) || record.timeMs < 946_684_800_000) {
      malformed += 1;
      return;
    }
    const bucketMs = Math.floor(record.timeMs / storageBucketMs) * storageBucketMs;
    const key = `${record.channelId}:${bucketMs}`;
    const aggregate = pending.get(key) ?? {
      channelId: record.channelId, bucketMs, firstAtMs: record.timeMs, lastAtMs: record.timeMs,
      sum: 0, min: null, max: null, maxAtMs: null, count: 0, suspect: 0, invalid: 0, lastValue: null,
    };
    aggregate.firstAtMs = Math.min(aggregate.firstAtMs, record.timeMs);
    aggregate.lastAtMs = Math.max(aggregate.lastAtMs, record.timeMs);
    if (!Number.isFinite(record.value)) {
      aggregate.invalid += 1;
      invalid += 1;
    } else if (record.value < channel.validMin || record.value > channel.validMax) {
      aggregate.suspect += 1;
    } else {
      aggregate.sum += record.value;
      aggregate.min = aggregate.min === null ? record.value : Math.min(aggregate.min, record.value);
      if (aggregate.max === null || record.value > aggregate.max) {
        aggregate.max = record.value;
        aggregate.maxAtMs = record.timeMs;
      }
      aggregate.count += 1;
      aggregate.lastValue = record.value;
    }
    pending.set(key, aggregate);
  }

  function flush() {
    for (const aggregate of pending.values()) {
      upsertAggregate.run(aggregate.channelId, aggregate.bucketMs, aggregate.firstAtMs,
        aggregate.lastAtMs, aggregate.sum, aggregate.min, aggregate.max, aggregate.maxAtMs, aggregate.count,
        aggregate.suspect, aggregate.invalid, aggregate.lastValue);
      inserted += 1;
    }
    pending.clear();
  }

  database.exec("BEGIN");
  try {
    for await (const record of completeLines(sourcePath, startOffset)) {
      finalOffset = record.nextOffset;
      const parsed = source.parse(record.line);
      if (!parsed.length) {
        malformed += 1;
      } else {
        for (const item of parsed) addRecord(item);
      }
      if (pending.size >= 5_000) flush();
    }
    flush();
    updateState.run(source.id, generation, revision, finalOffset, fileStat.size, headHash, Date.now(), malformed, invalid);
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }

  return { sourceId: source.id, status: "updated", inserted, malformed, invalid };
}

function detectEvents(database) {
  const beginningOfData = database.prepare(`
    SELECT MIN(first_at_ms) AS timeMs
    FROM aggregates
    WHERE sample_count > 0
  `).get();
  const firstBelow = database.prepare(`
    SELECT first_at_ms AS timeMs
    FROM aggregates
    WHERE channel_id = ? AND sample_count > 0 AND (sum_value / sample_count) <= ?
    ORDER BY bucket_ms ASC LIMIT 1
  `);
  const firstAbove = database.prepare(`
    SELECT first_at_ms AS timeMs
    FROM aggregates
    WHERE channel_id = ? AND sample_count > 0 AND (sum_value / sample_count) >= ?
    ORDER BY bucket_ms ASC LIMIT 1
  `);
  const pressureBelow300 = firstBelow.get("pressure1", 300);
  const ptc1On = firstAbove.get("compressor1_online", 0.5);
  const ptc2On = firstAbove.get("compressor2_online", 0.5);
  const pt1S2Below260 = firstBelow.get("avs47_2_ch1", 260);
  const pt2S2Below260 = firstBelow.get("avs47_2_ch0", 260);
  const pt1S1Below50 = firstBelow.get("temperature05", 50);
  const pt2S1Below50 = firstBelow.get("temperature04", 50);
  const pt1S2Below4p5 = firstBelow.get("avs47_2_ch1", 4.5);
  const pt2S2Below4p5 = firstBelow.get("avs47_2_ch0", 4.5);
  const fridge300mKBelow3 = firstBelow.get("avs47_1_ch6", 3);
  const fridge300mKBelow350mK = firstBelow.get("avs47_1_ch6", 0.35);
  const fridge1KBelow3 = firstBelow.get("avs47_1_ch4", 3);
  const fridge1KBelow1 = firstBelow.get("avs47_1_ch4", 1);
  const base1k = firstBelow.get("avs47_1_ch1", 1.2);
  const event = (id, type, label, description, detection) => ({
    id,
    type,
    label,
    description,
    timeMs: detection ? Number(detection.timeMs) : null,
    status: detection ? "detected" : "pending",
    confidence: detection ? "candidate" : "unavailable",
  });
  const mainCooldownComplete = pt1S2Below4p5 && pt2S2Below4p5
    ? { timeMs: Math.max(Number(pt1S2Below4p5.timeMs), Number(pt2S2Below4p5.timeMs)) }
    : null;
  const chronological = (events) => events.sort((left, right) => (left.timeMs ?? Number.POSITIVE_INFINITY) - (right.timeMs ?? Number.POSITIVE_INFINITY));
  return [
    event("beginning-of-data", "data_start", "Beginning of data", "First valid sample in the current cooldown", beginningOfData?.timeMs != null ? beginningOfData : null),
    event("pumping", "pumping", "Pressure below 300 mbar", "Pumping detected from the cryostat pressure", pressureBelow300),
    ...chronological([
      event("ptc1-on", "cooling_start", "PTC 1 ON", "Pulse-tube compressor 1 is running", ptc1On),
      event("ptc2-on", "cooling_start", "PTC 2 ON", "Pulse-tube compressor 2 is running", ptc2On),
    ]),
    ...chronological([
      event("pt1-s2-260k", "cooling_260k", "PT1 S2 CH below 260 K", "Second stage of PT1 entered the 270–250 K cooldown phase", pt1S2Below260),
      event("pt2-s2-260k", "cooling_260k", "PT2 S2 CH below 260 K", "Second stage of PT2 entered the 270–250 K cooldown phase", pt2S2Below260),
    ]),
    ...chronological([
      event("pt1-s1-50k", "stage_40k", "PT1 S1 below 50 K", "First stage of PT1 reached the 40 K regime", pt1S1Below50),
      event("pt2-s1-50k", "stage_40k", "PT2 S1 below 50 K", "First stage of PT2 reached the 40 K regime", pt2S1Below50),
    ]),
    ...chronological([
      event("pt1-s2-4p5k", "stage_4k", "PT1 S2 CH below 4.5 K", "Second stage of PT1 reached the 4 K regime", pt1S2Below4p5),
      event("pt2-s2-4p5k", "stage_4k", "PT2 S2 CH below 4.5 K", "Second stage of PT2 reached the 4 K regime", pt2S2Below4p5),
    ]),
    event("main-cooldown-complete", "phase_boundary", "End of the main cooldown phase", "Both second PTC stages are below 4.5 K", mainCooldownComplete),
    ...chronological([
      event("300mk-fridge-below-3k", "subkelvin_cycle", "300 mK fridge cold head below 3 K", "First 300 mK fridge cycle", fridge300mKBelow3),
      event("300mk-fridge-below-350mk", "subkelvin_cycle", "300 mK fridge cold head below 350 mK", "First 300 mK fridge cycle", fridge300mKBelow350mK),
      event("1k-fridge-below-3k", "subkelvin_cycle", "1 K fridge cold head below 3 K", "First 1 K fridge cycle", fridge1KBelow3),
      event("base-1k", "subkelvin", "1 K stage below 1.2 K", "Automatic candidate — stability to be confirmed", base1k),
      event("1k-fridge-below-1k", "subkelvin_cycle", "1 K fridge cold head below 1 K", "First 1 K fridge cycle", fridge1KBelow1),
    ]),
  ];
}

function detectTouchEvents(database, cryogenicEvents, latestGlobalMs) {
  const eventsById = new Map(cryogenicEvents.map((event) => [event.id, event]));
  const ptcTimes = [eventsById.get("ptc1-on")?.timeMs, eventsById.get("ptc2-on")?.timeMs]
    .filter((timeMs) => Number.isFinite(timeMs));
  if (!ptcTimes.length) return [];
  const phaseStartMs = Math.min(...ptcTimes);
  const phaseEndMs = eventsById.get("main-cooldown-complete")?.timeMs ?? latestGlobalMs;
  const rows = database.prepare(`
    SELECT bucket_ms AS bucketMs, first_at_ms AS startMs, last_at_ms AS endMs,
      max_value AS peakValue, max_at_ms AS peakMs, (sum_value / sample_count) AS meanValue
    FROM aggregates
    WHERE channel_id = 'avs47_1_ch0' AND sample_count > 0
      AND first_at_ms BETWEEN ? AND ?
    ORDER BY bucket_ms
  `).all(phaseStartMs, phaseEndMs).map((row) => ({
    bucketMs: Number(row.bucketMs),
    startMs: Number(row.startMs),
    endMs: Number(row.endMs),
    peakMs: Number(row.peakMs ?? row.startMs),
    peakValue: Number(row.peakValue),
    meanValue: Number(row.meanValue),
  }));
  if (rows.length < 21) return [];
  const highRows = [];
  for (let index = 20; index < rows.length; index += 1) {
    const localValues = rows.slice(index - 20, index).map((row) => row.meanValue).sort((left, right) => left - right);
    const baseline = localValues[Math.floor(localValues.length / 2)];
    const threshold = Math.max(Number.EPSILON, baseline * 1.08);
    if (rows[index].peakValue >= threshold) {
      highRows.push({ ...rows[index], baseline, threshold, peakRatio: rows[index].peakValue / baseline });
    }
  }
  const operations = [];
  let active = null;
  for (const row of highRows) {
    if (!active || row.bucketMs - active.lastBucketMs > 120_000) {
      if (active) operations.push(active);
      active = {
        startMs: row.startMs,
        endMs: row.endMs,
        peakMs: row.peakMs,
        peakValue: row.peakValue,
        peakRatio: row.peakRatio,
        baseline: row.baseline,
        threshold: row.threshold,
        bucketCount: 1,
        lastBucketMs: row.bucketMs,
      };
      continue;
    }
    active.endMs = Math.max(active.endMs, row.endMs);
    active.lastBucketMs = row.bucketMs;
    active.bucketCount += 1;
    if (row.peakValue > active.peakValue) {
      active.peakValue = row.peakValue;
      active.peakMs = row.peakMs;
      active.peakRatio = row.peakRatio;
      active.baseline = row.baseline;
      active.threshold = row.threshold;
    }
  }
  if (active) operations.push(active);
  return operations.filter((operation) => operation.bucketCount >= 2 || operation.peakRatio >= 1.15).map((operation, index) => ({
    id: `mhs-operation-${index + 1}`,
    startMs: operation.startMs,
    peakMs: operation.peakMs,
    endMs: operation.endMs,
    peakValue: operation.peakValue,
    baseline: operation.baseline,
    threshold: operation.threshold,
    peakRatio: operation.peakRatio,
  }));
}

function exportSnapshot(database) {
  const generatedAtMs = Date.now();
  const latestGlobalMs = Number(database.prepare("SELECT MAX(last_at_ms) AS latestMs FROM aggregates WHERE sample_count > 0").get().latestMs ?? 0);
  const events = detectEvents(database);
  const touchEvents = detectTouchEvents(database, events, latestGlobalMs);
  const bounds = database.prepare(`
    SELECT MIN(CASE WHEN sample_count > 0 THEN first_at_ms END) AS firstMs,
      MAX(CASE WHEN sample_count > 0 THEN last_at_ms END) AS latestMs,
      SUM(sample_count) AS sampleCount, SUM(suspect_count) AS suspectCount, SUM(invalid_count) AS invalidCount
    FROM aggregates WHERE channel_id = ?
  `);
  const latest = database.prepare(`
    SELECT last_at_ms AS timeMs, last_value AS value FROM aggregates
    WHERE channel_id = ? AND sample_count > 0 ORDER BY bucket_ms DESC LIMIT 1
  `);
  const buckets = database.prepare(`
    SELECT MIN(first_at_ms) AS timeMs, SUM(sum_value) / SUM(sample_count) AS mean,
      MIN(min_value) AS min, MAX(max_value) AS max, SUM(sample_count) AS count
    FROM aggregates
    WHERE channel_id = ? AND sample_count > 0 AND bucket_ms BETWEEN ? AND ?
    GROUP BY CAST((bucket_ms - ?) / ? AS INTEGER)
    ORDER BY timeMs
  `);
  const touchBuckets = database.prepare(`
    SELECT max_at_ms AS timeMs, MAX(max_value) AS max
    FROM aggregates
    WHERE channel_id = ? AND sample_count > 0 AND bucket_ms BETWEEN ? AND ?
    GROUP BY CAST((bucket_ms - ?) / ? AS INTEGER)
    ORDER BY MIN(bucket_ms)
  `);
  const peakBuckets = database.prepare(`
    SELECT CAST(bucket_ms / ? AS INTEGER) * ? AS timeMs, MAX(max_value) AS max
    FROM aggregates
    WHERE channel_id = ? AND sample_count > 0 AND bucket_ms BETWEEN ? AND ?
    GROUP BY CAST(bucket_ms / ? AS INTEGER)
    ORDER BY timeMs
  `);

  const channels = channelDefinitions.map((definition) => {
    const stats = bounds.get(definition.id);
    const last = latest.get(definition.id);
    const firstMs = Number(stats.firstMs ?? 0);
    const lastMs = Number(stats.latestMs ?? 0);
    const span = Math.max(1, lastMs - firstMs);
    const historicalWidth = Math.max(storageBucketMs, Math.ceil(span / 720 / storageBucketMs) * storageBucketMs);
    const fineStartMs = Math.max(firstMs, lastMs - 6 * 3_600_000);
    const mediumStartMs = Math.max(firstMs, lastMs - 72 * 3_600_000);
    const preservesPeaks = peakPreservingChannelIds.has(definition.id);
    const readBuckets = (startMs, endMs, widthMs) => {
      if (endMs < startMs) return [];
      const query = definition.category === "touch" ? touchBuckets : buckets;
      return query.all(definition.id, startMs, endMs, startMs, widthMs)
        .map((point) => [Number(point.timeMs), Number(definition.category === "touch" ? point.max : point.mean)]);
    };
    const readPeakBuckets = (startMs, endMs) => endMs < startMs ? [] : peakBuckets
      .all(fridgePeakBucketMs, fridgePeakBucketMs, definition.id, startMs, endMs, fridgePeakBucketMs)
      .map((point) => [Number(point.timeMs), Number(point.max)]);
    let points = firstMs
      ? preservesPeaks
        ? readPeakBuckets(firstMs, lastMs)
        : [
            ...readBuckets(firstMs, mediumStartMs - 1, historicalWidth),
            ...readBuckets(mediumStartMs, fineStartMs - 1, 5 * 60_000),
            ...readBuckets(fineStartMs, lastMs, storageBucketMs),
          ]
      : [];
    if (definition.category === "touch") {
      const pointsByTime = new Map(points.map((point) => [point[0], point]));
      for (const event of touchEvents) pointsByTime.set(event.peakMs, [event.peakMs, event.peakValue]);
      points = [...pointsByTime.values()].sort((left, right) => left[0] - right[0]);
    }
    const ageMs = last ? generatedAtMs - Number(last.timeMs) : null;
    const status = ageMs === null ? "missing" : ageMs < 15 * 60_000 ? "fresh" : ageMs < 6 * 3_600_000 ? "delayed" : "stale";
    return {
      id: definition.id, sourceName: definition.sourceName, label: definition.label,
      shortLabel: definition.shortLabel, group: definition.group, category: definition.category,
      unit: definition.unit, color: definition.color, source: definition.source,
      aggregation: preservesPeaks ? "bucket_max_10m" : definition.category === "touch" ? "bucket_max" : "mean",
      firstMs, latestMs: last ? Number(last.timeMs) : null, latestValue: last ? Number(last.value) : null,
      ageMs, status, sampleCount: Number(stats.sampleCount ?? 0), suspectCount: Number(stats.suspectCount ?? 0),
      invalidCount: Number(stats.invalidCount ?? 0), points,
    };
  });

  const oneKelvin = channels.find((channel) => channel.id === "avs47_1_ch1");
  const snapshot = {
    generatedAtMs, latestGlobalMs,
    cooldown: { ...cooldown, phase: oneKelvin?.latestValue != null && oneKelvin.latestValue <= 1.2 ? "Cold phase — partial stream" : "Cooldown" },
    events,
    touchEvents,
    channels,
    sourceHealth: {
      total: channels.length,
      fresh: channels.filter((channel) => channel.status === "fresh").length,
      delayed: channels.filter((channel) => channel.status === "delayed").length,
      stale: channels.filter((channel) => channel.status === "stale").length,
      missing: channels.filter((channel) => channel.status === "missing").length,
    },
  };
  mkdirSync(dirname(snapshotPath), { recursive: true });
  writeFileSync(snapshotPath, `${JSON.stringify(snapshot)}\n`);
  writeFileSync(statusPath, `${JSON.stringify({ generatedAtMs, latestGlobalMs, cooldownId: cooldown.id })}\n`);
  return snapshot;
}

export async function refreshMonitoringData() {
  mkdirSync(localDirectory, { recursive: true });
  const database = new DatabaseSync(databasePath);
  initializeDatabase(database);
  const results = [];
  try {
    for (const source of sourceDefinitions) results.push(await ingestSource(database, source));
    const snapshot = exportSnapshot(database);
    database.exec("PRAGMA optimize");
    return { databasePath, snapshotPath, results, snapshot };
  } finally {
    database.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await refreshMonitoringData();
  for (const source of result.results) {
    console.log(`${source.sourceId}: ${source.status}, ${source.inserted.toLocaleString("en-GB")} aggregate bucket(s)`);
  }
  console.log(`Database: ${result.databasePath}`);
  console.log(`Snapshot: ${result.snapshotPath}`);
}
