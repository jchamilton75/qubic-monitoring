import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

export const runtime = "nodejs";

function projectDirectory() {
  return resolve(process.env.QUBIC_PROJECT_DIR ?? process.env.INIT_CWD ?? process.env.npm_config_local_prefix ?? process.cwd());
}

export async function GET() {
  const path = join(projectDirectory(), "public", "data", "monitoring-snapshot.json");
  if (!existsSync(path)) return Response.json({ error: "Monitoring snapshot unavailable" }, { status: 503 });
  try {
    return new Response(readFileSync(path, "utf8"), {
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "application/json; charset=utf-8",
      },
    });
  } catch {
    return Response.json({ error: "Monitoring snapshot unavailable" }, { status: 503 });
  }
}
