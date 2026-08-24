import { useEffect, useRef } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Accessibility behavior for the app's legacy div-based overlays.
 *
 * Radix dialogs provide this behavior themselves; this hook keeps the older
 * review/settings overlays equivalent without changing how they are opened.
 */
export function useAccessibleDialog<T extends HTMLElement>(
  open: boolean,
  onClose: () => void,
) {
  const dialogRef = useRef<T>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;

    const dialog = dialogRef.current;
    if (!dialog) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const focusable = () => Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE))
      .filter((element) => element.offsetWidth > 0 || element.offsetHeight > 0);
    const first = focusable()[0];
    (first ?? dialog).focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;

      const controls = focusable();
      if (controls.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const current = document.activeElement;
      const index = controls.indexOf(current as HTMLElement);
      if (event.shiftKey && (index <= 0 || current === dialog)) {
        event.preventDefault();
        controls[controls.length - 1].focus();
      } else if (!event.shiftKey && index === controls.length - 1) {
        event.preventDefault();
        controls[0].focus();
      }
    };

    dialog.addEventListener("keydown", handleKeyDown);
    return () => {
      dialog.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus?.();
    };
  }, [open]);

  return dialogRef;
}

/** Focus management for pages containing several conditionally-rendered overlays. */
export function useAccessibleDialogStack() {
  useEffect(() => {
    let activeDialog: HTMLElement | null = null;
    let previouslyFocused: HTMLElement | null = null;

    const visibleDialog = () =>
      Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]'))
        .filter((element) => element.offsetWidth > 0 || element.offsetHeight > 0)
        .at(-1) ?? null;
    const focusable = (dialog: HTMLElement) =>
      Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE))
        .filter((element) => element.offsetWidth > 0 || element.offsetHeight > 0);
    const sync = () => {
      const next = visibleDialog();
      if (next === activeDialog) return;
      previouslyFocused = document.activeElement as HTMLElement | null;
      activeDialog = next;
      if (activeDialog) (focusable(activeDialog)[0] ?? activeDialog).focus();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      const dialog = visibleDialog();
      if (!dialog) return;
      if (event.key === "Escape") {
        event.preventDefault();
        dialog.querySelector<HTMLElement>('[aria-label^="Close"]')?.click();
        return;
      }
      if (event.key !== "Tab") return;
      const controls = focusable(dialog);
      if (controls.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const index = controls.indexOf(document.activeElement as HTMLElement);
      if (event.shiftKey && index <= 0) {
        event.preventDefault();
        controls[controls.length - 1].focus();
      } else if (!event.shiftKey && index === controls.length - 1) {
        event.preventDefault();
        controls[0].focus();
      }
    };
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener("keydown", handleKeyDown, true);
    sync();
    return () => {
      observer.disconnect();
      document.removeEventListener("keydown", handleKeyDown, true);
      if (activeDialog && previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, []);
}