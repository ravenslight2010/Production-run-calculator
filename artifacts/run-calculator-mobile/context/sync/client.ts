// Transport for live sync: REST helpers + a cross-platform Server-Sent Events
// stream. React Native has no native EventSource, so on native we use the
// `react-native-sse` polyfill; on web we use the browser's global EventSource.

import AsyncStorage from "@react-native-async-storage/async-storage";
import { getAuthToken } from "@workspace/api-client-react";
import { Platform } from "react-native";
import type { SyncPayload } from "./payloadTypes";
import { notifyUnauthorized } from "../authEvents";

const CLIENT_ID_KEY = "run-calc-mobile-client-id";

// The Expo dev script wires EXPO_PUBLIC_DOMAIN=$REPLIT_DEV_DOMAIN, which routes
// to the API server through the shared proxy at /api. Returns null when no
// domain is available (e.g. a standalone build without the env), disabling sync.
export function getApiBaseUrl(): string | null {
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  if (!domain) return null;
  return `https://${domain}`;
}

export async function getOrCreateClientId(): Promise<string> {
  try {
    const existing = await AsyncStorage.getItem(CLIENT_ID_KEY);
    if (existing) return existing;
  } catch {
    /* ignore */
  }
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  try {
    await AsyncStorage.setItem(CLIENT_ID_KEY, id);
  } catch {
    /* ignore */
  }
  return id;
}

// Mobile has no browser cookie jar, so the session bearer token must be attached
// explicitly to every authenticated request (web sends the session cookie).
async function authHeaders(
  extra?: Record<string, string>,
): Promise<Record<string, string>> {
  const token = await getAuthToken();
  return {
    ...(extra ?? {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export async function fetchToday(baseUrl: string): Promise<SyncPayload | null> {
  const res = await fetch(`${baseUrl}/api/sync/today`, {
    headers: await authHeaders(),
  });
  if (!res.ok) {
    // A 401 here means the session ended (typically the daily reset advanced the
    // server-side boundary) — bounce to login via the auth bridge.
    if (res.status === 401) notifyUnauthorized();
    throw new Error(`GET /api/sync/today -> ${res.status}`);
  }
  return (await res.json()) as SyncPayload | null;
}

export async function putToday(
  baseUrl: string,
  senderId: string,
  payload: SyncPayload,
): Promise<void> {
  const res = await fetch(`${baseUrl}/api/sync/today`, {
    method: "PUT",
    headers: await authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ senderId, payload }),
  });
  if (!res.ok) {
    if (res.status === 401) notifyUnauthorized();
    throw new Error(`PUT /api/sync/today -> ${res.status}`);
  }
}

export interface SyncStreamHandlers {
  onOpen?: () => void;
  onPayload?: (payload: SyncPayload, senderId: string | null) => void;
  onError?: () => void;
}

export interface SyncStream {
  close: () => void;
}

interface SseMessageEvent {
  data?: string | null;
}

// Reconnect backoff: start at 1s, double each failed attempt, cap at 30s.
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30_000;

// Opens the SSE stream and parses each `{ data, senderId }` envelope into a
// payload callback. Returns a handle whose close() tears down the connection.
//
// The stream is self-healing: if it errors or the server drops it (token
// expiry, network blip, restart), it reconnects with exponential backoff and a
// freshly fetched token on every attempt. Backoff resets once a connection
// opens. close() stops the current connection and cancels any pending retry so
// there are no leaked reconnect loops after unmount.
export function openSyncStream(
  baseUrl: string,
  clientId: string,
  handlers: SyncStreamHandlers,
): SyncStream {
  const url = `${baseUrl}/api/sync/events?clientId=${encodeURIComponent(clientId)}`;
  const isWeb =
    Platform.OS === "web" && typeof globalThis !== "undefined" && "EventSource" in globalThis;

  let closed = false;
  let current: { close: () => void } | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let attempts = 0;

  function handleData(raw: string | null | undefined): void {
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as { data?: SyncPayload | null; senderId?: string | null };
      if (parsed && parsed.data) handlers.onPayload?.(parsed.data, parsed.senderId ?? null);
    } catch {
      /* ignore malformed frame */
    }
  }

  // Tear down the failed connection (so the browser EventSource doesn't also
  // auto-reconnect with a stale token) and schedule the next attempt.
  function handleError(): void {
    if (closed) return;
    handlers.onError?.();
    current?.close();
    current = null;
    if (reconnectTimer) return; // a retry is already queued
    const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** attempts);
    attempts += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void connect();
    }, delay);
  }

  function handleOpen(): void {
    attempts = 0; // healthy connection — reset backoff
    handlers.onOpen?.();
  }

  async function connect(): Promise<void> {
    if (closed) return;
    // Fetch a fresh token on every attempt so reconnects survive token expiry.
    const token = await getAuthToken();
    if (closed) return;

    if (isWeb) {
      const ES = (globalThis as unknown as { EventSource: typeof EventSource }).EventSource;
      // The browser EventSource can't set an Authorization header, so on web we
      // pass the session bearer token as a `?token=` query param (the API promotes
      // it to a bearer header in dev/preview).
      const withAuth = token ? `${url}&token=${encodeURIComponent(token)}` : url;
      const src = new ES(withAuth);
      src.onopen = () => handleOpen();
      src.onmessage = (e: MessageEvent) => handleData(e.data as string);
      src.onerror = () => handleError();
      current = { close: () => src.close() };
      return;
    }

    // Native: react-native-sse. pollingInterval: 0 disables its built-in
    // reconnect so we own the backoff/fresh-token loop here.
    const RNEventSource = require("react-native-sse").default as new (
      url: string,
      opts?: Record<string, unknown>,
    ) => {
      addEventListener: (type: string, listener: (event: SseMessageEvent) => void) => void;
      close: () => void;
    };
    const inst = new RNEventSource(url, {
      pollingInterval: 0,
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    inst.addEventListener("open", () => handleOpen());
    inst.addEventListener("message", (event: SseMessageEvent) => handleData(event.data));
    inst.addEventListener("error", () => handleError());
    current = { close: () => inst.close() };
  }

  void connect();

  return {
    close: () => {
      closed = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      current?.close();
      current = null;
    },
  };
}
