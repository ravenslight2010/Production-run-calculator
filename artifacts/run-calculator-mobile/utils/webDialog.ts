// Tiny presenter registry connecting notify.ts (plain functions, no React) to
// the WebDialogHost component mounted in app/_layout.tsx. On web, showNote /
// showConfirm hand their request to whatever host has registered here so the
// dialog renders as a styled in-app modal instead of a browser box. If no host
// is mounted (e.g. a call fires before the root layout renders), notify.ts
// falls back to window.alert / window.confirm so nothing is silently dropped.

export type WebDialogRequest = {
  kind: "note" | "confirm";
  title: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
  destructive?: boolean;
  onConfirm?: () => void;
  onCancel?: () => void;
};

type Presenter = (req: WebDialogRequest) => void;

let presenter: Presenter | null = null;

export function registerWebDialogPresenter(fn: Presenter): () => void {
  presenter = fn;
  return () => {
    if (presenter === fn) presenter = null;
  };
}

/** Returns true if a host handled the request, false if the caller must fall back. */
export function presentWebDialog(req: WebDialogRequest): boolean {
  if (!presenter) return false;
  presenter(req);
  return true;
}
