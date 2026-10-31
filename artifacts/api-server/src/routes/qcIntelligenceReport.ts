export type QcReportEvent = {
  id: number;
  eventType: string;
  runId: string | null;
  profileKey: string | null;
  ingredientId: string | null;
  ingredientName: string | null;
  station: string | null;
  createdAt: string;
  payload: Record<string, unknown>;
  redactedFields?: string[];
};

export type QcReportView = "trends" | "results" | "traceability";

export type QcReportCoverage = {
  status: "complete" | "partial";
  sampledEvents: number;
  includedEvents: number;
  maxEvents: number;
  moreAvailable: boolean;
  reason: "event-limit" | "overlay-limit" | "group-limit" | "canonical-source-limit" | null;
};

export type QcReportFilters = {
  from: string;
  to: string;
  ingredientId: string | null;
  station: string | null;
  runId: string | null;
  checkType: string | null;
};

export type QcReportBase = {
  view: QcReportView;
  dateBasis: "event-created-at-utc";
  filters: QcReportFilters;
  coverage: QcReportCoverage;
};

export type QcTrendPoint = {
  eventId: number;
  recordedAt: string;
  actual: number;
  target: number | null;
  tolerance: number | null;
  outcome: "pass" | "fail" | "not-evaluated";
};

export type QcTrendGroup = {
  metric: "weight" | "brix";
  ingredientId: string | null;
  ingredientName: string;
  profileKey: string | null;
  station: string;
  checkType: string;
  actualUnit: string;
  targetUnit: string;
  targetVersion: string;
  targetRecordedAt: string | null;
  points: QcTrendPoint[];
};

export type QcResultCounts = {
  pass: number;
  fail: number;
  notEvaluated: number;
  denominator: number;
};

export type QcResultGroup = QcResultCounts & {
  key: string;
  label: string;
};

export type QcTraceRun = {
  runId: string;
  status: "available" | "unavailable";
  source: "completed-run-snapshot" | "active-day-state" | null;
  productionDate: string | null;
  label: string | null;
};

export type QcTraceLot = {
  eventId: number;
  recordedAt: string;
  lotNumber: string | null;
  lotNumberStatus: "recorded" | "redacted" | "unavailable";
  ingredientId: string | null;
  ingredientName: string | null;
  station: string;
  run: QcTraceRun | null;
  outboundStatus: "unavailable";
  outboundExplanation: string;
};

export type QcTrendsReport = QcReportBase & {
  view: "trends";
  recordedMeasurements: number;
  redactedMeasurementsExcluded: number;
  groups: QcTrendGroup[];
};

export type QcResultsReport = QcReportBase & {
  view: "results";
  recordedChecks: number;
  byCheckType: QcResultGroup[];
  byStation: QcResultGroup[];
  byIngredient: QcResultGroup[];
};

export type QcTraceabilityReport = QcReportBase & {
  view: "traceability";
  lots: QcTraceLot[];
  outboundAvailability: "unavailable";
  outboundExplanation: string;
};

export type QcIntelligenceReport = QcTrendsReport | QcResultsReport | QcTraceabilityReport;

