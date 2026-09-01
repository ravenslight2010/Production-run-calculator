import {
  isValidSurplusDate,
  normalizePositiveCases,
  normalizeSurplusProduct,
  type FreezerSurplusAllocation,
  type FreezerSurplusLedger,
  type FreezerSurplusLot,
} from "@workspace/freezer-pull";

export type { FreezerSurplusAllocation, FreezerSurplusLedger, FreezerSurplusLot };

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