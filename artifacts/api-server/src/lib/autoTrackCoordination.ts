import {
  applicatorStockFields,
  applicatorStockRegisterForChannel,
  capApplicatorStock,
  capSauceStock,
  computeApplicatorStockCapacityLbs,
  computeApplicatorStockRateLbsPerSecond,
  computeAppSlotInfo,
  computeAutoTrackElapsedMs,
  computeFrontlineSupplyFromStockLbs,
  computeSauceStockStepSeconds,
  depleteSauceStock,
  computeServerCalc,
  legacyFrontlineConsumption,
} from "@workspace/live-calc";

export const AUTO_TRACK_COORDINATION_VERSION = 1 as const;
export const AUTO_TRACK_CHANNELS = [
  "case",
  "tray-consume",
  "tray-produce",
  "batch-consume",
  "batch-produce",
  "hopper",
  "sauce-barrel",
  "sauce-stock",
  "app1-batch",
  "app2-batch",
  "app3-batch",
  "app4-batch",
  "app1-stock",
  "app2-stock",
  "app3-stock",
  "app4-stock",
  "pep1-stock",
  "pep1b-stock",
  "pep2-stock",
  "pep2b-stock",
] as const;

export type AutoTrackChannel = typeof AUTO_TRACK_CHANNELS[number];

export type AutoTrackChannelState = {
  generation: string;
  sequence: number;
  nextDueAt: number;
  acceptedEventId?: string;
  acceptedRunValuesUpdatedAt?: number;
  updatedAt: number;
};

export type AutoTrackCoordination = {
  version: typeof AUTO_TRACK_COORDINATION_VERSION;
  runs: Record<string, Partial<Record<AutoTrackChannel, AutoTrackChannelState>>>;
};

export type AutoTrackMutation = {
  field:
    | "skidsCompleted"
    | "casesOnCurrentSkid"
    | "traysOnLine"
    | "batchesReady"
    | "sauceBarrelsMade"
    | "sauceBarrelAnchorNetSec"
    | "sauceBarrelCorrectionGeneration"
    | "sauceStockBarrels" | "sauceStockAnchorNetSec" | "sauceStockCorrectionGeneration"
    | "app1BatchesMade"
    | "app1BatchAnchorNetSec"
    | "app1BatchCorrectionGeneration"
    | "app2BatchesMade"
    | "app2BatchAnchorNetSec"
    | "app2BatchCorrectionGeneration"
    | "app3BatchesMade"
    | "app3BatchAnchorNetSec"
    | "app3BatchCorrectionGeneration"
    | "app4BatchesMade"
    | "app4BatchAnchorNetSec"
    | "app4BatchCorrectionGeneration"
    | "app1StockLbs" | "app1StockAnchorNetSec" | "app1StockCorrectionGeneration" | "app1StockConsumedLbs"
    | "app2StockLbs" | "app2StockAnchorNetSec" | "app2StockCorrectionGeneration" | "app2StockConsumedLbs"
    | "app3StockLbs" | "app3StockAnchorNetSec" | "app3StockCorrectionGeneration" | "app3StockConsumedLbs"
    | "app4StockLbs" | "app4StockAnchorNetSec" | "app4StockCorrectionGeneration" | "app4StockConsumedLbs"
    | "pep1StockLbs" | "pep1StockAnchorNetSec" | "pep1StockCorrectionGeneration"
    | "pep1bStockLbs" | "pep1bStockAnchorNetSec" | "pep1bStockCorrectionGeneration"
    | "pep2StockLbs" | "pep2StockAnchorNetSec" | "pep2StockCorrectionGeneration"
    | "pep2bStockLbs" | "pep2bStockAnchorNetSec" | "pep2bStockCorrectionGeneration";
  from: number;
  to: number;
};

// An accepted claim emits an instruction, not an inventory result. The sync
// route can hand it to inventory while retaining its row lock and commit both
// effects atomically. It is derived exclusively from stored run values.
export type AutoTrackInventoryConsumption = {
  kind: "sauce-barrel";
  runId: string;
  barrelIndex: number;
  eventId: string;
  itemKey: string;
  qty: number;
};

