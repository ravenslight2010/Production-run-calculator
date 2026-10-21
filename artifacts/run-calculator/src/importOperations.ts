/**
 * Client contract for the server-owned import commit boundary.
 *
 * The reviewed payload is deliberately opaque here: each importer retains its
 * own matching, pruning, redirect, and audit semantics. The server validates
 * the importer-specific payload and returns the canonical committed result.
 */

export type ImportOperationType = "spec" | "premix" | "cheese";

export type ImportOperationResult<T = unknown> = {
  operationId: string;
  status: "applied" | "undone";
  result: T;
  resultHash?: string;
  affectedCount?: number;
};

export type ImportOperationSourceEvidence = {
  sourceText: string;
  parseVersion: string;
};

export type ImportGoldCapture = {
  input: Record<string, unknown>;
};

export class ImportOperationError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly operationId?: string,
  ) {
    super(message);
    this.name = "ImportOperationError";
  }
}

const MAX_PAYLOAD_BYTES = 512_000;
const PENDING_KEY = "run-calculator.pending-import-operations.v1";

export type PendingImportOperation = { operationId: string; payload: unknown };
export type PendingImportOperationsRead = {
  available: boolean;
  operations: PendingImportOperation[];
};
let nonBrowserPending: PendingImportOperation[] = [];

function pendingStore(): Storage | null {
  if (typeof window === "undefined") return null;
  try { return window.sessionStorage; } catch { return null; }
}

function readPendingState(): PendingImportOperationsRead {
  if (typeof window === "undefined") {
    return { available: true, operations: [...nonBrowserPending] };
  }
  const store = pendingStore();
  if (!store) return { available: false, operations: [] };
  try {
    const raw = store.getItem(PENDING_KEY);
    if (raw === null) return { available: true, operations: [] };
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return { available: false, operations: [] };
    const valid = value.every((item) =>
      !!item &&
      typeof item === "object" &&
      typeof item.operationId === "string" &&
      "payload" in item,
    );
    if (!valid) return { available: false, operations: [] };
    return {
      available: true,
      operations: (value as PendingImportOperation[]).slice(-12),
    };
  } catch {
    return { available: false, operations: [] };
  }
}

function readPending(): PendingImportOperation[] {
  return readPendingState().operations;
}

function writePending(items: PendingImportOperation[]): void {
  if (typeof window === "undefined") {
    nonBrowserPending = items.slice(-12);
    return;
  }
  const store = pendingStore();
  if (!store) return;
  try {
    if (!readPendingState().available) return;
    store.setItem(PENDING_KEY, JSON.stringify(items.slice(-12)));
  } catch {}
}

function rememberPending(operationId: string, payload: unknown): boolean {
  if (typeof window === "undefined") {
    writePending([
      ...readPending().filter((x) => x.operationId !== operationId),
      { operationId, payload },
    ]);
    return readPending().some((item) =>
      item.operationId === operationId && sameJson(item.payload, payload),
    );
  }
  const store = pendingStore();
  if (!store) return false;
  try {
    const state = readPendingState();
    if (!state.available) return false;
    const items = [
      ...state.operations.filter((x) => x.operationId !== operationId),
      { operationId, payload },
    ].slice(-12);
    store.setItem(PENDING_KEY, JSON.stringify(items));
    return readPending().some((item) =>
      item.operationId === operationId && sameJson(item.payload, payload),
    );
  } catch {
    return false;
  }
}

export function clearPendingImportOperation(operationId: string): void {
  writePending(readPending().filter((x) => x.operationId !== operationId));
}

export function listPendingImportOperations(): PendingImportOperation[] {
  return readPending().map((operation) => ({ ...operation }));
}

export function readPendingImportOperations(): PendingImportOperationsRead {
  const state = readPendingState();
  return {
    available: state.available,
    operations: state.operations.map((operation) => ({ ...operation })),
  };
}

function pendingPayload(operationId: string): unknown {
  return readPending().find((x) => x.operationId === operationId)?.payload;
}

function jsonBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function assertOperationId(operationId: string): string {
  const normalized = operationId.trim();
  if (!/^[a-zA-Z0-9_-]{16,120}$/.test(normalized)) {
    throw new ImportOperationError("Invalid import operation identity.");
  }
  return normalized;
}

export function createImportOperationId(): string {
  const uuid = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  return `import-${uuid}`;
}