const CHECK_EVENT_TYPES = new Set([
  "weight",
  "brix-check",
  "component-check",
  "label-check",
  "date-code-check",
]);

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function versionText(value: unknown): string | null {
  return typeof value === "string" || (typeof value === "number" && Number.isFinite(value))
    ? String(value)
    : null;
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function outcomeFor(event: QcReportEvent): QcTrendPoint["outcome"] {
  const outcome = event.payload.outcome;
  if (outcome === "pass" || outcome === "within-tolerance") return "pass";
  if (outcome === "fail" || outcome === "out-of-tolerance") return "fail";
  return "not-evaluated";
}

function hidden(event: QcReportEvent, path: string): boolean {
  if (event.redactedFields?.includes(path)) return true;
  const parts = path.startsWith("payload.") ? path.slice("payload.".length).split(".") : path.split(".");
  const value = parts.reduce<unknown>((current, part) => {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    return (current as Record<string, unknown>)[part];
  }, event.payload);
  return value === "[redacted]";
}

function trendGroupKey(group: Omit<QcTrendGroup, "points" | "ingredientName">): string {
  return [
    group.metric,
    group.ingredientId ?? "unattributed",
    group.profileKey ?? "unattributed",
    group.station,
    group.checkType,
    group.actualUnit,
    group.targetUnit,
    group.targetVersion,
  ].map((part) => `${String(part).length}:${part}`).join("|");
}

function trendData(event: QcReportEvent): {
  metric: "weight" | "brix";
  actual: number;
  target: number | null;
  tolerance: number | null;
  actualUnit: string;
  targetUnit: string;
  targetVersion: string;
  targetRecordedAt: string | null;
} | null {
  if (event.eventType === "weight") {
    if (hidden(event, "payload.actualValue")) return null;
    const actual = finite(event.payload.actualValue);
    const actualUnit = text(event.payload.actualUnit);
    const targetUnit = text(event.payload.targetUnit) ?? "not-configured";
    if (actual === null || !actualUnit) return null;
    const target = finite(event.payload.targetValue);
    const tolerance = finite(event.payload.toleranceValue);
    const source = text(event.payload.targetSource) ?? "unknown-source";
    const storedVersion = versionText(event.payload.targetVersion);
    const version = storedVersion ?? (target === null
      ? `${source}:not-configured`
      : `unversioned-event:${event.id}`);
    return {
      metric: "weight",
      actual,
      target,
      tolerance,
      actualUnit,
      targetUnit,
      targetVersion: version,
      targetRecordedAt: text(event.payload.targetRecordedAt),
    };
  }
  if (event.eventType === "brix-check") {
    if (hidden(event, "payload.actualBrix")) return null;
    const actual = finite(event.payload.actualBrix);
    if (actual === null) return null;
    const target = finite(event.payload.targetBrix);
    const tolerance = finite(event.payload.toleranceBrix);
    const source = text(event.payload.targetSource) ?? "unknown-source";
    const storedVersion = versionText(event.payload.targetVersion);
    const version = storedVersion ?? (target === null
      ? `${source}:not-configured`
      : `unversioned-event:${event.id}`);
    return {
      metric: "brix",
      actual,
      target,
      tolerance,
      actualUnit: "°Bx",
      targetUnit: "°Bx",
      targetVersion: version,
      targetRecordedAt: text(event.payload.targetRecordedAt),
    };
  }
  return null;
}

function groupCounts(events: QcReportEvent[], dimension: "check-type" | "station" | "ingredient"): QcResultGroup[] {
  const groups = new Map<string, QcResultGroup>();
  for (const event of events) {
    let key: string;
    let label: string;
    if (dimension === "check-type") {
      const subtype = text(event.payload.checkType);
      key = subtype ? `${event.eventType}:${subtype}` : event.eventType;
      label = subtype ? `${event.eventType} · ${subtype}` : event.eventType;
    } else if (dimension === "station") {
      key = event.station ?? "unavailable";
      label = event.station ?? "Station unavailable";
    } else {
      key = event.ingredientId ?? "unattributed";
      label = hidden(event, "ingredientName")
        ? "Redacted ingredient"
        : event.ingredientName ?? "Ingredient unavailable";
    }
    const group = groups.get(key) ?? { key, label, pass: 0, fail: 0, notEvaluated: 0, denominator: 0 };
    const outcome = outcomeFor(event);
    group[outcome === "pass" ? "pass" : outcome === "fail" ? "fail" : "notEvaluated"] += 1;
    group.denominator += 1;
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => a.label.localeCompare(b.label) || a.key.localeCompare(b.key));
}

export function buildQcIntelligenceReport(
  view: QcReportView,
  events: QcReportEvent[],
  filters: QcReportFilters,
  coverage: QcReportCoverage,
  canonicalRuns: Map<string, QcTraceRun> = new Map(),
  maxGroups = 100,
): QcIntelligenceReport {
  const base = { view, dateBasis: "event-created-at-utc" as const, filters, coverage };
  if (view === "trends") {
    const groups = new Map<string, QcTrendGroup>();
    let redactedMeasurementsExcluded = 0;
    for (const event of events) {
      if (
        (event.eventType === "weight" && hidden(event, "payload.actualValue"))
        || (event.eventType === "brix-check" && hidden(event, "payload.actualBrix"))
      ) {
        redactedMeasurementsExcluded += 1;
        continue;
      }
      const measurement = trendData(event);
      if (!measurement) continue;
      const common = {
        metric: measurement.metric,
        ingredientId: event.ingredientId,
        ingredientName: hidden(event, "ingredientName") ? "Redacted ingredient" : event.ingredientName ?? "Ingredient unavailable",
        profileKey: event.profileKey,
        station: event.station ?? "unavailable",
        checkType: text(event.payload.checkType) ?? "unavailable",
        actualUnit: measurement.actualUnit,
        targetUnit: measurement.targetUnit,
        targetVersion: measurement.targetVersion,
        targetRecordedAt: measurement.targetRecordedAt,
      };
      const key = `${trendGroupKey(common)}${event.ingredientId ? "" : `|unattributed-event:${event.id}`}`;
      const group = groups.get(key) ?? { ...common, points: [] };
      group.points.push({
        eventId: event.id,
        recordedAt: event.createdAt,
        actual: measurement.actual,
        target: measurement.actualUnit === measurement.targetUnit ? measurement.target : null,
        tolerance: measurement.actualUnit === measurement.targetUnit ? measurement.tolerance : null,
        outcome: outcomeFor(event),
      });
      groups.set(key, group);
    }
    const allGroups = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
    if (allGroups.length > maxGroups) {
      coverage = { ...coverage, status: "partial", moreAvailable: true, reason: "group-limit" };
    }
    const returnedGroups = allGroups.slice(0, maxGroups).map(([, group]) => group);
    return {
      ...base,
      coverage,
      view: "trends",
      recordedMeasurements: returnedGroups.reduce((count, group) => count + group.points.length, 0),
      redactedMeasurementsExcluded,
      groups: returnedGroups,
    };
  }
  if (view === "results") {
    const checks = events.filter((event) => CHECK_EVENT_TYPES.has(event.eventType));
    const byCheckType = groupCounts(checks, "check-type");
    const byStation = groupCounts(checks, "station");
    const byIngredient = groupCounts(checks, "ingredient");
    const groupsOverflow = [byCheckType, byStation, byIngredient].some((groups) => groups.length > maxGroups);
    if (groupsOverflow) {
      coverage = { ...coverage, status: "partial", moreAvailable: true, reason: "group-limit" };
    }
    return {
      ...base,
      coverage,
      view: "results",
      recordedChecks: checks.length,
      byCheckType: byCheckType.slice(0, maxGroups),
      byStation: byStation.slice(0, maxGroups),
      byIngredient: byIngredient.slice(0, maxGroups),
    };
  }
  const outboundExplanation = "No explicit lot-to-customer or shipment relationship is available in the stored records.";
  const lots = events.filter((event) => event.eventType === "lot").map((event): QcTraceLot => {
    const isRedacted = hidden(event, "payload.lotNumber");
    const lotNumberValue = text(event.payload.lotNumber);
    const runId = event.runId;
    return {
      eventId: event.id,
      recordedAt: event.createdAt,
      lotNumber: isRedacted ? null : lotNumberValue,
      lotNumberStatus: isRedacted ? "redacted" : lotNumberValue ? "recorded" : "unavailable",
      ingredientId: event.ingredientId,
      ingredientName: hidden(event, "ingredientName") ? null : event.ingredientName,
      station: event.station ?? "unavailable",
      run: runId ? canonicalRuns.get(runId) ?? {
        runId,
        status: "unavailable",
        source: null,
        productionDate: null,
        label: null,
      } : null,
      outboundStatus: "unavailable",
      outboundExplanation,
    };
  });
  return {
    ...base,
    view: "traceability",
    lots,
    outboundAvailability: "unavailable",
    outboundExplanation,
  };
}

export class QcIntelligenceCsvLimitError extends Error {}

export function qcIntelligenceCsv(report: QcIntelligenceReport): string {
  const quote = (value: unknown) => {
    let raw = value === null || value === undefined ? "" : String(value);
    if (raw.length > 4_000) throw new QcIntelligenceCsvLimitError("CSV cell exceeds its bound");
    if (typeof value === "string" && /^[\u0000-\u0020]*[=+\-@]/.test(raw)) {
      raw = `'${raw}`;
    }
    return `"${raw.replaceAll('"', '""')}"`;
  };
  const rows: unknown[][] = [
    ["report", report.view],
    ["dateBasis", report.dateBasis],
    ["from", report.filters.from],
    ["to", report.filters.to],
    ["ingredientId", report.filters.ingredientId],
    ["station", report.filters.station],
    ["runId", report.filters.runId],
    ["checkType", report.filters.checkType],
    ["coverage", report.coverage.status],
    ["sampledEvents", report.coverage.sampledEvents],
    ["includedEvents", report.coverage.includedEvents],
    ["maxEvents", report.coverage.maxEvents],
    ["moreAvailable", report.coverage.moreAvailable],
    ["coverageReason", report.coverage.reason],
  ];
  if (report.view === "trends") {
    rows.push(["recordedMeasurements", report.recordedMeasurements]);
    rows.push(["redactedMeasurementsExcluded", report.redactedMeasurementsExcluded]);
    rows.push(["metric", "ingredientId", "ingredientName", "profileKey", "station", "checkType", "actualUnit", "targetUnit", "targetVersion", "targetRecordedAt", "eventId", "recordedAt", "actual", "target", "tolerance", "outcome"]);
    for (const group of report.groups) {
      for (const point of group.points) {
        rows.push([group.metric, group.ingredientId, group.ingredientName, group.profileKey, group.station, group.checkType, group.actualUnit, group.targetUnit, group.targetVersion, group.targetRecordedAt, point.eventId, point.recordedAt, point.actual, point.target, point.tolerance, point.outcome]);
      }
    }
  } else if (report.view === "results") {
    rows.push(["recordedChecks", report.recordedChecks]);
    rows.push(["dimension", "key", "label", "pass", "fail", "notEvaluated", "denominator"]);
    for (const [dimension, groups] of [
      ["checkType", report.byCheckType],
      ["station", report.byStation],
      ["ingredient", report.byIngredient],
    ] as const) {
      for (const group of groups) {
        rows.push([dimension, group.key, group.label, group.pass, group.fail, group.notEvaluated, group.denominator]);
      }
    }
  } else {
    rows.push(["eventId", "recordedAt", "lotNumber", "lotNumberStatus", "ingredientId", "ingredientName", "station", "runId", "runStatus", "runSource", "productionDate", "runLabel", "outboundStatus", "outboundExplanation"]);
    for (const lot of report.lots) {
      rows.push([lot.eventId, lot.recordedAt, lot.lotNumber, lot.lotNumberStatus, lot.ingredientId, lot.ingredientName, lot.station, lot.run?.runId, lot.run?.status, lot.run?.source, lot.run?.productionDate, lot.run?.label, lot.outboundStatus, lot.outboundExplanation]);
    }
  }
  const lines: string[] = [];
  let bytes = 0;
  for (const row of rows) {
    const line = `${row.map(quote).join(",")}\r\n`;
    bytes += Buffer.byteLength(line, "utf8");
    if (bytes > 4 * 1024 * 1024) throw new QcIntelligenceCsvLimitError("CSV exceeds its byte bound");
    lines.push(line);
  }
  return lines.join("");
}
