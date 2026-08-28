export const AUTO_TRACK_COORDINATION_VERSION = 1 as const;

export const AUTO_TRACK_CHANNELS = [
  "case",
  "tray-consume",
  "tray-produce",
  "batch-consume",
  "batch-produce",
  "hopper",
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
  field: "skidsCompleted" | "casesOnCurrentSkid" | "traysOnLine" | "batchesReady";
  from: number;
  to: number;
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
]);
const CHANNEL_FIELDS: Record<AutoTrackChannel, ReadonlySet<AutoTrackMutation["field"]>> = {
  case: new Set(["skidsCompleted", "casesOnCurrentSkid"]),
  "tray-consume": new Set(["traysOnLine"]),
  "tray-produce": new Set(["traysOnLine"]),
  "batch-consume": new Set(["batchesReady"]),
  "batch-produce": new Set(["batchesReady"]),
  hopper: new Set(),
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
    || body.dueAt < now - 24 * 60 * 60_000
    || body.dueAt > now + 5_000
    || body.nextDueAt <= body.dueAt
    || body.nextDueAt > now + 24 * 60 * 60_000
    || !Array.isArray(body.mutations)
    || body.mutations.length > 2
  ) return null;
  if (
    body.channel === "case"
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
    ...(body.channel === "case"
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
    if (Math.abs(currentUpdatedAt - claim.baseUpdatedAt) > 0.0001) outcome = "conflict";
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

  if (outcome === "accepted") {
    for (const mutation of claim.mutations) {
      const current = Number(values[mutation.field]) || 0;
      if (Math.abs(current - mutation.from) > 0.0001) {
        outcome = "conflict";
        break;
      }
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
  return { data, outcome, channelState, values };
}