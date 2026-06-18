// Transport for live sync: REST helpers + a cross-platform Server-Sent Events
// stream. React Native has no native EventSource, so on native we use the
// `react-native-sse` polyfill; on web we use the browser's global EventSource.

import AsyncStorage from "@react-native-async-storage/async-storage";
import { getAuthToken } from "@workspace/api-client-react";
import { Platform } from "react-native";
import type { SyncPayload } from "./payloadTypes";

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

// Mobile has no browser cookie jar, so the Clerk bearer token must be attached
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
  if (!res.ok) throw new Error(`GET /api/sync/today -> ${res.status}`);
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
  if (!res.ok) throw new Error(`PUT /api/sync/today -> ${res.status}`);
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

// Opens the SSE stream and parses each `{ data, senderId }` envelope into a
// payload callback. Returns a handle whose close() tears down the connection.
export function openSyncStream(
  baseUrl: string,
  clientId: string,
  handlers: SyncStreamHandlers,
): SyncStream {
  const url = `${baseUrl}/api/sync/events?clientId=${encodeURIComponent(clientId)}`;

  function handleData(raw: string | null | undefined): void {
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as { data?: SyncPayload | null; senderId?: string | null };
      if (parsed && parsed.data) handlers.onPayload?.(parsed.data, parsed.senderId ?? null);
    } catch {
      /* ignore malformed frame */
    }
  }

  if (Platform.OS === "web" && typeof globalThis !== "undefined" && "EventSource" in globalThis) {
    const ES = (globalThis as unknown as { EventSource: typeof EventSource }).EventSource;
    const es = new ES(url);
    es.onopen = () => handlers.onOpen?.();
    es.onmessage = (e: MessageEvent) => handleData(e.data as string);
    es.onerror = () => handlers.onError?.();
    return { close: () => es.close() };
  }

  // Native: react-native-sse. Resolve the bearer token first (async), then open
  // the stream with an Authorization header. close() is safe before connect.
  let closed = false;
  let es: { close: () => void } | null = null;
  void (async () => {
    const token = await getAuthToken();
    if (closed) return;
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
    inst.addEventListener("open", () => handlers.onOpen?.());
    inst.addEventListener("message", (event: SseMessageEvent) => handleData(event.data));
    inst.addEventListener("error", () => handlers.onError?.());
    es = inst;
  })();
  return {
    close: () => {
      closed = true;
      es?.close();
    },
  };
}