export type AutoTrackClaim = {
  version: typeof AUTO_TRACK_COORDINATION_VERSION;
  runId: string;
  channel: AutoTrackChannel;
  generation: string;
  sequence: number;
  eventId: string;
  dueAt: number;
  nextDueAt: number;
  baseUpdatedAt: number;
  correctionGeneration?: number;
  mutations: AutoTrackMutation[];
};

export type AutoTrackClaimOutcome = "accepted" | "duplicate" | "stale" | "conflict";

const ID_RE = /^[A-Za-z0-9:_-]{1,160}$/;
const MUTATING_FIELDS = new Set<AutoTrackMutation["field"]>([
  "skidsCompleted",
  "casesOnCurrentSkid",
  "traysOnLine",
  "batchesReady",
  "sauceBarrelsMade",
  "sauceBarrelAnchorNetSec",
  "sauceBarrelCorrectionGeneration",
  "sauceStockBarrels", "sauceStockAnchorNetSec", "sauceStockCorrectionGeneration",
  "app1BatchesMade",
  "app1BatchAnchorNetSec",
  "app1BatchCorrectionGeneration",
  "app2BatchesMade",
  "app2BatchAnchorNetSec",
  "app2BatchCorrectionGeneration",
  "app3BatchesMade",
  "app3BatchAnchorNetSec",
  "app3BatchCorrectionGeneration",
  "app4BatchesMade",
  "app4BatchAnchorNetSec",
  "app4BatchCorrectionGeneration",
  "app1StockLbs", "app1StockAnchorNetSec", "app1StockCorrectionGeneration", "app1StockConsumedLbs",
  "app2StockLbs", "app2StockAnchorNetSec", "app2StockCorrectionGeneration", "app2StockConsumedLbs",
  "app3StockLbs", "app3StockAnchorNetSec", "app3StockCorrectionGeneration", "app3StockConsumedLbs",
  "app4StockLbs", "app4StockAnchorNetSec", "app4StockCorrectionGeneration", "app4StockConsumedLbs",
  "pep1StockLbs", "pep1StockAnchorNetSec", "pep1StockCorrectionGeneration",
  "pep1bStockLbs", "pep1bStockAnchorNetSec", "pep1bStockCorrectionGeneration",
  "pep2StockLbs", "pep2StockAnchorNetSec", "pep2StockCorrectionGeneration",
  "pep2bStockLbs", "pep2bStockAnchorNetSec", "pep2bStockCorrectionGeneration",
]);
const CHANNEL_FIELDS: Record<AutoTrackChannel, ReadonlySet<AutoTrackMutation["field"]>> = {
  case: new Set(["skidsCompleted", "casesOnCurrentSkid"]),
  "tray-consume": new Set(["traysOnLine"]),
  "tray-produce": new Set(["traysOnLine"]),
  "batch-consume": new Set(["batchesReady"]),
  "batch-produce": new Set(["batchesReady"]),
  hopper: new Set(),
  "sauce-barrel": new Set([
    "sauceBarrelsMade",
    "sauceBarrelAnchorNetSec",
    "sauceBarrelCorrectionGeneration",
  ]),
  "sauce-stock": new Set(["sauceStockBarrels", "sauceStockAnchorNetSec", "sauceStockCorrectionGeneration"]),
  "app1-batch": new Set([
    "app1BatchesMade",
    "app1BatchAnchorNetSec",
    "app1BatchCorrectionGeneration",
    "app1StockLbs",
  ]),
  "app2-batch": new Set([
    "app2BatchesMade",
    "app2BatchAnchorNetSec",
    "app2BatchCorrectionGeneration",
    "app2StockLbs",
  ]),
  "app3-batch": new Set([
    "app3BatchesMade",
    "app3BatchAnchorNetSec",
    "app3BatchCorrectionGeneration",
    "app3StockLbs",
  ]),
  "app4-batch": new Set([
    "app4BatchesMade",
    "app4BatchAnchorNetSec",
    "app4BatchCorrectionGeneration",
    "app4StockLbs",
  ]),
  "app1-stock": new Set(["app1StockLbs", "app1StockAnchorNetSec", "app1StockCorrectionGeneration", "app1StockConsumedLbs"]),
  "app2-stock": new Set(["app2StockLbs", "app2StockAnchorNetSec", "app2StockCorrectionGeneration", "app2StockConsumedLbs"]),
  "app3-stock": new Set(["app3StockLbs", "app3StockAnchorNetSec", "app3StockCorrectionGeneration", "app3StockConsumedLbs"]),
  "app4-stock": new Set(["app4StockLbs", "app4StockAnchorNetSec", "app4StockCorrectionGeneration", "app4StockConsumedLbs"]),
  "pep1-stock": new Set(["pep1StockLbs", "pep1StockAnchorNetSec", "pep1StockCorrectionGeneration"]),
  "pep1b-stock": new Set(["pep1bStockLbs", "pep1bStockAnchorNetSec", "pep1bStockCorrectionGeneration"]),
  "pep2-stock": new Set(["pep2StockLbs", "pep2StockAnchorNetSec", "pep2StockCorrectionGeneration"]),
  "pep2b-stock": new Set(["pep2bStockLbs", "pep2bStockAnchorNetSec", "pep2bStockCorrectionGeneration"]),
};
function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isChannel(value: unknown): value is AutoTrackChannel {
  return typeof value === "string" && (AUTO_TRACK_CHANNELS as readonly string[]).includes(value);
}

