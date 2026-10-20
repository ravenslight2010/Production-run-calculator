import {
  isManualSectionRejectionCode,
  type ManualSectionRejectionCode,
} from "@workspace/sync-contract";

export const CALCULATOR_MANUAL_SECTION_ERROR_EVENT =
  "calculator-manual-section-error";

const REJECTION_MESSAGES: Record<ManualSectionRejectionCode, string> = {
  invalid_edit: "This section could not be saved. Your edits are still here; check them and try again.",
  invalid_values: "Some values were not accepted. Your edits are still here; correct them and save again.",
  invalid_baseline: "The section could not be checked. Your edits are still here; review them and save again.",
  reset_changed: "Today's data changed while saving. Your edits are still here; check with a manager before retrying.",
  run_changed: "This run changed while saving. Your edits are still here; review the run and save again.",
  section_changed: "This section changed on another device. Your edits are still here; compare the latest counts and save again.",
};

export function manualSectionRejectionMessage(code: unknown): string {
  return isManualSectionRejectionCode(code)
    ? REJECTION_MESSAGES[code]
    : "This section could not be saved. Your edits are still here; review them and try again.";
}

export type ManualSectionErrorDetail = {
  runId: string;
  section: string;
  failure?: string;
  message: string;
};

export function emitManualSectionError(detail: ManualSectionErrorDetail): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(CALCULATOR_MANUAL_SECTION_ERROR_EVENT, { detail }),
  );
}

export function subscribeToManualSectionErrors(
  onError: (message: string) => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  const listener = (event: Event) => {
    const message = (event as CustomEvent<{ message?: unknown }>).detail?.message;
    if (typeof message === "string" && message.trim()) onError(message);
  };
  window.addEventListener(CALCULATOR_MANUAL_SECTION_ERROR_EVENT, listener);
  return () =>
    window.removeEventListener(CALCULATOR_MANUAL_SECTION_ERROR_EVENT, listener);
}