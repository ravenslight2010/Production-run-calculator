import { useCallback, useEffect, useRef, useState } from "react";

// One-click Chromecast via the browser Presentation API (Chrome/Edge only).
// Each station screen gets its own PresentationRequest so multiple screens can
// be presented to multiple Cast devices at once (one presentation per device).
// All logic fails soft: unsupported browsers get `supported: false` and no-ops.

// Minimal Presentation API typings (not included in this project's TS DOM lib).
type PresentationConnectionState = "connecting" | "connected" | "closed" | "terminated";
interface PresentationConnection extends EventTarget {
  readonly id: string;
  readonly state: PresentationConnectionState;
  close(): void;
  terminate(): void;
}
interface PresentationRequestCtor {
  new (urls: string[]): {
    start(): Promise<PresentationConnection>;
    reconnect(id: string): Promise<PresentationConnection>;
  };
}
declare const PresentationRequest: PresentationRequestCtor;

const CAST_IDS_KEY = "cast-presentation-ids-v1";

type StoredCast = { id: string; url: string };
type StoredCasts = Record<string, StoredCast>;

export type CastStatus = "connecting" | "connected";

export function presentationCastSupported(): boolean {
  try {
    return typeof window !== "undefined" && "PresentationRequest" in window;
  } catch {
    return false;
  }
}

function loadStoredCasts(): StoredCasts {
  try {
    const raw = localStorage.getItem(CAST_IDS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed as StoredCasts;
  } catch {
    // ignore
  }
  return {};
}

function saveStoredCast(key: string, entry: StoredCast | null) {
  try {
    const all = loadStoredCasts();
    if (entry) all[key] = entry;
    else delete all[key];
    localStorage.setItem(CAST_IDS_KEY, JSON.stringify(all));
  } catch {
    // ignore
  }
}

export function usePresentationCast(enabled: boolean) {
  const supported = presentationCastSupported();
  const active = supported && enabled;
  const [casts, setCasts] = useState<Record<string, CastStatus>>({});
  const connectionsRef = useRef<Record<string, PresentationConnection>>({});
  const triedReconnectRef = useRef(false);

  const detach = useCallback((key: string) => {
    delete connectionsRef.current[key];
    saveStoredCast(key, null);
    setCasts(prev => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  const wireConnection = useCallback(
    (key: string, url: string, connection: PresentationConnection) => {
      connectionsRef.current[key] = connection;
      saveStoredCast(key, { id: connection.id ?? "", url });
      const markConnected = () =>
        setCasts(prev => ({ ...prev, [key]: "connected" }));
      setCasts(prev => ({
        ...prev,
        [key]: connection.state === "connected" ? "connected" : "connecting",
      }));
      connection.addEventListener("connect", markConnected);
      const onGone = () => {
        // Only detach if this is still the tracked connection for the key.
        if (connectionsRef.current[key] === connection) detach(key);
      };
      connection.addEventListener("close", onGone);
      connection.addEventListener("terminate", onGone);
      if (connection.state === "closed" || connection.state === "terminated") {
        onGone();
      }
    },
    [detach],
  );

  const startCast = useCallback(
    async (key: string, url: string): Promise<{ ok: boolean; error?: string }> => {
      if (!active) return { ok: false, error: "Casting is not supported in this browser." };
      try {
        const request = new PresentationRequest([url]);
        const connection = await request.start();
        wireConnection(key, url, connection);
        return { ok: true };
      } catch (err) {
        const name = err instanceof DOMException ? err.name : "";
        if (name === "NotAllowedError" || name === "AbortError") {
          // User dismissed the device picker — not an error.
          return { ok: true };
        }
        if (name === "NotFoundError") {
          return { ok: false, error: "No Cast devices found on this network." };
        }
        return { ok: false, error: "Could not start casting. Try the QR code or URL instead." };
      }
    },
    [active, wireConnection],
  );

  const stopCast = useCallback(
    (key: string) => {
      const connection = connectionsRef.current[key];
      if (connection) {
        try {
          connection.terminate();
        } catch {
          try {
            connection.close();
          } catch {
            // ignore
          }
        }
      }
      detach(key);
    },
    [detach],
  );

  // Attempt to reconnect to presentations that survived a page reload.
  useEffect(() => {
    if (!active || triedReconnectRef.current) return;
    triedReconnectRef.current = true;
    const stored = loadStoredCasts();
    for (const [key, entry] of Object.entries(stored)) {
      if (!entry?.id || !entry?.url) {
        saveStoredCast(key, null);
        continue;
      }
      (async () => {
        try {
          const request = new PresentationRequest([entry.url]);
          const connection = await request.reconnect(entry.id);
          wireConnection(key, entry.url, connection);
        } catch {
          // Presentation is gone (or reconnect unsupported) — forget it.
          saveStoredCast(key, null);
        }
      })();
    }
  }, [active, wireConnection]);

  return { supported, casts, startCast, stopCast };
}
