/**
 * Device-scoped Web Push support.  Alert-kind preferences live on the account;
 * a subscription lives on this browser/device and is deliberately managed here.
 */
export type WebPushState =
  | "unsupported"
  | "insecure"
  | "denied"
  | "available"
  | "enabling"
  | "enabled"
  | "error";

export interface WebPushStatus {
  state: WebPushState;
  subscription?: PushSubscription | null;
  subscriptionId?: string;
  error?: string;
}

const SUBSCRIPTIONS_URL = "/api/web-push/subscriptions";
const VAPID_URL = "/api/web-push/vapid-public-key";
const SUBSCRIPTION_ID_KEY = "run-calculator.web-push-subscription-id.v1";

function browserPushSupport(): { error?: WebPushStatus; notification?: typeof Notification } {
  if (typeof window === "undefined" || !window.isSecureContext) {
    return { error: { state: typeof window === "undefined" ? "unsupported" : "insecure" } };
  }
  const notification = window.Notification;
  if (
    typeof notification !== "function" ||
    !navigator.serviceWorker ||
    typeof window.PushManager !== "function"
  ) {
    return { error: { state: "unsupported" } };
  }
  if (notification.permission === "denied") return { error: { state: "denied" } };
  return { notification };
}

/** Converts a URL-safe base64 VAPID public key into PushManager's binary form. */
export function vapidKeyToUint8Array(key: string): Uint8Array<ArrayBuffer> {
  const normalized = key.trim().replace(/-/g, "+").replace(/_/g, "/");
  if (!normalized) throw new Error("Web Push is not configured for this deployment.");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  try {
    const binary = window.atob(padded);
    const bytes = new Uint8Array(new ArrayBuffer(binary.length));
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    throw new Error("The Web Push public key is invalid.");
  }
}

async function pushFetch(path = SUBSCRIPTIONS_URL, init?: RequestInit): Promise<Response> {
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!response.ok) {
    let detail = "";
    try { detail = (await response.json() as { message?: string; error?: string }).message ?? ""; } catch { /* no JSON error body */ }
    throw new Error(detail || `Web Push request failed (${response.status}).`);
  }
  return response;
}

export async function listPushSubscriptions(): Promise<unknown[]> {
  const response = await pushFetch();
  const body = await response.json() as unknown;
  if (Array.isArray(body)) return body;
  if (body && typeof body === "object" && Array.isArray((body as { subscriptions?: unknown[] }).subscriptions)) {
    return (body as { subscriptions: unknown[] }).subscriptions;
  }
  return [];
}

export async function fetchVapidPublicKey(): Promise<string> {
  const response = await pushFetch(VAPID_URL);
  const body = await response.json() as { publicKey?: unknown };
  if (typeof body.publicKey !== "string" || !body.publicKey) throw new Error("Web Push is not configured for this deployment.");
  return body.publicKey;
}

export async function savePushSubscription(subscription: PushSubscription): Promise<string | undefined> {
  const response = await pushFetch(SUBSCRIPTIONS_URL, {
    method: "POST",
    body: JSON.stringify(subscription.toJSON()),
  });
  const body = await response.json() as { id?: unknown };
  return typeof body.id === "string" ? body.id : undefined;
}

export async function revokePushSubscription(subscriptionId: string): Promise<void> {
  await pushFetch(`${SUBSCRIPTIONS_URL}/${encodeURIComponent(subscriptionId)}`, {
    method: "DELETE",
  });
}

function storedSubscriptionId(): string | undefined {
  try { return localStorage.getItem(SUBSCRIPTION_ID_KEY) ?? undefined; } catch { return undefined; }
}

function storeSubscriptionId(id: string | undefined): void {
  try {
    if (id) localStorage.setItem(SUBSCRIPTION_ID_KEY, id);
    else localStorage.removeItem(SUBSCRIPTION_ID_KEY);
  } catch { /* private-mode storage is optional */ }
}

export async function getWebPushStatus(): Promise<WebPushStatus> {
  const support = browserPushSupport();
  if (support.error) return support.error;
  try {
    // `ready`, unlike getRegistration(), waits for the controlling worker that
    // can actually receive a push and show a notification.
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    return subscription
      ? { state: "enabled", subscription, subscriptionId: storedSubscriptionId() }
      : { state: "available", subscription: null };
  } catch {
    return { state: "error", error: "The service worker could not be prepared for alerts." };
  }
}

export async function enableWebPush(vapidPublicKey: string): Promise<WebPushStatus> {
  const support = browserPushSupport();
  if (support.error) return support.error;
  try {
    let permission = support.notification!.permission;
    if (permission === "default") permission = await support.notification!.requestPermission();
    if (permission === "denied") return { state: "denied" };
    if (permission !== "granted") return { state: "error", error: "Browser notification permission was not granted." };
    const registration = await navigator.serviceWorker.ready;
    const existing = await registration.pushManager.getSubscription();
    const subscription = existing ?? await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: vapidKeyToUint8Array(vapidPublicKey),
    });
    const subscriptionId = await savePushSubscription(subscription);
    storeSubscriptionId(subscriptionId);
    return { state: "enabled", subscription, subscriptionId };
  } catch (error) {
    return { state: "error", error: error instanceof Error ? error.message : "Could not enable Web Push." };
  }
}

export async function disableWebPush(subscription?: PushSubscription | null, subscriptionId?: string): Promise<WebPushStatus> {
  try {
    const current = subscription ?? await (await navigator.serviceWorker.ready).pushManager.getSubscription();
    if (current) {
      // Revoke remotely first; a failed revoke leaves the local subscription
      // intact so the operator can retry instead of silently losing control.
      const id = subscriptionId ?? storedSubscriptionId();
      if (!id) throw new Error("This device subscription cannot be identified. Enable Web Push again, then disable it.");
      await revokePushSubscription(id);
      await current.unsubscribe();
    }
    storeSubscriptionId(undefined);
    return { state: "available", subscription: null };
  } catch (error) {
    return { state: "error", error: error instanceof Error ? error.message : "Could not disable Web Push." };
  }
}