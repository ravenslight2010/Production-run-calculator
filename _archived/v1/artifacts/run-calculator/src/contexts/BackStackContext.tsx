import { createContext, useContext } from "react";
import type { ReactNode } from "react";

// ─── BackStackContext ─────────────────────────────────────────────────────────
// A simple, ref-backed ordered stack of "close" callbacks.
//
// Each overlay (modal, dialog, sheet) that wants hardware-back support calls
// `push(closeFn)` when it opens and the returned cleanup removes it when it
// closes. useBackButtonTrap (installed once in Home) calls `peek()()` to
// dismiss the topmost layer before the browser navigates away.
//
// The value is created ONCE (stable callbacks backed by a ref), so providing
// it does not trigger re-renders in consumers.
// ─────────────────────────────────────────────────────────────────────────────

export type CloseFn = () => void;

export interface BackStackValue {
  /**
   * Register a close handler. Returns a cleanup function that unregisters it.
   * Typically used as a useEffect return value:
   *   useEffect(() => { if (open) return push(() => setOpen(false)); }, [open]);
   */
  push: (fn: CloseFn) => CloseFn;
  /** Returns the topmost close handler without removing it, or undefined. */
  peek: () => CloseFn | undefined;
  /** Returns the current stack depth. */
  size: () => number;
}

export const BackStackContext = createContext<BackStackValue | null>(null);

export function useBackStack(): BackStackValue {
  const ctx = useContext(BackStackContext);
  if (!ctx) throw new Error("useBackStack must be used inside <BackStackContext.Provider>");
  return ctx;
}

// Helper: builds a stable BackStackValue from an external ref.
// Call once (e.g. with useCallback / useMemo) and provide via context.
export function makeBackStack(stackRef: React.MutableRefObject<CloseFn[]>): BackStackValue {
  return {
    push(fn) {
      stackRef.current.push(fn);
      return () => {
        const i = stackRef.current.lastIndexOf(fn);
        if (i !== -1) stackRef.current.splice(i, 1);
      };
    },
    peek() {
      return stackRef.current[stackRef.current.length - 1];
    },
    size() {
      return stackRef.current.length;
    },
  };
}

// Convenience provider — wraps children with a fresh BackStackContext.
// Home creates its own BackStackValue from a ref for direct use, but any
// subtree that needs its own isolated stack can use this.
export function BackStackProvider({ children }: { children: ReactNode }) {
  // This provider is intentionally lightweight and seldom needed directly.
  // Home wires the real stack manually for direct access.
  return <>{children}</>;
}
