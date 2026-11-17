const STORAGE_KEY = "run-calculator.alert-receipts.v1";
const MAX_RECEIPTS = 200;
const DB_NAME = "run-calculator-alerts";
const STORE_NAME = "receipts";
let lastReceiptStamp = 0;

function fallbackRead(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string").slice(-MAX_RECEIPTS) : [];
  } catch { return []; }
}

function fallbackRecord(alertId: string): void {
  if (typeof localStorage === "undefined") return;
  const ids = fallbackRead().filter((id) => id !== alertId);
  ids.push(alertId);
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(ids.slice(-MAX_RECEIPTS))); } catch { /* optional fallback */ }
}

function fallbackClaim(alertId: string): boolean {
  if (typeof localStorage === "undefined") return true;
  if (fallbackRead().includes(alertId)) return false;
  fallbackRecord(alertId);
  return true;
}

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME, { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Shared by pages and the service worker; IndexedDB survives either context. */
export async function recordAlertReceipt(alertId: string): Promise<void> {
  if (!alertId) return;
  try {
    const db = await database();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      lastReceiptStamp = Math.max(Date.now(), lastReceiptStamp + 1);
      store.put({ id: alertId, at: lastReceiptStamp });
      const all = store.getAll() as IDBRequest<Array<{ id: string; at: number }>>;
      all.onsuccess = () => {
        // Keep the most recently recorded IDs, regardless of their lexical ID.
        all.result.sort((a, b) => b.at - a.at).slice(MAX_RECEIPTS)
          .forEach((entry) => store.delete(entry.id));
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch { fallbackRecord(alertId); }
}

/**
 * Atomically claims the right to display one logical alert across the page and
 * service-worker contexts. IndexedDB's unique object-store key makes add()
 * the compare-and-set; only the successful claimant may show an OS notice.
 */
export async function claimAlertReceipt(alertId: string): Promise<boolean> {
  if (!alertId) return false;
  try {
    const db = await database();
    const claimed = await new Promise<boolean>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      lastReceiptStamp = Math.max(Date.now(), lastReceiptStamp + 1);
      const request = store.add({ id: alertId, at: lastReceiptStamp });
      let inserted = false;
      request.onsuccess = () => {
        inserted = true;
        const all = store.getAll() as IDBRequest<Array<{ id: string; at: number }>>;
        all.onsuccess = () => {
          all.result.sort((a, b) => b.at - a.at).slice(MAX_RECEIPTS)
            .forEach((entry) => store.delete(entry.id));
        };
      };
      request.onerror = (event) => {
        if (request.error?.name === "ConstraintError") {
          event.preventDefault();
          event.stopPropagation();
          resolve(false);
          return;
        }
        reject(request.error);
      };
      tx.oncomplete = () => resolve(inserted);
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    return claimed;
  } catch {
    return fallbackClaim(alertId);
  }
}

export async function hasAlertReceipt(alertId: string | undefined): Promise<boolean> {
  if (!alertId) return false;
  try {
    const db = await database();
    const found = await new Promise<boolean>((resolve, reject) => {
      const request = db.transaction(STORE_NAME).objectStore(STORE_NAME).getKey(alertId);
      request.onsuccess = () => resolve(request.result !== undefined);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return found;
  } catch { return typeof localStorage !== "undefined" && fallbackRead().includes(alertId); }
}

/** Starts the client bridge once; notifications can arrive while a tab is open. */
export function installAlertReceiptListener(): void {
  if (typeof navigator === "undefined" || !navigator.serviceWorker) return;
  navigator.serviceWorker.addEventListener("message", (event: MessageEvent<unknown>) => {
    const data = event.data;
    if (data && typeof data === "object" && (data as { type?: unknown }).type === "alert-receipt") {
      const alertId = (data as { alertId?: unknown }).alertId;
      if (typeof alertId === "string") void recordAlertReceipt(alertId);
    }
  });
}