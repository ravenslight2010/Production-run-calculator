export interface BrowserRecordCodec<T> {
  decode(value: unknown): T | null;
  migrate?: (value: T) => T;
}

export interface BrowserRecord<T> {
  read(): T;
  write(value: T): boolean;
  remove(): boolean;
}

export interface BrowserRecordStore {
  record<T>(key: string, fallback: () => T, codec: BrowserRecordCodec<T>): BrowserRecord<T>;
  keys(prefix?: string): string[];
}

export interface BrowserKeyValueStorage {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function storageAvailable(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * Bounded browser persistence adapter.
 *
 * It owns JSON parsing, corruption fallback, migrations and unavailable/quota
 * failures. Domain merge policy and network synchronization never belong here.
 */
export function createBrowserRecordStore(): BrowserRecordStore {
  return {
    record<T>(key: string, fallback: () => T, codec: BrowserRecordCodec<T>): BrowserRecord<T> {
      return {
        read(): T {
          const storage = storageAvailable();
          if (!storage) return fallback();
          try {
            const raw = storage.getItem(key);
            if (raw === null) return fallback();
            const decoded = codec.decode(JSON.parse(raw));
            return decoded === null ? fallback() : (codec.migrate?.(decoded) ?? decoded);
          } catch {
            return fallback();
          }
        },
        write(value: T): boolean {
          const storage = storageAvailable();
          if (!storage) return false;
          try {
            storage.setItem(key, JSON.stringify(value));
            return true;
          } catch {
            return false;
          }
        },
        remove(): boolean {
          const storage = storageAvailable();
          if (!storage) return false;
          try {
            storage.removeItem(key);
            return true;
          } catch {
            return false;
          }
        },
      };
    },
    keys(prefix = ""): string[] {
      const storage = storageAvailable();
      if (!storage) return [];
      try {
        const keys: string[] = [];
        for (let index = 0; index < storage.length; index++) {
          const key = storage.key(index);
          if (key?.startsWith(prefix)) keys.push(key);
        }
        return keys;
      } catch {
        return [];
      }
    },
  };
}

export const browserRecordStore = createBrowserRecordStore();

/**
 * Raw key/value compatibility surface for bounded legacy migrations.
 * New JSON records should prefer browserRecordStore.record().
 */
export const browserStorage: BrowserKeyValueStorage = {
  get length() {
    return storageAvailable()?.length ?? 0;
  },
  key(index) {
    try { return storageAvailable()?.key(index) ?? null; } catch { return null; }
  },
  getItem(key) {
    try { return storageAvailable()?.getItem(key) ?? null; } catch { return null; }
  },
  setItem(key, value) {
    try { storageAvailable()?.setItem(key, value); } catch {}
  },
  removeItem(key) {
    try { storageAvailable()?.removeItem(key); } catch {}
  },
};

export const unknownCodec: BrowserRecordCodec<unknown> = {
  decode: (value) => value,
};

export function arrayCodec<T>(guard: (value: unknown) => value is T): BrowserRecordCodec<T[]> {
  return {
    decode: (value) => Array.isArray(value) ? value.filter(guard) : null,
  };
}

export function recordCodec<T>(
  guard: (value: unknown) => value is T,
): BrowserRecordCodec<Record<string, T>> {
  return {
    decode(value) {
      if (!value || typeof value !== "object" || Array.isArray(value)) return null;
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).filter((entry): entry is [string, T] => guard(entry[1])),
      );
    },
  };
}