import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

export const runtime = "nodejs";

type OpenMeteoResponse = {
  hourly?: {
    time?: number[];
    temperature_2m?: Array<number | null>;
    relative_humidity_2m?: Array<number | null>;
    surface_pressure?: Array<number | null>;
    wind_speed_10m?: Array<number | null>;
    wind_direction_10m?: Array<number | null>;
  };
};

const qubicSite = {
  latitude: -24.186971,
  longitude: -66.478209,
  elevation: 4869,
};

function cooldownId(sourceDirectoryName: string) {
  return sourceDirectoryName
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .toLowerCase();
}

function projectDirectory() {
  return resolve(process.env.QUBIC_PROJECT_DIR ?? process.env.INIT_CWD ?? process.env.npm_config_local_prefix ?? process.cwd());
}

function readForecastHistory() {
  const sourceDirectoryName = process.env.QUBIC_COOLDOWN_DIR ?? "June2026";
  const path = join(projectDirectory(), ".local", `qubic-monitoring-${cooldownId(sourceDirectoryName)}-v2.sqlite`);
  if (!existsSync(path)) return [];
  let database: DatabaseSync | undefined;
  try {
    database = new DatabaseSync(path, { readOnly: true });
    const runs = database.prepare(`
      SELECT fetched_at_ms AS fetchedAtMs
      FROM weather_forecast_runs
      WHERE fetched_at_ms <= ?
      ORDER BY fetched_at_ms DESC
      LIMIT 96
    `).all(Date.now()) as Array<{ fetchedAtMs: number }>;
    if (!runs.length) return [];
    const placeholders = runs.map(() => "?").join(",");
    const points = database.prepare(`
      SELECT fetched_at_ms AS fetchedAtMs, time_ms AS timeMs,
        temperature, humidity, pressure, wind_speed AS windSpeed, wind_direction AS windDirection
      FROM weather_forecast_points
      WHERE fetched_at_ms IN (${placeholders})
      ORDER BY fetched_at_ms, time_ms
    `).all(...runs.map((run) => run.fetchedAtMs)) as Array<Record<string, number | null>>;
    const byRun = new Map(runs.map((run) => [Number(run.fetchedAtMs), [] as Array<Record<string, number | null>>]));
    for (const point of points) byRun.get(Number(point.fetchedAtMs))?.push(point);
    return [...byRun.entries()].sort((left, right) => left[0] - right[0]).map(([fetchedAtMs, runPoints]) => ({
      generatedAtMs: fetchedAtMs,
      points: runPoints.map((point) => ({
        timeMs: point.timeMs,
        temperature: point.temperature,
        humidity: point.humidity,
        pressure: point.pressure,
        windSpeed: point.windSpeed,
        windDirection: point.windDirection,
      })),
    }));
  } catch {
    return [];
  } finally {
    database?.close();
  }
}

export async function GET() {
  const parameters = new URLSearchParams({
    latitude: String(qubicSite.latitude),
    longitude: String(qubicSite.longitude),
    elevation: String(qubicSite.elevation),
    hourly: "temperature_2m,relative_humidity_2m,surface_pressure,wind_speed_10m,wind_direction_10m",
    forecast_days: "16",
    timeformat: "unixtime",
    timezone: "UTC",
    wind_speed_unit: "kmh",
  });

  try {
    const upstream = await fetch(`https://api.open-meteo.com/v1/forecast?${parameters}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!upstream.ok) return Response.json({ error: "Forecast unavailable" }, { status: 502 });
    const payload = await upstream.json() as OpenMeteoResponse;
    const hourly = payload.hourly;
    if (!hourly?.time) return Response.json({ error: "Forecast unavailable" }, { status: 502 });
    const points = hourly.time.map((timestamp, index) => ({
      timeMs: timestamp * 1000,
      temperature: hourly.temperature_2m?.[index] ?? null,
      humidity: hourly.relative_humidity_2m?.[index] ?? null,
      pressure: hourly.surface_pressure?.[index] ?? null,
      windSpeed: hourly.wind_speed_10m?.[index] ?? null,
      windDirection: hourly.wind_direction_10m?.[index] ?? null,
    }));

    return Response.json({
      generatedAtMs: Date.now(),
      source: "Open-Meteo",
      site: qubicSite,
      points,
      history: readForecastHistory(),
    }, {
      headers: { "Cache-Control": "public, max-age=900, stale-while-revalidate=1800" },
    });
  } catch {
    return Response.json({ error: "Forecast unavailable" }, { status: 504 });
  }
}
