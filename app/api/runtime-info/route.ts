import { hostname, platform } from "node:os";

export const runtime = "nodejs";

export async function GET() {
  const configuredName = process.env.QUBIC_SERVER_NAME?.trim();
  return Response.json(
    {
      serverName: configuredName || hostname(),
      platform: platform(),
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
