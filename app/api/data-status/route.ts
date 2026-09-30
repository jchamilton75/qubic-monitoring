import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

export const runtime = "nodejs";

// Public files are copied into the production bundle during the build, so they
// cannot be used for process state that changes afterwards. This route reads
// the live files from the checkout on every request instead.
function projectDirectory() {
  return resolve(process.env.QUBIC_PROJECT_DIR ?? process.env.INIT_CWD ?? process.env.npm_config_local_prefix ?? process.cwd());
}

function readJsonFile(fileName: string) {
  const path = join(projectDirectory(), "public", "data", fileName);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch {
    return null;
  }
}

export async function GET() {
  return Response.json(
    {
      snapshot: readJsonFile("monitoring-status.json"),
      sync: readJsonFile("data-sync-status.json"),
      watcher: readJsonFile("data-watch-status.json"),
      heartbeat: readJsonFile("data-watch-heartbeat.json"),
    },
    {
      headers: { "Cache-Control": "no-store" },
    },
  );
}
