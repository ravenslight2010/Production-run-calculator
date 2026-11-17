const WORKER_STATUSES = new Set(["starting", "active", "standby", "degraded", "stopped"]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export async function readStationWorkerHealth({
  port,
  timeoutMs = 1200,
  fetchImpl = fetch,
}) {
  const response = await fetchImpl(`http://127.0.0.1:${port}/healthz`, {
    headers: { accept: "application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error("Station worker health endpoint is unavailable.");

  const contentType = response.headers.get("content-type") ?? "";
  if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
    throw new Error("Station worker health response is not JSON.");
  }
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null && (!/^\d+$/.test(contentLength) || Number(contentLength) > 4096)) {
    throw new Error("Station worker health response is too large.");
  }
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > 4096) {
    throw new Error("Station worker health response is too large.");
  }
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error("Station worker health response is invalid.");
  }
  if (!isRecord(body)
    || !WORKER_STATUSES.has(body.status)
    || !(body.lastCycleAt === null || typeof body.lastCycleAt === "string")
    || !(body.lastSuccessAt === null || typeof body.lastSuccessAt === "string")
    || !Number.isSafeInteger(body.consecutiveFailures)
    || body.consecutiveFailures < 0
    || !Number.isSafeInteger(body.processedLastCycle)
    || body.processedLastCycle < 0
    || !(body.lastErrorName === null || (
      typeof body.lastErrorName === "string"
      && /^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(body.lastErrorName)
    ))) {
    throw new Error("Station worker health response is invalid.");
  }

  return {
    status: body.status,
    lastCycleAt: body.lastCycleAt,
    lastSuccessAt: body.lastSuccessAt,
    consecutiveFailures: body.consecutiveFailures,
    lastErrorName: body.lastErrorName,
    processedLastCycle: body.processedLastCycle,
  };
}
