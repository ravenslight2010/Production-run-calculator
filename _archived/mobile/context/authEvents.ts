// Cross-module bridge for "the session ended" signals.
//
// The REST client (inventoryShared) and the live-sync client (sync/client) both
// make authenticated requests but neither owns auth state. When one of them sees
// a 401 on an already-signed-in request — most often because the daily reset
// advanced the server-side session boundary — it calls notifyUnauthorized() so
// the AuthProvider (which registers the handler) can drop back to signed-out.

let handler: (() => void) | null = null;

export function setUnauthorizedHandler(fn: (() => void) | null): void {
  handler = fn;
}

export function notifyUnauthorized(): void {
  handler?.();
}
