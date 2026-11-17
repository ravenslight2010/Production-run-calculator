import { inventoryClientId } from "./inventoryShared";

export type SupervisorPinStatus = { configured: boolean };

async function pinRequest(method: string, pin?: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    return await fetch(`/api/supervisor-pin${method === "POST" ? "/verify" : ""}`, {
      method,
      cache: "no-store",
      signal: controller.signal,
      headers: { "Content-Type": "application/json", "x-client-id": inventoryClientId() },
      ...(pin === undefined ? {} : { body: JSON.stringify({ pin }) }),
    });
  } catch (error) {
    throw new Error(controller.signal.aborted
      ? "PIN verification timed out. Check your connection and retry."
      : "Server unavailable. Connect online and retry.");
  } finally {
    clearTimeout(timer);
  }
}

function responseError(res: Response): Error {
  return new Error(res.status === 401 ? "Your session expired. Sign in again."
    : res.status === 429 ? "Too many attempts. Wait before trying again."
    : res.status === 403 ? "Incorrect PIN or insufficient permission (403)."
    : "PIN service unavailable. Retry online.");
}

async function statusResponse(res: Response): Promise<SupervisorPinStatus> {
  if (!res.ok) throw responseError(res);
  const body = await res.json();
  if (typeof body?.configured !== "boolean") throw new Error("PIN status unavailable. Update this app and retry.");
  return { configured: body.configured };
}

export async function fetchSupervisorPin(): Promise<SupervisorPinStatus> {
  return statusResponse(await pinRequest("GET"));
}

export async function updateSupervisorPin(pin: string): Promise<SupervisorPinStatus> {
  return statusResponse(await pinRequest("PUT", pin));
}

export async function verifySupervisorPin(pin: string): Promise<void> {
  const res = await pinRequest("POST", pin);
  if (!res.ok) throw responseError(res);
  const body = await res.json();
  if (body?.verified !== true) throw new Error("PIN verification failed. Retry online.");
}
