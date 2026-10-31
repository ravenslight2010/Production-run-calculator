import {
  isValidSurplusDate,
  normalizePositiveCases,
  normalizeSurplusProduct,
  type FreezerSurplusAllocation,
  type FreezerSurplusAdjustment,
  type FreezerSurplusLedger,
  type FreezerSurplusLot,
} from "@workspace/freezer-pull";

export type {
  FreezerSurplusAllocation,
  FreezerSurplusAdjustment,
  FreezerSurplusLedger,
  FreezerSurplusLot,
};

export type FreezerSurplusConfirmation = {
  runId: string;
  runDate: string;
  brand: string;
  flavor: string;
  cases: number;
  productionDate: string | null;
  lotId: string | null;
  createdAt: string;
};

export type FreezerSurplusDecision = {
  original: FreezerSurplusConfirmation;
  current: FreezerSurplusConfirmation;
  revision: string;
  corrections: Array<{
    eventId: string;
    previousRevision: string;
    cases: number;
    productionDate: string | null;
    lotId: string | null;
    lotIds: string[];
    reason: string;
    actorId: string;
    createdAt: string;
  }>;
};

export async function fetchFreezerSurplusDecision(runId: string): Promise<FreezerSurplusDecision> {
  const response = await fetch(`/api/freezer-surplus/confirmations/${encodeURIComponent(runId)}/corrections`);
  const body = await response.json().catch(() => null) as {
    error?: unknown; original?: unknown; current?: unknown; revision?: unknown; corrections?: unknown;
  } | null;
  if (!response.ok) {
    throw new Error(typeof body?.error === "string" ? body.error : "Couldn't load this saved surplus decision.");
  }
  if (!body || typeof body.revision !== "string" || !Array.isArray(body.corrections)) {
    throw new Error("The saved surplus decision response was invalid.");
  }
  return body as unknown as FreezerSurplusDecision;
}

export async function correctFreezerSurplusDecision(input: {
  runId: string;
  eventId: string;
  previousRevision: string;
  cases: number;
  productionDate?: string;
  reason: string;
}): Promise<FreezerSurplusDecision> {
  const response = await fetch(
    `/api/freezer-surplus/confirmations/${encodeURIComponent(input.runId)}/corrections`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        eventId: input.eventId,
        previousRevision: input.previousRevision,
        cases: input.cases,
        ...(input.cases > 0 ? { productionDate: input.productionDate } : {}),
        reason: input.reason,
      }),
    },
  );
  const body = await response.json().catch(() => null) as {
    error?: unknown; original?: unknown; current?: unknown; revision?: unknown; corrections?: unknown;
  } | null;
  if (!response.ok) {
    throw new Error(typeof body?.error === "string" ? body.error : "The correction was not accepted.");
  }
  if (
    !body || typeof body.revision !== "string" || !Array.isArray(body.corrections) ||
    !body.current || typeof body.current !== "object" ||
    (body.current as Record<string, unknown>).runId !== input.runId ||
    (body.current as Record<string, unknown>).cases !== input.cases ||
    (body.current as Record<string, unknown>).productionDate !==
      (input.cases === 0 ? null : input.productionDate)
  ) {
    throw new Error("The correction acknowledgment was invalid. Reload the saved decision before retrying.");
  }
  return body as unknown as FreezerSurplusDecision;
}

export type FreezerSurplusAdjustmentInput = {
  eventId: string;
  eventType: FreezerSurplusAdjustment["eventType"];
  cases: number;
  reason: string;
  runId?: string;
  correctsEventId?: string;
};

export function getFreezerSurplusRemainingMs(input: {
  endedAt?: number | null;
  /** Compatibility field: the run's physical Freeze tunnel time in minutes. */
  freezerTimeMin: number;
  nowMs: number;
}): number {
  if (
    typeof input.endedAt !== "number" ||
    !Number.isFinite(input.endedAt) ||
    !Number.isFinite(input.freezerTimeMin) ||
    input.freezerTimeMin <= 0 ||
    !Number.isFinite(input.nowMs)
  ) {
    return 0;
  }
  return Math.max(0, input.endedAt + input.freezerTimeMin * 60000 - input.nowMs);
}

function asDateString(value: unknown): string | null {
  if (typeof value !== "string" || !isValidSurplusDate(value)) return null;
  return value;
}

