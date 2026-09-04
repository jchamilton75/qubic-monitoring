const allowedCameraIds = new Set(["1", "2", "3"]);

async function sha1Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const cameraId = requestUrl.searchParams.get("id") ?? "";
  if (!allowedCameraIds.has(cameraId)) {
    return Response.json({ error: "Unknown camera" }, { status: 404 });
  }

  const upstreamBaseUrl = process.env.QUBIC_WEBCAM_URL?.replace(/\/+$/, "");
  const username = process.env.QUBIC_WEBCAM_USERNAME;
  const password = process.env.QUBIC_WEBCAM_PASSWORD;
  if (!upstreamBaseUrl || !username || !password) {
    return Response.json({ error: "Webcam relay is not configured" }, { status: 503 });
  }

  try {
    const encodedUsername = encodeURIComponent(username);
    const remotePath = `/picture/${cameraId}/current/?_username=${encodedUsername}`;
    const passwordHash = await sha1Hex(password);
    const signature = await sha1Hex(`GET:${remotePath}::${passwordHash}`);
    const upstreamResponse = await fetch(`${upstreamBaseUrl}${remotePath}&_signature=${signature}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });

    if (!upstreamResponse.ok || !upstreamResponse.body) {
      return Response.json({ error: "Camera unavailable" }, { status: 502 });
    }

    return new Response(upstreamResponse.body, {
      status: 200,
      headers: {
        "Content-Type": upstreamResponse.headers.get("content-type") ?? "image/jpeg",
        "Cache-Control": "no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return Response.json({ error: "Camera unavailable" }, { status: 504 });
  }
}
