export type SurplusProduct = {
  brand: string;
  flavor: string;
  productKey: string;
};

export type FreezerSurplusLot = SurplusProduct & {
  id: string;
  productionDate: string;
  totalCases: number;
  remainingCases: number;
  createdAt?: string;
  updatedAt?: string;
};

export type FreezerSurplusAllocation = SurplusProduct & {
  id: string;
  lotId: string;
  runId: string;
  runDate: string;
  cases: number;
};

export type FreezerSurplusLedger = {
  lots: FreezerSurplusLot[];
  allocations: FreezerSurplusAllocation[];
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function normalizeSurplusText(value: unknown, max = 120): string {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\s+/g, " ").slice(0, max);
}

export function normalizeSurplusProduct(
  brand: unknown,
  flavor: unknown,
): SurplusProduct | null {
  const normalizedBrand = normalizeSurplusText(brand);
  const normalizedFlavor = normalizeSurplusText(flavor);
  if (!normalizedBrand) return null;
  return {
    brand: normalizedBrand,
    flavor: normalizedFlavor,
    productKey: surplusProductKey(normalizedBrand, normalizedFlavor),
  };
}

export function surplusProductKey(brand: string, flavor: string): string {
  return `${normalizeSurplusText(brand).toLocaleLowerCase()}::${normalizeSurplusText(flavor).toLocaleLowerCase()}`;
}

export function isValidSurplusDate(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_RE.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function normalizePositiveCases(value: unknown): number | null {
  const cases =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isSafeInteger(cases) || cases <= 0 || cases > 1_000_000) return null;
  return cases;
}

export function effectiveProductionCases(
  originalTarget: number,
  carriedInCases: number,
): number {
  const target = Math.max(0, Math.floor(Number(originalTarget) || 0));
  const carried = Math.max(0, Math.floor(Number(carriedInCases) || 0));
  return Math.max(0, target - Math.min(target, carried));
}

export function totalAllocatedCases(
  allocations: ReadonlyArray<Pick<FreezerSurplusAllocation, "cases"> & Partial<Pick<FreezerSurplusAllocation, "runId">>>,
  runId?: string,
): number {
  return allocations.reduce(
    (sum, allocation) =>
      (!runId || allocation.runId === runId)
        ? sum + Math.max(0, Math.floor(Number(allocation.cases) || 0))
        : sum,
    0,
  );
}

export function isMatchingSurplusProduct(
  product: Pick<SurplusProduct, "brand" | "flavor">,
  candidate: Pick<SurplusProduct, "brand" | "flavor">,
): boolean {
  return surplusProductKey(product.brand, product.flavor) ===
    surplusProductKey(candidate.brand, candidate.flavor);
}

export type SurplusAllocationSelection = {
  lotId: string;
  cases: number;
};

export function summarizeSurplusForRun(args: {
  runId: string;
  brand: string;
  flavor: string;
  originalTarget: number;
  lots: ReadonlyArray<FreezerSurplusLot>;
  allocations: ReadonlyArray<FreezerSurplusAllocation>;
}) {
  const product = normalizeSurplusProduct(args.brand, args.flavor);
  const selected = product
    ? args.allocations.filter(
        (allocation) =>
          allocation.runId === args.runId &&
          isMatchingSurplusProduct(product, allocation),
      )
    : [];
  const carriedInCases = totalAllocatedCases(selected);
  return {
    originalTarget: Math.max(0, Math.floor(Number(args.originalTarget) || 0)),
    carriedInCases,
    productionCases: effectiveProductionCases(args.originalTarget, carriedInCases),
    selectedLotIds: new Set(selected.map((allocation) => allocation.lotId)),
    selected,
    availableLots: product
      ? args.lots.filter(
          (lot) => lot.remainingCases > 0 && isMatchingSurplusProduct(product, lot),
        )
      : [],
  };
}

export function isValidSurplusRunDate(value: unknown): value is string {
  return isValidSurplusDate(value);
}