import { useCallback, useEffect, useRef, useState } from "react";

// Minimal shape of the authenticated user this hook needs. The server exposes
// `onboardingSeen` per user; `false` means the first-login overview has not yet
// been acknowledged.
export interface OnboardingMe {
  onboardingSeen?: boolean | null;
}

export interface GetStartedOverview {
  // Whether the overview is currently visible.
  open: boolean;
  // Raw setter, used directly as a dialog/modal `onOpenChange`.
  setOpen: (open: boolean) => void;
  // Reopen the overview on demand (e.g. from the header menu).
  openOverview: () => void;
  // Mark the overview seen once, if it hasn't been already. Idempotent.
  dismiss: () => void;
  // Close the overview and mark it seen in one step.
  closeOverview: () => void;
}

/**
 * Drives the first-login "Get Started" overview for both the web and mobile
 * apps so the behavior stays in lockstep (web/mobile parity).
 *
 * Behavior:
 * - Auto-opens exactly once when the server reports `onboardingSeen === false`.
 * - A `useRef` latch guarantees it never auto-reopens within the session, even
 *   if `me` re-emits while still unseen (e.g. before the seen flag round-trips).
 * - `openOverview` always reopens it on demand (header menu), bypassing the latch.
 * - Dismissing marks it seen exactly once.
 */
export function useGetStartedOverview(
  me: OnboardingMe | null | undefined,
  markOnboardingSeen: () => unknown,
): GetStartedOverview {
  const [open, setOpen] = useState(false);
  const autoOpened = useRef(false);

  useEffect(() => {
    if (autoOpened.current) return;
    if (me && me.onboardingSeen === false) {
      autoOpened.current = true;
      setOpen(true);
    }
  }, [me]);

  const dismiss = useCallback(() => {
    if (me && me.onboardingSeen === false) void markOnboardingSeen();
  }, [me, markOnboardingSeen]);

  const openOverview = useCallback(() => setOpen(true), []);

  const closeOverview = useCallback(() => {
    setOpen(false);
    dismiss();
  }, [dismiss]);

  return { open, setOpen, openOverview, dismiss, closeOverview };
}
