const allowedCameraIds = new Set(["1", "2", "3"]);
const imageCacheTtlMs = 10_000;
const freshImageMinimumIntervalMs = 1_000;

type CachedWebcamImage = {
  body: ArrayBuffer;
  contentType: string;
  fetchedAtMs: number;
  expiresAt: number;
};

class WebcamRelayError extends Error {
  constructor(readonly status: 502 | 504) {
    super("Camera unavailable");
  }
}

// This cache is deliberately lazy: it has no timer or background poller.
// The cache and in-flight map are process-local, which is sufficient for the
// current single-process VM deployment.
const imageCache = new Map<string, CachedWebcamImage>();
const imageFetchesInFlight = new Map<string, Promise<CachedWebcamImage>>();

async function sha1Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function getWebcamImage(
  cameraId: string,
  upstreamBaseUrl: string,
  username: string,
  password: string,
  forceRefresh: boolean,
): Promise<{ image: CachedWebcamImage; cacheStatus: "HIT" | "MISS" | "COALESCED" }> {
  const now = Date.now();
  const cached = imageCache.get(cameraId);
  if (cached && (forceRefresh
    ? now - cached.fetchedAtMs < freshImageMinimumIntervalMs
    : cached.expiresAt > now)) {
    return { image: cached, cacheStatus: "HIT" };
  }
  if (cached && cached.expiresAt <= now) imageCache.delete(cameraId);

  const pending = imageFetchesInFlight.get(cameraId);
  if (pending) return { image: await pending, cacheStatus: "COALESCED" };

  const fetchPromise = (async () => {
    const encodedUsername = encodeURIComponent(username);
    const remotePath = `/picture/${cameraId}/current/?_username=${encodedUsername}`;
    const passwordHash = await sha1Hex(password);
    const signature = await sha1Hex(`GET:${remotePath}::${passwordHash}`);
    const upstreamResponse = await fetch(`${upstreamBaseUrl}${remotePath}&_signature=${signature}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });

    if (!upstreamResponse.ok || !upstreamResponse.body) {
      throw new WebcamRelayError(502);
    }

    const image: CachedWebcamImage = {
      body: await upstreamResponse.arrayBuffer(),
      contentType: upstreamResponse.headers.get("content-type") ?? "image/jpeg",
      fetchedAtMs: Date.now(),
      expiresAt: Date.now() + imageCacheTtlMs,
    };
    imageCache.set(cameraId, image);
    return image;
  })();

  imageFetchesInFlight.set(cameraId, fetchPromise);
  try {
    return { image: await fetchPromise, cacheStatus: "MISS" };
  } finally {
    if (imageFetchesInFlight.get(cameraId) === fetchPromise) imageFetchesInFlight.delete(cameraId);
  }
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
    const forceRefresh = requestUrl.searchParams.get("fresh") === "1";
    const { image, cacheStatus } = await getWebcamImage(cameraId, upstreamBaseUrl, username, password, forceRefresh);
    return new Response(image.body.slice(0), {
      status: 200,
      headers: {
        "Content-Type": image.contentType,
        "Cache-Control": "no-store, max-age=0",
        "X-Webcam-Cache": cacheStatus,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    const status = error instanceof WebcamRelayError ? error.status : 504;
    return Response.json({ error: "Camera unavailable" }, { status });
  }
}