function validateResponse<T>(
  body: unknown,
  operationId: string,
  expectedStatus: "applied" | "undone",
): ImportOperationResult<T> {
  if (!body || typeof body !== "object") {
    throw new ImportOperationError("The server returned an invalid import result.", undefined, operationId);
  }
  const value = body as Record<string, unknown>;
  const operation = value.operation;
  const candidate = operation && typeof operation === "object"
    ? operation as Record<string, unknown>
    : value;
  if (
    candidate.operationId !== operationId ||
    candidate.status !== expectedStatus ||
    !("result" in candidate)
  ) {
    throw new ImportOperationError("The server did not confirm the committed import.", undefined, operationId);
  }
  return {
    operationId,
    status: expectedStatus,
    result: candidate.result as T,
    ...(typeof candidate.resultHash === "string" ? { resultHash: candidate.resultHash } : {}),
    ...(typeof candidate.affectedCount === "number" ? { affectedCount: candidate.affectedCount } : {}),
  };
}

async function postOperation<T>(
  operationId: string,
  action: "apply" | "undo",
  body: unknown,
  expectedStatus: "applied" | "undone",
): Promise<ImportOperationResult<T>> {
  const id = assertOperationId(operationId);
  // A retry must use the exact bytes reviewed on the first attempt. Do not
  // silently substitute the old request if the caller has rebuilt a different
  // review: the server may already have committed the first request, and
  // adopting a projection for a different payload would lose the user's edits.
  const pendingState = action === "apply" ? readPendingState() : null;
  if (pendingState && !pendingState.available) {
    throw new ImportOperationError(
      "Browser storage is unavailable or damaged, so the exact reviewed request cannot be checked. No new import was sent. Enable site storage and reload before recovering or starting another import.",
      0,
      id,
    );
  }
  const pending = action === "apply"
    ? pendingState?.operations.find((item) => item.operationId === id)?.payload
    : undefined;
  const earlier = action === "apply"
    ? pendingState?.operations.find((item) => item.operationId !== id)
    : undefined;
  if (action === "apply" && pending === undefined && earlier) {
    throw new ImportOperationError(
      "An earlier import is still unconfirmed. Recover its exact saved request before starting another import; no new request was sent.",
      undefined,
      earlier.operationId,
    );
  }
  if (pending !== undefined && !sameJson(pending, body)) {
    throw new ImportOperationError(
      "An earlier attempt for this import is still unconfirmed. The reviewed changes differ, so no new request was sent. Retry the exact earlier request before starting another import.",
      undefined,
      id,
    );
  }
  const retryBody = pending ?? body;
  if (jsonBytes(retryBody) > MAX_PAYLOAD_BYTES) {
    throw new ImportOperationError("This reviewed import is too large to commit.", 413, id);
  }
  if (action === "apply" && pending === undefined && !rememberPending(id, retryBody)) {
    throw new ImportOperationError(
      "This browser could not save the exact reviewed request for safe recovery, so no import was sent. Enable session storage and review again.",
      0,
      id,
    );
  }
  let response: Response;
  try {
    response = await fetch(`/api/import-operations/${encodeURIComponent(id)}/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(retryBody),
    });
  } catch (cause) {
    throw new ImportOperationError(
      "The import result could not be confirmed. Keep this review open and retry the same operation.",
      undefined,
      id,
    );
  }
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    // The status below remains the source of truth; never adopt an empty body.
  }
  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && typeof (payload as Record<string, unknown>).error === "string"
        ? String((payload as Record<string, unknown>).error)
        : action === "undo"
          ? "The import could not be undone. Refresh and check whether later edits exist."
          : "The import was not committed. Review it again or retry the same operation.";
    throw new ImportOperationError(message, response.status, id);
  }
  const result = validateResponse<T>(payload, id, expectedStatus);
  if (action === "apply") clearPendingImportOperation(id);
  return result;
}

export async function retryPendingImportOperation<T = unknown>(
  operationId: string,
): Promise<ImportOperationResult<T>> {
  const id = assertOperationId(operationId);
  const payload = pendingPayload(id);
  if (payload === undefined) {
    throw new ImportOperationError(
      "The exact earlier import request is not available in this browser session.",
      undefined,
      id,
    );
  }
  return postOperation<T>(id, "apply", payload, "applied");
}

export function applyImportOperation<T>(
  operationId: string,
  payload: {
    importType: ImportOperationType;
    sourceKey?: string;
    sourceLabel: string;
    changes: Record<string, unknown>;
    sourceEvidence?: ImportOperationSourceEvidence;
    goldCapture?: ImportGoldCapture;
    expectedStateHash?: string;
    requestHash?: string;
  },
): Promise<ImportOperationResult<T>> {
  return postOperation<T>(operationId, "apply", payload, "applied");
}

export function undoImportOperation<T = unknown>(
  operationId: string,
  expectedResultHash: string,
): Promise<ImportOperationResult<T>> {
  return postOperation<T>(operationId, "undo", { expectedResultHash }, "undone");
}