export function parseFreezerSurplusLedger(value: unknown): FreezerSurplusLedger {
  if (!value || typeof value !== "object") return { lots: [], allocations: [] };
  const raw = value as { lots?: unknown; allocations?: unknown };
  const lots: FreezerSurplusLot[] = [];
  if (Array.isArray(raw.lots)) {
    for (const candidate of raw.lots) {
      if (!candidate || typeof candidate !== "object") continue;
      const lot = candidate as Record<string, unknown>;
      const product = normalizeSurplusProduct(lot.brand, lot.flavor);
      const productionDate = asDateString(lot.productionDate);
      const totalCases = normalizePositiveCases(lot.totalCases);
      const remainingCases =
        typeof lot.remainingCases === "number" &&
        Number.isSafeInteger(lot.remainingCases) &&
        lot.remainingCases >= 0
          ? lot.remainingCases
          : null;
      if (
        typeof lot.id !== "string" ||
        !product ||
        !productionDate ||
        totalCases === null ||
        remainingCases === null ||
        remainingCases > totalCases
      ) {
        continue;
      }
      lots.push({
        id: lot.id,
        ...product,
        productionDate,
        totalCases,
        remainingCases,
        ...(typeof lot.createdAt === "string" ? { createdAt: lot.createdAt } : {}),
        ...(typeof lot.updatedAt === "string" ? { updatedAt: lot.updatedAt } : {}),
      });
    }
  }
  const allocations: FreezerSurplusAllocation[] = [];
  if (Array.isArray(raw.allocations)) {
    for (const candidate of raw.allocations) {
      if (!candidate || typeof candidate !== "object") continue;
      const allocation = candidate as Record<string, unknown>;
      const product = normalizeSurplusProduct(allocation.brand, allocation.flavor);
      const runDate = asDateString(allocation.runDate);
      const cases = normalizePositiveCases(allocation.cases);
      if (
        typeof allocation.id !== "string" ||
        typeof allocation.lotId !== "string" ||
        typeof allocation.runId !== "string" ||
        !product ||
        !runDate ||
        cases === null
      ) {
        continue;
      }
      allocations.push({
        id: allocation.id,
        lotId: allocation.lotId,
        runId: allocation.runId,
        runDate,
        ...product,
        cases,
      });
    }
  }
  return { lots, allocations };
}

async function requestSurplus(path: string, init?: RequestInit): Promise<FreezerSurplusLedger> {
  const response = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
  if (!response.ok) {
    throw new Error(
      typeof body?.error === "string" ? body.error : "The freezer surplus server did not accept the request.",
    );
  }
  return parseFreezerSurplusLedger(body);
}

export function fetchFreezerSurplus(): Promise<FreezerSurplusLedger> {
  return requestSurplus("/api/freezer-surplus");
}

