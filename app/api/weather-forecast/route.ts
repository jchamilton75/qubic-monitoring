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
    }, {
      headers: { "Cache-Control": "public, max-age=900, stale-while-revalidate=1800" },
    });
  } catch {
    return Response.json({ error: "Forecast unavailable" }, { status: 504 });
  }
}
