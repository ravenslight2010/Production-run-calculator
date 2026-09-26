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

type PendingOperation = { operationId: string; payload: unknown };

function pendingStore(): Storage | null {
  if (typeof window === "undefined") return null;
  try { return window.sessionStorage; } catch { return null; }
}

function readPending(): PendingOperation[] {
  const store = pendingStore();
  if (!store) return [];
  try {
    const value = JSON.parse(store.getItem(PENDING_KEY) ?? "[]");
    return Array.isArray(value) ? value.filter((x): x is PendingOperation =>
      !!x && typeof x.operationId === "string" && "payload" in x).slice(-12) : [];
  } catch { return []; }
}

function writePending(items: PendingOperation[]): void {
  const store = pendingStore();
  if (!store) return;
  try { store.setItem(PENDING_KEY, JSON.stringify(items.slice(-12))); } catch {}
}

function rememberPending(operationId: string, payload: unknown): void {
  writePending([...readPending().filter((x) => x.operationId !== operationId), { operationId, payload }]);
}

export function clearPendingImportOperation(operationId: string): void {
  writePending(readPending().filter((x) => x.operationId !== operationId));
}

function pendingPayload(operationId: string): unknown {
  return readPending().find((x) => x.operationId === operationId)?.payload;
}

function jsonBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
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
  // A retry must use the exact bytes reviewed on the first attempt. This also
  // protects against a caller rebuilding a payload from a now-mutated cache.
  const retryBody = action === "apply" ? (pendingPayload(id) ?? body) : body;
  if (jsonBytes(retryBody) > MAX_PAYLOAD_BYTES) {
    throw new ImportOperationError("This reviewed import is too large to commit.", 413, id);
  }
  if (action === "apply") rememberPending(id, retryBody);
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

export function applyImportOperation<T>(
  operationId: string,
  payload: {
    importType: ImportOperationType;
    sourceKey?: string;
    sourceLabel: string;
    changes: Record<string, unknown>;
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