export function parseAutoTrackClaim(input: unknown, now = Date.now()): AutoTrackClaim | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const body = input as Record<string, unknown>;
  if (
    body.version !== AUTO_TRACK_COORDINATION_VERSION
    || typeof body.runId !== "string"
    || !ID_RE.test(body.runId)
    || !isChannel(body.channel)
    || typeof body.generation !== "string"
    || !ID_RE.test(body.generation)
    || !Number.isSafeInteger(body.sequence)
    || (body.sequence as number) < 1
    || (body.sequence as number) > 10_000_000
    || typeof body.eventId !== "string"
    || !ID_RE.test(body.eventId)
    || !finiteNumber(body.dueAt)
    || !finiteNumber(body.nextDueAt)
    || !finiteNumber(body.baseUpdatedAt)
    || body.baseUpdatedAt < 0
    || body.nextDueAt <= body.dueAt
    || !Array.isArray(body.mutations)
    || body.mutations.length > 4
  ) return null;
  const stockChannel = !!applicatorStockRegisterForChannel(body.channel);
  const sauceStockChannel = body.channel === "sauce-stock";
  const netTimeChannel = body.channel === "sauce-barrel" || sauceStockChannel || /^app[1-4]-batch$/.test(body.channel) || stockChannel;
  if (
    netTimeChannel
      ? body.dueAt < 0 || body.nextDueAt > 1_000_000
      : body.dueAt < now - 24 * 60 * 60_000
        // The client may be operating with a clock that is ahead of the API
        // (and browser tests deliberately advance their page clock). Keep a
        // bounded horizon while allowing modest clock skew.
        || body.dueAt > now + 24 * 60 * 60_000
        || body.nextDueAt > now + 24 * 60 * 60_000
  ) return null;
  if (
    (body.channel === "case" || body.channel === "sauce-barrel" || sauceStockChannel || /^app[1-4]-batch$/.test(body.channel) || stockChannel)
    && (!Number.isSafeInteger(body.correctionGeneration) || (body.correctionGeneration as number) < 0)
  ) return null;

  const allowed = CHANNEL_FIELDS[body.channel];
  const seen = new Set<string>();
  const mutations: AutoTrackMutation[] = [];
  for (const raw of body.mutations) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const item = raw as Record<string, unknown>;
    if (
      typeof item.field !== "string"
      || !MUTATING_FIELDS.has(item.field as AutoTrackMutation["field"])
      || !allowed.has(item.field as AutoTrackMutation["field"])
      || seen.has(item.field)
      || !finiteNumber(item.from)
      || !finiteNumber(item.to)
      || item.from < 0
      || item.to < 0
      || item.from > 1_000_000
      || item.to > 1_000_000
    ) return null;
    seen.add(item.field);
    mutations.push({
      field: item.field as AutoTrackMutation["field"],
      from: item.from,
      to: item.to,
    });
  }
  if (body.channel === "hopper" ? mutations.length !== 0 : mutations.length === 0) return null;
  // A barrel event is one completed physical barrel, never a client-side
  // reconciliation of the canonical counter.
  if (body.channel === "sauce-barrel" || /^app[1-4]-batch$/.test(body.channel)) {
    const appBatch = /^app[1-4]-batch$/.test(body.channel);
    const prefix = body.channel === "sauce-barrel"
      ? "sauceBarrel"
      : `app${body.channel[3]}Batch`;
    const madeField = body.channel === "sauce-barrel" ? "sauceBarrelsMade" : `${prefix}esMade`;
    const anchorField = `${prefix}AnchorNetSec`;
    const correctionField = `${prefix}CorrectionGeneration`;
    const byField = new Map(mutations.map((mutation) => [mutation.field, mutation]));
    const made = byField.get(madeField as AutoTrackMutation["field"]);
    const anchor = byField.get(anchorField as AutoTrackMutation["field"]);
    const correction = byField.get(correctionField as AutoTrackMutation["field"]);
    const stock = appBatch
      ? byField.get(`app${body.channel[3]}StockLbs` as AutoTrackMutation["field"])
      : undefined;
    if (
      (mutations.length !== 3 && !(appBatch && mutations.length === 4))
      || !made
      || !anchor
      || !correction
      || (stock && stock.to <= stock.from)
      || !Number.isSafeInteger(made.from)
      || !Number.isSafeInteger(made.to)
      || made.to !== made.from + 1
      || anchor.to < anchor.from
      || !Number.isSafeInteger(correction.from)
      || !Number.isSafeInteger(correction.to)
      || correction.from !== correction.to
      || correction.from !== body.correctionGeneration
    ) return null;
  }
  if (stockChannel) {
    const register = applicatorStockRegisterForChannel(body.channel)!;
    const fields = applicatorStockFields(register);
    const byField = new Map(mutations.map((mutation) => [mutation.field, mutation]));
    const stock = byField.get(fields.stock as AutoTrackMutation["field"]);
    const anchor = byField.get(fields.anchor as AutoTrackMutation["field"]);
    const correction = byField.get(fields.correctionGeneration as AutoTrackMutation["field"]);
    const appConsumed = register.startsWith("app")
      ? byField.get(`${register}StockConsumedLbs` as AutoTrackMutation["field"])
      : undefined;
    if (
      mutations.length !== (appConsumed ? 4 : 3)
      || !stock || !anchor || !correction
      || stock.to > stock.from
      || anchor.to < anchor.from
      || anchor.to !== body.dueAt
      || !Number.isSafeInteger(correction.from)
      || correction.from !== correction.to
      || correction.from !== body.correctionGeneration
      || (appConsumed && Math.abs(
        appConsumed.to - appConsumed.from - (stock.from - stock.to),
      ) > 0.011)
    ) return null;
  }
  if (sauceStockChannel) {
    const byField = new Map(mutations.map((mutation) => [mutation.field, mutation]));
    const stock = byField.get("sauceStockBarrels");
    const anchor = byField.get("sauceStockAnchorNetSec");
    const correction = byField.get("sauceStockCorrectionGeneration");
    const initializationClaim = stock?.from === 0
      && stock.to === 2
      && anchor?.from === 0
      && correction?.from === 0;
    if (
      mutations.length !== 3
      || !stock || !anchor || !correction
      || (!initializationClaim && (
        stock.to >= stock.from
        || Math.abs(stock.from - capSauceStock(stock.from)) > 0.0001
        || Math.abs(stock.to - depleteSauceStock(stock.from)) > 0.0001
      ))
      || anchor.to !== body.dueAt
      || (initializationClaim ? anchor.to < 0 : anchor.to <= anchor.from)
      || !Number.isSafeInteger(correction.from)
      || correction.from !== correction.to
      || correction.from !== body.correctionGeneration
    ) return null;
  }

  return {
    version: AUTO_TRACK_COORDINATION_VERSION,
    runId: body.runId,
    channel: body.channel,
    generation: body.generation,
    sequence: body.sequence as number,
    eventId: body.eventId,
    dueAt: body.dueAt,
    nextDueAt: body.nextDueAt,
    baseUpdatedAt: body.baseUpdatedAt,
    ...(body.channel === "case" || body.channel === "sauce-barrel" || sauceStockChannel || /^app[1-4]-batch$/.test(body.channel) || stockChannel
      ? { correctionGeneration: body.correctionGeneration as number }
      : {}),
    mutations,
  };
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function applyAutoTrackClaim(
  stored: unknown,
  claim: AutoTrackClaim,
  now = Date.now(),
): {
  data: Record<string, unknown>;
  outcome: AutoTrackClaimOutcome;
  channelState: AutoTrackChannelState;
  values: Record<string, unknown>;
  inventoryConsumption?: AutoTrackInventoryConsumption;
} {
  const data = { ...object(stored) };
  const runValues = { ...object(data.runValues) };
  const values = { ...object(runValues[claim.runId]) };
  Object.assign(values, legacyFrontlineConsumption(values));
  const coordinationRaw = object(data.autoTrackCoordination);
  const coordinationRuns = { ...object(coordinationRaw.runs) };
  const runCoordination = { ...object(coordinationRuns[claim.runId]) };
  const previous = object(runCoordination[claim.channel]) as Partial<AutoTrackChannelState>;
  const dayState = object(data.dayState);
  const runs = Array.isArray(dayState.runs) ? dayState.runs : [];
  const run = runs.find((candidate) => object(candidate).id === claim.runId);
  const runMeta = object(run);
  const expectedGeneration = `${claim.runId}:${String(runMeta.metaUpdatedAt ?? runMeta.startedAt ?? 0)}`.slice(0, 160);
  const isCaseChannel = claim.channel === "case";
  const lifecycleValid =
    expectedGeneration === claim.generation
    && finiteNumber(runMeta.startedAt)
    && runMeta.autoTrackDisabled !== true
    && (isCaseChannel || (!finiteNumber(runMeta.pausedAt) && !finiteNumber(runMeta.endedAt)));

  let outcome: AutoTrackClaimOutcome = lifecycleValid ? "accepted" : "stale";
  if (outcome === "accepted" && previous.generation === claim.generation) {
    if (previous.sequence === claim.sequence && previous.acceptedEventId === claim.eventId) {
      outcome = "duplicate";
    } else if (typeof previous.sequence === "number" && claim.sequence <= previous.sequence) {
      outcome = "stale";
    } else if (typeof previous.sequence === "number" && claim.sequence !== previous.sequence + 1) {
      outcome = "stale";
    }
  } else if (outcome === "accepted" && previous.generation !== claim.generation) {
    if (claim.sequence !== 1) outcome = "stale";
  }

  if (outcome === "accepted") {
    const currentUpdatedAt = Number(object(data.runValuesUpdatedAt)[claim.runId]) || 0;
    if (Math.abs(currentUpdatedAt - claim.baseUpdatedAt) > 0.0001) {
      // Different auto-track channels update disjoint fields on the same run.
      // Their accepted stamps must not make one another's claims conflict;
      // the per-mutation `from` check below still rejects overlapping or
      // externally edited fields. Ordinary edits have no accepted channel
      // stamp and continue to invalidate a queued automatic write.
      const currentStampIsAutomatic = Object.values(runCoordination).some(
        (channelState) => object(channelState).acceptedRunValuesUpdatedAt === currentUpdatedAt,
      );
      if (!currentStampIsAutomatic) outcome = "conflict";
    }
  }

  if (outcome === "accepted" && isCaseChannel) {
    const previousProgress = object(object(data.packagingProgress)[claim.runId]);
    const correctionGeneration = Number(previousProgress.correctionGeneration) || 0;
    const manualOverrideUntil = Number(previousProgress.manualOverrideUntil) || 0;
    if (
      correctionGeneration !== claim.correctionGeneration
      || manualOverrideUntil > now
    ) outcome = "conflict";
  }

  const stockRegister = applicatorStockRegisterForChannel(claim.channel);
  if (outcome === "accepted" && stockRegister) {
    const fields = applicatorStockFields(stockRegister);
    const capacity = computeApplicatorStockCapacityLbs(values, stockRegister);
    const stockMutation = claim.mutations.find(({ field }) => field === fields.stock);
    const anchorMutation = claim.mutations.find(({ field }) => field === fields.anchor);
    const stock = Number(values[fields.stock]);
    const generation = values[fields.correctionGeneration] ?? 0;
    const consumedField = stockRegister.startsWith("app") ? `${stockRegister}StockConsumedLbs` : null;
    const consumedMutation = consumedField
      ? claim.mutations.find(({ field }) => field === consumedField)
      : undefined;
    const consumed = consumedField ? Number(values[consumedField] ?? 0) : 0;
    const elapsed = anchorMutation ? anchorMutation.to - anchorMutation.from : 0;
    const ozField = stockRegister.endsWith("b")
      ? `${stockRegister.slice(0, -1)}OzPerPizzaB`
      : `${stockRegister}OzPerPizza`;
    const ppm = (() => {
      try {
        return Number(computeServerCalc(data as never, [], now)?.calc?.ppm) || 0;
      } catch {
        return 0;
      }
    })();
    const expected = capApplicatorStock(
      stock - elapsed * computeApplicatorStockRateLbsPerSecond(values[ozField], ppm),
      capacity,
    );
    if (
      values.applicatorStockInitialized !== true
      || !(Number(values.pizzasPerCase) > 0)
      || !(Number(values.casesNeeded) > 0)
      || capacity <= 0
      || !Number.isFinite(stock)
      || stock < 0
      || stock > capacity
      || !Number.isSafeInteger(generation)
      || generation !== claim.correctionGeneration
      || !stockMutation
      || Math.abs(stockMutation.to - expected) > 0.011
      || (consumedField && consumedMutation && (
        !Number.isFinite(consumed)
        || consumed < 0
        || Math.abs(consumedMutation.from - consumed) > 0.0001
        || Math.abs(consumedMutation.to - consumed - Math.max(0, stock - expected)) > 0.011
      ))
    ) outcome = "conflict";
  } else if (outcome === "accepted" && claim.channel === "sauce-stock") {
    const stock = Number(values.sauceStockBarrels ?? 0);
    const anchorMutation = claim.mutations.find(({ field }) => field === "sauceStockAnchorNetSec");
    const stockMutation = claim.mutations.find(({ field }) => field === "sauceStockBarrels");
    const correctionGeneration = Number(values.sauceStockCorrectionGeneration) || 0;
    let calc;
    try { calc = computeServerCalc(data as never, [], now)?.calc; } catch { calc = undefined; }
    const cadence = computeSauceStockStepSeconds(values.sauceOzPerPizza, calc?.ppm, calc?.sauceEffBarrel);
    if (
      !Number.isFinite(stock)
      || !Number.isSafeInteger(correctionGeneration)
      || correctionGeneration !== claim.correctionGeneration
      || !anchorMutation
      || !stockMutation
    ) outcome = "conflict";
    else if (values.sauceStockInitialized !== true) {
      const elapsed = computeAutoTrackElapsedMs({
        startedAt: Number(runMeta.startedAt) || 0,
        pausedAt: Number(runMeta.pausedAt) || undefined,
        nowMs: now,
        stoppages: Array.isArray(runMeta.stoppages) ? runMeta.stoppages as never : [],
      }) / 1000;
      if (
        stock !== 0
        || stockMutation.from !== 0
        || stockMutation.to !== 2
        || anchorMutation.from !== 0
        || anchorMutation.to !== claim.dueAt
        || claim.dueAt > elapsed + 2
        || Math.abs((claim.nextDueAt - claim.dueAt) - cadence) > Math.max(2, cadence * 0.02)
        || !Number.isSafeInteger(Number(values.sauceStockCorrectionGeneration ?? 0))
        || correctionGeneration !== 0
      ) outcome = "conflict";
    } else if (
      stock <= 0
      || stock > 2
      || capSauceStock(stock) !== stock
      || Math.abs((anchorMutation.to - anchorMutation.from) - cadence) > Math.max(2, cadence * 0.02)
      || Math.abs(stockMutation.to - depleteSauceStock(stock)) > 0.0001
    ) outcome = "conflict";
  } else if (outcome === "accepted" && (claim.channel === "sauce-barrel" || /^app[1-4]-batch$/.test(claim.channel))) {
    const correctionField = claim.channel === "sauce-barrel"
      ? "sauceBarrelCorrectionGeneration"
      : `app${claim.channel[3]}BatchCorrectionGeneration`;
    // These coordination fields were added after durable run values existed.
    // Their schema default is zero, so a valid live legacy run may adopt the
    // register on its first canonical claim. Recipe validation below still
    // prevents Sauce from producing untrusted inventory work.
    const correctionGeneration = values[correctionField] ?? 0;
    if (
      !Number.isSafeInteger(correctionGeneration)
      || correctionGeneration !== claim.correctionGeneration
    ) outcome = "conflict";
    if (outcome === "accepted" && /^app[1-4]-batch$/.test(claim.channel)) {
      const slot = `app${claim.channel[3]}` as "app1" | "app2" | "app3" | "app4";
      const stockField = `${slot}StockLbs`;
      const consumedField = `${slot}StockConsumedLbs`;
      const stockMutation = claim.mutations.find(({ field }) => field === stockField);
      const stock = Number(values[stockField]);
      const consumed = Number(values[consumedField] ?? 0);
      let calc;
      try { calc = computeServerCalc(data as never, [], now)?.calc; } catch { calc = undefined; }
      const info = computeAppSlotInfo({
        type: String(values[`${slot}Type`] ?? ""),
        recipe: Array.isArray(values[`${slot}CheeseRecipe`])
          ? values[`${slot}CheeseRecipe`] as Array<{ lbs: number }>
          : [],
        batchLbs: Number(values[`${slot}BatchLbs`]) || 0,
        ozPerPizza: Number(values[`${slot}OzPerPizza`]) || 0,
        casesNeeded: Number(values.casesNeeded) || 0,
        pizzasPerCase: Number(values.pizzasPerCase) || 0,
        ppm: Number(calc?.ppm) || 0,
      });
      const capacity = Math.min(
        computeApplicatorStockCapacityLbs(values, slot),
        info.effectiveBatchLbs * 2,
      );
      const supply = computeFrontlineSupplyFromStockLbs({
        demandLbs: info.required * info.effectiveBatchLbs,
        consumedLbs: consumed,
        onLineLbs: stock,
        configuredEffectiveWeight: info.effectiveBatchLbs,
      });
      const expectedProductionLbs = Math.min(
        info.effectiveBatchLbs,
        (supply?.stillToMake ?? 0) * info.effectiveBatchLbs,
      );
      if (
        !info.validForClaim
        || values.applicatorStockInitialized !== true
        || !Number.isFinite(stock)
        || stock < 0
        || stock > capacity
        || !Number.isFinite(consumed)
        || consumed < 0
        || !supply?.stillToMake
        || expectedProductionLbs <= 0
        || capacity - stock + 0.0001 < expectedProductionLbs
        || !stockMutation
        || Math.abs(stockMutation.from - stock) > 0.0001
        || Math.abs(
          stockMutation.to - capApplicatorStock(stock + expectedProductionLbs, capacity),
        ) > 0.011
      ) outcome = "conflict";
    }
  }

  if (outcome === "accepted") {
    for (const mutation of claim.mutations) {
      const current = Number(values[mutation.field]) || 0;
      if (Math.abs(current - mutation.from) > 0.0001) {
        outcome = "conflict";
        break;
      }
    }
  }

  let inventoryConsumption: AutoTrackInventoryConsumption | undefined;
  if (outcome === "accepted" && claim.channel === "sauce-barrel") {
    const mutation = claim.mutations.find(({ field }) => field === "sauceBarrelsMade")!;
    const current = values.sauceBarrelsMade;
    const sauceBarrelLbs = Number(values.sauceBarrelLbs);
    const sauceName = typeof values.frontlineRecipeName === "string"
      ? values.frontlineRecipeName.trim()
      : "";
    const recipe = Array.isArray(values.frontlineRecipe) ? values.frontlineRecipe : [];
    const hasSauceRecipe = recipe.some((row) => {
      const entry = object(row);
      return finiteNumber(entry.lbs) && entry.lbs > 0;
    });
    // Validate the stored progress and recipe/configuration, never client
    // inventory fields. A manual snapshot correction therefore conflicts
    // instead of creating an untrusted stock deduction.
    if (
      !Number.isSafeInteger(current)
      || current !== mutation.from
      || (!hasSauceRecipe && (!sauceName || !Number.isFinite(sauceBarrelLbs) || sauceBarrelLbs <= 0))
    ) {
      outcome = "conflict";
    } else {
      inventoryConsumption = {
        kind: "sauce-barrel",
        runId: claim.runId,
        barrelIndex: mutation.to,
        eventId: claim.eventId,
        itemKey: hasSauceRecipe
          ? "ingredient:Sauce:batches"
          : `ingredient:${sauceName}:lbs`,
        qty: hasSauceRecipe ? 1 : sauceBarrelLbs,
      };
    }
  }

  const fallbackState: AutoTrackChannelState = {
    generation: typeof previous.generation === "string" ? previous.generation : claim.generation,
    sequence: typeof previous.sequence === "number" ? previous.sequence : 0,
    nextDueAt: typeof previous.nextDueAt === "number" ? previous.nextDueAt : claim.nextDueAt,
    ...(typeof previous.acceptedEventId === "string" ? { acceptedEventId: previous.acceptedEventId } : {}),
    updatedAt: typeof previous.updatedAt === "number" ? previous.updatedAt : now,
  };
  if (outcome !== "accepted") {
    return { data, outcome, channelState: fallbackState, values };
  }

  for (const mutation of claim.mutations) values[mutation.field] = mutation.to;
  const legacyStockRegister = applicatorStockRegisterForChannel(claim.channel);
  if (legacyStockRegister?.startsWith("app")) {
    const consumedField = `${legacyStockRegister}StockConsumedLbs`;
    if (!claim.mutations.some(({ field }) => field === consumedField)) {
      const stockMutation = claim.mutations.find(({ field }) => field === `${legacyStockRegister}StockLbs`)!;
      values[consumedField] = Number(values[consumedField] ?? 0) + stockMutation.from - stockMutation.to;
    }
  }
  if (claim.channel === "sauce-stock") values.sauceStockInitialized = true;
  const acceptedRunValuesUpdatedAt = Math.max(
    now,
    Number(object(data.runValuesUpdatedAt)[claim.runId]) || 0,
  );
  const channelState: AutoTrackChannelState = {
    generation: claim.generation,
    sequence: claim.sequence,
    nextDueAt: claim.nextDueAt,
    acceptedEventId: claim.eventId,
    acceptedRunValuesUpdatedAt,
    updatedAt: now,
  };
  runCoordination[claim.channel] = channelState;
  coordinationRuns[claim.runId] = runCoordination;
  data.autoTrackCoordination = {
    version: AUTO_TRACK_COORDINATION_VERSION,
    runs: coordinationRuns,
  };
  runValues[claim.runId] = values;
  data.runValues = runValues;
  const updatedAt = {
    ...object(data.runValuesUpdatedAt),
    [claim.runId]: acceptedRunValuesUpdatedAt,
  };
  data.runValuesUpdatedAt = updatedAt;
  if (claim.channel === "case") {
    const packagingProgress = { ...object(data.packagingProgress) };
    const previousProgress = object(packagingProgress[claim.runId]);
    packagingProgress[claim.runId] = {
      skidsCompleted: Number(values.skidsCompleted) || 0,
      casesOnCurrentSkid: Number(values.casesOnCurrentSkid) || 0,
      correctionGeneration: Number(previousProgress.correctionGeneration) || 0,
      manualOverrideUntil: Number(previousProgress.manualOverrideUntil) || 0,
      updatedAt: now,
    };
    data.packagingProgress = packagingProgress;
  }
  return { data, outcome, channelState, values, ...(inventoryConsumption ? { inventoryConsumption } : {}) };
}
