export const CALCULATOR_MANUAL_SECTION_ERROR_EVENT =
  "calculator-manual-section-error";

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