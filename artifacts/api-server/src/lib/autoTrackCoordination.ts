export const AUTO_TRACK_COORDINATION_VERSION = 1 as const;

export const AUTO_TRACK_CHANNELS = [
  "case",
  "tray-consume",
  "tray-produce",
  "batch-consume",
  "batch-produce",
  "hopper",
  "sauce-barrel",
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
    | "sauceBarrelCorrectionGeneration";
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
    || body.mutations.length > 3
  ) return null;
  const sauceNetTime = body.channel === "sauce-barrel";
  if (
    sauceNetTime
      ? body.dueAt < 0 || body.nextDueAt > 1_000_000
      : body.dueAt < now - 24 * 60 * 60_000
        // The client may be operating with a clock that is ahead of the API
        // (and browser tests deliberately advance their page clock). Keep a
        // bounded horizon while allowing modest clock skew.
        || body.dueAt > now + 24 * 60 * 60_000
        || body.nextDueAt > now + 24 * 60 * 60_000
  ) return null;
  if (
    (body.channel === "case" || body.channel === "sauce-barrel")
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
  if (body.channel === "sauce-barrel") {
    const byField = new Map(mutations.map((mutation) => [mutation.field, mutation]));
    const made = byField.get("sauceBarrelsMade");
    const anchor = byField.get("sauceBarrelAnchorNetSec");
    const correction = byField.get("sauceBarrelCorrectionGeneration");
    if (
      mutations.length !== 3
      || !made
      || !anchor
      || !correction
      || !Number.isSafeInteger(made.from)
      || !Number.isSafeInteger(made.to)
      || made.to !== made.from + 1
      || !Number.isSafeInteger(anchor.from)
      || !Number.isSafeInteger(anchor.to)
      || anchor.to < anchor.from
      || !Number.isSafeInteger(correction.from)
      || !Number.isSafeInteger(correction.to)
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
    ...(body.channel === "case" || body.channel === "sauce-barrel"
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

  if (outcome === "accepted" && claim.channel === "sauce-barrel") {
    const correctionGeneration = values.sauceBarrelCorrectionGeneration;
    if (
      !Number.isSafeInteger(correctionGeneration)
      || correctionGeneration !== claim.correctionGeneration
    ) outcome = "conflict";
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