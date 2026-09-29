import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const projectDirectory = resolve(process.cwd());
const allowedStatistics = new Set(["value", "min", "max"]);
const peakChannels = new Set(["avs47_1_ch0", "avs47_1_ch4", "avs47_1_ch6"]);

function cooldownId(sourceDirectoryName: string) {
  return sourceDirectoryName
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .toLowerCase();
}

function databasePath() {
  const sourceDirectoryName = process.env.QUBIC_COOLDOWN_DIR ?? "June2026";
  return join(projectDirectory, ".local", `qubic-monitoring-${cooldownId(sourceDirectoryName)}-v2.sqlite`);
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const ids = (requestUrl.searchParams.get("ids") ?? "")
    .split(",")
    .map((id) => id.trim().toLowerCase())
    .filter((id, index, values) => id && values.indexOf(id) === index && /^[a-z0-9_]+$/.test(id));
  const startMs = Number(requestUrl.searchParams.get("start"));
  const endMs = Number(requestUrl.searchParams.get("end"));
  const statistic = requestUrl.searchParams.get("statistic") ?? "value";
  const requestedMaxPoints = Number(requestUrl.searchParams.get("maxPoints") ?? 2400);
  const maxPoints = Math.min(6000, Math.max(100, Number.isFinite(requestedMaxPoints) ? Math.floor(requestedMaxPoints) : 2400));

  if (!ids.length || !Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs || !allowedStatistics.has(statistic)) {
    return Response.json({ error: "Invalid channel-data request" }, { status: 400 });
  }

  const path = databasePath();
  if (!existsSync(path)) return Response.json({ error: "Monitoring database unavailable" }, { status: 503 });

  const bucketMs = Math.max(30_000, Math.ceil((endMs - startMs) / maxPoints / 30_000) * 30_000);
  let database: DatabaseSync | undefined;
  try {
    database = new DatabaseSync(path, { readOnly: true });
    const placeholders = ids.map(() => "?").join(",");
    const definitions = database.prepare(`SELECT id, category FROM channels WHERE id IN (${placeholders})`).all(...ids) as Array<{ id: string; category: string }>;
    const knownIds = new Set(definitions.map((definition) => definition.id));
    const query = database.prepare(`
      SELECT MIN(first_at_ms) AS timeMs,
        SUM(sum_value) / SUM(sample_count) AS mean,
        MIN(min_value) AS minimum,
        MAX(max_value) AS maximum,
        MAX(max_at_ms) AS maximumAtMs
      FROM aggregates
      WHERE channel_id = ? AND sample_count > 0 AND bucket_ms BETWEEN ? AND ?
      GROUP BY CAST((bucket_ms - ?) / ? AS INTEGER)
      ORDER BY timeMs
    `);
    const points: Record<string, Array<[number, number, number, number]>> = {};
    for (const id of ids) {
      if (!knownIds.has(id)) {
        points[id] = [];
        continue;
      }
      const definition = definitions.find((item) => item.id === id)!;
      const useMaximum = definition.category === "touch" || peakChannels.has(id);
      points[id] = query.all(id, startMs, endMs, startMs, bucketMs).flatMap((row) => {
        const aggregate = row as { timeMs: number; mean: number; minimum: number; maximum: number; maximumAtMs: number };
        const minimum = Number(aggregate.minimum);
        const maximum = Number(aggregate.maximum);
        const value = statistic === "min" ? minimum : statistic === "max" || useMaximum ? maximum : Number(aggregate.mean);
        const timeMs = statistic === "max" || useMaximum ? Number(aggregate.maximumAtMs || aggregate.timeMs) : Number(aggregate.timeMs);
        return Number.isFinite(timeMs) && Number.isFinite(value) ? [[timeMs, value, minimum, maximum]] : [];
      });
    }
    return Response.json({ startMs, endMs, bucketMs, points }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json({ error: "Monitoring database query failed" }, { status: 503 });
  } finally {
    database?.close();
  }
}
