import { useCallback, useEffect, useRef, useState } from "react";

// Minimal shape of the authenticated user this hook needs. The server exposes
// `onboardingSeen` per user; `false` means the first-login overview has not yet
// been acknowledged.
export interface OnboardingMe {
  userId?: string;
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
 * - Auto-opens once per user when the server reports `onboardingSeen === false`.
 * - A `useRef` latch guarantees it never auto-reopens within the session, even
 *   if `me` re-emits while still unseen (e.g. before the seen flag round-trips).
 * - `openOverview` always reopens it on demand (header menu), bypassing the latch.
 * - Dismissing acknowledges the same user whose unseen state opened it, exactly once.
 */
export function useGetStartedOverview(
  me: OnboardingMe | null | undefined,
  markOnboardingSeen: () => unknown,
): GetStartedOverview {
  const [open, setOpen] = useState(false);
  const activeUserId = useRef<string | null>(null);
  const autoOpened = useRef(false);
  const pendingAcknowledgementUserId = useRef<string | null>(null);
  const pendingAcknowledgementWithoutUserId = useRef(false);
  const acknowledgementStarted = useRef(false);

  useEffect(() => {
    const userId = me?.userId ?? null;
    if (activeUserId.current !== userId) {
      activeUserId.current = userId;
      autoOpened.current = false;
      pendingAcknowledgementUserId.current = null;
      pendingAcknowledgementWithoutUserId.current = false;
      acknowledgementStarted.current = false;
      setOpen(false);
    }

    if (autoOpened.current) return;
    if (me && me.onboardingSeen === false) {
      autoOpened.current = true;
      if (userId) {
        pendingAcknowledgementUserId.current = userId;
      } else {
        pendingAcknowledgementWithoutUserId.current = true;
      }
      setOpen(true);
    }
  }, [me]);

  const dismiss = useCallback(() => {
    const pendingForCurrentUser =
      pendingAcknowledgementUserId.current !== null
        ? me?.userId === pendingAcknowledgementUserId.current
        : pendingAcknowledgementWithoutUserId.current &&
          me?.onboardingSeen === false;

    if (pendingForCurrentUser && !acknowledgementStarted.current) {
      // The dialog's action closes the dialog and also triggers onOpenChange.
      // Keep the acknowledgement tied to the user whose unseen state opened
      // it, even if a same-user refresh updates onboardingSeen before dismissal.
      acknowledgementStarted.current = true;
      pendingAcknowledgementUserId.current = null;
      pendingAcknowledgementWithoutUserId.current = false;
      void markOnboardingSeen();
    }
  }, [me, markOnboardingSeen]);

  const openOverview = useCallback(() => setOpen(true), []);

  const closeOverview = useCallback(() => {
    setOpen(false);
    dismiss();
  }, [dismiss]);

  return { open, setOpen, openOverview, dismiss, closeOverview };
}
