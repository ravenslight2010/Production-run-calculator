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
  registrationRejected?: boolean;
  subscriptionWasExisting?: boolean;
}


const SUBSCRIPTIONS_URL = "/api/web-push/subscriptions";
const VAPID_URL = "/api/web-push/vapid-public-key";
const SUBSCRIPTION_ID_KEY = "run-calculator.web-push-subscription-id.v1";
const REGISTRATION_REJECTED_KEY = "run-calculator.web-push-registration-rejected.v1";

class PushRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "PushRequestError";
  }
}

function wasRegistrationRejected(error: unknown): boolean {
  return error instanceof PushRequestError && (error.status === 400 || error.status === 422);
}

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
    try {
      const body = await response.json() as { message?: string; error?: string };
      detail = body.message ?? body.error ?? "";
    } catch { /* no JSON error body */ }
    throw new PushRequestError(detail || `Web Push request failed (${response.status}).`, response.status);
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

function hasRegistrationRejectionMarker(): boolean {
  try { return localStorage.getItem(REGISTRATION_REJECTED_KEY) === "1"; } catch { return false; }
}

function storeRegistrationRejectionMarker(rejected: boolean): void {
  try {
    if (rejected) localStorage.setItem(REGISTRATION_REJECTED_KEY, "1");
    else localStorage.removeItem(REGISTRATION_REJECTED_KEY);
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
    if (!subscription) {
      storeRegistrationRejectionMarker(false);
      return { state: "available", subscription: null };
    }
    if (hasRegistrationRejectionMarker()) {
      return {
        state: "error",
        error: "The server rejected this device’s saved notification subscription.",
        subscription,
        subscriptionId: storedSubscriptionId(),
        registrationRejected: true,
        subscriptionWasExisting: true,
      };
    }
    return { state: "enabled", subscription, subscriptionId: storedSubscriptionId() };
  } catch {
    return { state: "error", error: "The service worker could not be prepared for alerts." };
  }
}

export async function enableWebPush(vapidPublicKey: string): Promise<WebPushStatus> {
  const support = browserPushSupport();
  if (support.error) return support.error;
  let subscription: PushSubscription | null = null;
  const subscriptionId = storedSubscriptionId();
  let subscriptionWasExisting = false;
  try {
    let permission = support.notification!.permission;
    if (permission === "default") permission = await support.notification!.requestPermission();
    if (permission === "denied") return { state: "denied" };
    if (permission !== "granted") return { state: "error", error: "Browser notification permission was not granted." };
    const registration = await navigator.serviceWorker.ready;
    const existing = await registration.pushManager.getSubscription();
    subscriptionWasExisting = existing !== null;
    subscription = existing ?? await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: vapidKeyToUint8Array(vapidPublicKey),
    });
    const savedId = await savePushSubscription(subscription);
    storeSubscriptionId(savedId);
    storeRegistrationRejectionMarker(false);
    return { state: "enabled", subscription, subscriptionId: savedId };
  } catch (error) {
    const registrationRejected = wasRegistrationRejected(error);
    if (registrationRejected && subscription) storeRegistrationRejectionMarker(true);
    return {
      state: "error",
      error: error instanceof Error ? error.message : "Could not enable Web Push.",
      subscription,
      subscriptionId,
      registrationRejected,
      subscriptionWasExisting,
    };
  }
}

/**
 * Replaces only this browser's push subscription. The caller must first ask the
 * user to confirm because an existing local subscription will be removed.
 * Revoke the server row before unsubscribing locally so a failed request never
 * silently strands a still-working device.
 */
export async function recoverWebPush(
  vapidPublicKey: string,
  subscription?: PushSubscription | null,
  subscriptionId?: string,
  subscriptionWasExisting = false,
): Promise<WebPushStatus> {
  const support = browserPushSupport();
  if (support.error) return support.error;

  let current = subscription ?? null;
  let currentId = subscriptionId ?? storedSubscriptionId();
  let replacement: PushSubscription | null = null;
  try {
    const registration = await navigator.serviceWorker.ready;
    current ??= await registration.pushManager.getSubscription();
    if (current && subscriptionWasExisting && !currentId) {
      throw new Error("This saved device subscription cannot be identified safely, so it was not replaced.");
    }

    let permission = support.notification!.permission;
    if (permission === "default") permission = await support.notification!.requestPermission();
    if (permission === "denied") return { state: "denied" };
    if (permission !== "granted") {
      return { state: "error", error: "Browser notification permission was not granted." };
    }

    if (currentId) await revokePushSubscription(currentId);
    if (current) {
      await current.unsubscribe();
      current = null;
    }
    storeSubscriptionId(undefined);

    replacement = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: vapidKeyToUint8Array(vapidPublicKey),
    });
    const replacementId = await savePushSubscription(replacement);
    storeSubscriptionId(replacementId);
    storeRegistrationRejectionMarker(false);
    return { state: "enabled", subscription: replacement, subscriptionId: replacementId };
  } catch (error) {
    const registrationRejected = wasRegistrationRejected(error) || (current !== null && subscriptionWasExisting);
    if (registrationRejected && (replacement ?? current)) storeRegistrationRejectionMarker(true);
    return {
      state: "error",
      error: error instanceof Error ? error.message : "Could not restore Web Push.",
      subscription: replacement ?? current,
      subscriptionId: current ? currentId : undefined,
      registrationRejected,
      subscriptionWasExisting: replacement ? false : subscriptionWasExisting,
    };
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
    storeRegistrationRejectionMarker(false);
    return { state: "available", subscription: null };
  } catch (error) {
    return { state: "error", error: error instanceof Error ? error.message : "Could not disable Web Push." };
  }
}