export function confirmFreezerSurplus(input: {
  brand: string;
  flavor: string;
  productionDate: string;
  cases: number;
}): Promise<FreezerSurplusLedger> {
  return requestSurplus("/api/freezer-surplus", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

function parseConfirmation(value: unknown): FreezerSurplusConfirmation {
  if (!value || typeof value !== "object") {
    throw new Error("The freezer surplus confirmation response was invalid. Refresh and try again.");
  }
  const receipt = value as Record<string, unknown>;
  if (
    typeof receipt.runId !== "string" ||
    !receipt.runId ||
    !isValidSurplusDate(receipt.runDate) ||
    typeof receipt.brand !== "string" ||
    typeof receipt.flavor !== "string" ||
    typeof receipt.cases !== "number" ||
    !Number.isSafeInteger(receipt.cases) ||
    receipt.cases < 0 ||
    receipt.cases > 1_000_000 ||
    !(receipt.productionDate === null || isValidSurplusDate(receipt.productionDate)) ||
    !(receipt.lotId === null || typeof receipt.lotId === "string") ||
    typeof receipt.createdAt !== "string" ||
    !Number.isFinite(Date.parse(receipt.createdAt)) ||
    (receipt.cases === 0 && (receipt.productionDate !== null || receipt.lotId !== null)) ||
    (receipt.cases > 0 && (!receipt.productionDate || !receipt.lotId))
  ) {
    throw new Error("The freezer surplus confirmation response was invalid. Refresh and try again.");
  }
  return receipt as unknown as FreezerSurplusConfirmation;
}

export async function fetchFreezerSurplusConfirmations(): Promise<FreezerSurplusConfirmation[]> {
  const response = await fetch("/api/freezer-surplus/confirmations");
  const body = (await response.json().catch(() => null)) as {
    error?: unknown;
    confirmations?: unknown;
  } | null;
  if (!response.ok) {
    throw new Error(
      typeof body?.error === "string"
        ? body.error
        : "Couldn't load saved freezer surplus confirmations.",
    );
  }
  if (!Array.isArray(body?.confirmations) || body.confirmations.length > 500) {
    throw new Error("The saved freezer surplus confirmations response was invalid.");
  }
  return body.confirmations.map(parseConfirmation);
}

export async function confirmFreezerSurplusOutcome(input: {
  runId: string;
  cases: number;
  productionDate?: string;
}): Promise<FreezerSurplusConfirmation> {
  const response = await fetch("/api/freezer-surplus/confirmations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = (await response.json().catch(() => null)) as {
    error?: unknown;
    confirmation?: unknown;
  } | null;
  if (!response.ok) {
    throw new Error(
      typeof body?.error === "string"
        ? body.error
        : "The freezer surplus outcome was not saved. Check your connection and try again.",
    );
  }
  const confirmation = parseConfirmation(body?.confirmation);
  if (
    confirmation.runId !== input.runId ||
    confirmation.cases !== input.cases ||
    confirmation.productionDate !== (input.cases === 0 ? null : input.productionDate)
  ) {
    throw new Error(
      "The saved freezer surplus outcome did not match this form. Refresh before retrying.",
    );
  }
  return confirmation;
}

export function replaceFreezerSurplusAllocation(input: {
  runId: string;
  runDate: string;
  brand: string;
  flavor: string;
  allocations: Array<{ lotId: string; cases: number }>;
}): Promise<FreezerSurplusLedger> {
  return requestSurplus(`/api/freezer-surplus/allocations/${encodeURIComponent(input.runId)}`, {
    method: "PUT",
    body: JSON.stringify({
      runDate: input.runDate,
      brand: input.brand,
      flavor: input.flavor,
      allocations: input.allocations,
    }),
  });
}

export async function fetchFreezerSurplusAdjustments(): Promise<FreezerSurplusAdjustment[]> {
  const response = await fetch("/api/freezer-surplus/adjustments");
  const body = (await response.json().catch(() => null)) as {
    error?: unknown;
    adjustments?: unknown;
  } | null;
  if (!response.ok) {
    throw new Error(
      typeof body?.error === "string" ? body.error : "Couldn't load finished-case adjustment history.",
    );
  }
  if (!Array.isArray(body?.adjustments)) {
    throw new Error("The finished-case adjustment history response was invalid.");
  }
  const adjustments = body.adjustments.filter((value): value is FreezerSurplusAdjustment => {
    if (!value || typeof value !== "object") return false;
    const event = value as Record<string, unknown>;
    return (
      typeof event.eventId === "string" &&
      typeof event.lotId === "string" &&
      (event.eventType === "damage" || event.eventType === "return" || event.eventType === "correction") &&
      typeof event.cases === "number" &&
      Number.isSafeInteger(event.cases) &&
      typeof event.reason === "string" &&
      typeof event.actorId === "string" &&
      typeof event.createdAt === "string"
    );
  });
  if (adjustments.length !== body.adjustments.length) {
    throw new Error("The finished-case adjustment history contained an invalid event.");
  }
  return adjustments;
}

export async function recordFreezerSurplusAdjustment(
  lotId: string,
  input: FreezerSurplusAdjustmentInput,
): Promise<{ ledger: FreezerSurplusLedger; adjustment: FreezerSurplusAdjustment }> {
  const response = await fetch(`/api/freezer-surplus/lots/${encodeURIComponent(lotId)}/adjustments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = (await response.json().catch(() => null)) as {
    error?: unknown;
    createdAdjustment?: unknown;
    lots?: unknown;
    allocations?: unknown;
  } | null;
  if (!response.ok) {
    throw new Error(
      typeof body?.error === "string" ? body.error : "The finished-case adjustment was not accepted.",
    );
  }
  const event = body?.createdAdjustment;
  if (!event || typeof event !== "object") {
    throw new Error("The finished-case adjustment response was invalid.");
  }
  const parsedEvent = event as Record<string, unknown>;
  if (
    typeof parsedEvent.eventId !== "string" ||
    typeof parsedEvent.lotId !== "string" ||
    (parsedEvent.eventType !== "damage" &&
      parsedEvent.eventType !== "return" &&
      parsedEvent.eventType !== "correction") ||
    typeof parsedEvent.cases !== "number" ||
    !Number.isSafeInteger(parsedEvent.cases) ||
    typeof parsedEvent.reason !== "string" ||
    typeof parsedEvent.actorId !== "string" ||
    typeof parsedEvent.createdAt !== "string"
  ) {
    throw new Error("The finished-case adjustment response was invalid.");
  }
  return {
    ledger: parseFreezerSurplusLedger(body),
    adjustment: parsedEvent as unknown as FreezerSurplusAdjustment,
  };
}