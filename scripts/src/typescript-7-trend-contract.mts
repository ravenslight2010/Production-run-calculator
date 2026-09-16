export const TYPESCRIPT_7_HISTORY_LIMIT = 5;

export function validateTypescript7HistoryLimit(historyLimit: number): void {
  if (!Number.isSafeInteger(historyLimit) || historyLimit < 1) {
    throw new Error(
      `TypeScript 7 history limit must be a positive safe integer; received ${historyLimit}.`,
    );
  }
}
