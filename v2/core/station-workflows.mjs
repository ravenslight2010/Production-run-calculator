const MAX_VALUE = 1_000_000;
const MAX_DECIMAL_PLACES = 3;
const MAX_DECIMAL_PLACES_BY_FIELD = new Map([["casesPerBatch", 4]]);
const DERIVED_INPUT_FIELDS = new Set(["casesPerBatch"]);
const INTEGER_FIELDS = new Set([
  "timerDurationSeconds", "casesPerSkid", "traysPerBatch",
  "pizzasPerCase", "casesProduced", "casesOnLine", "casesInFreezer",
  "traysOnLine", "batchesReady", "batchesMade", "casesCompleted", "casesPacked", "barrelsMade",
]);

export const STATIONS = Object.freeze({
  line: Object.freeze({
    label: "Run / line",
    autoTrackField: "casesProduced",
    inputs: Object.freeze(["autoTrackRatePerMinute", "timerDurationSeconds", "casesPerSkid"]),
    progress: Object.freeze(["casesProduced", "casesOnLine", "casesInFreezer"]),
  }),
  dough: Object.freeze({
    label: "Dough",
    autoTrackField: "casesProduced",
    inputs: Object.freeze(["autoTrackRatePerMinute", "timerDurationSeconds", "casesPerBatch", "traysPerBatch"]),
    progress: Object.freeze(["casesProduced", "traysOnLine", "batchesReady", "batchesMade"]),
  }),
  cheese: Object.freeze({
    label: "Cheese",
    autoTrackField: "casesCompleted",
    inputs: Object.freeze(["autoTrackRatePerMinute", "timerDurationSeconds", "pizzasPerCase", "ozPerPizza", "batchLbs"]),
    progress: Object.freeze(["casesCompleted", "batchesMade", "stockOnLineLbs"]),
  }),
  pepperoni: Object.freeze({
    label: "Pepperoni",
    autoTrackField: "casesCompleted",
    inputs: Object.freeze(["autoTrackRatePerMinute", "timerDurationSeconds", "pizzasPerCase", "ozPerPizza", "batchLbs"]),
    progress: Object.freeze(["casesCompleted", "batchesMade", "stockOnLineLbs"]),
  }),
  sauce: Object.freeze({
    label: "Sauce",
    autoTrackField: "barrelsMade",
    inputs: Object.freeze(["autoTrackRatePerMinute", "timerDurationSeconds", "pizzasPerCase", "ozPerPizza", "barrelLbs"]),
    progress: Object.freeze(["barrelsMade", "stockBarrels"]),
  }),
  frontline: Object.freeze({
    label: "Frontline",
    autoTrackField: "batchesMade",
    inputs: Object.freeze(["autoTrackRatePerMinute", "timerDurationSeconds", "pizzasPerCase", "ozPerPizza", "batchLbs"]),
    progress: Object.freeze(["batchesMade", "stockOnLineLbs", "stockConsumedLbs"]),
  }),
  packaging: Object.freeze({
    label: "Packaging",
    autoTrackField: "casesPacked",
    inputs: Object.freeze(["autoTrackRatePerMinute", "timerDurationSeconds", "casesPerSkid"]),
    progress: Object.freeze(["casesPacked"]),
  }),
});

const INPUT_FIELDS = new Set(Object.values(STATIONS).flatMap((station) => station.inputs));
const PROGRESS_FIELDS = new Set(Object.values(STATIONS).flatMap((station) => station.progress));

export class StationWorkflowError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "StationWorkflowError";
    this.status = status;
  }
}

function requireFiniteNumber(value, field) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > MAX_VALUE) {
    throw new StationWorkflowError(`${field} must be a finite number from 0 to ${MAX_VALUE}.`);
  }
  const decimalPlaces = String(value).split(".")[1]?.length ?? 0;
  const maxDecimalPlaces = MAX_DECIMAL_PLACES_BY_FIELD.get(field) ?? MAX_DECIMAL_PLACES;
  if (decimalPlaces > maxDecimalPlaces) {
    throw new StationWorkflowError(`${field} supports at most ${maxDecimalPlaces} decimal places.`);
  }
  if (INTEGER_FIELDS.has(field) && !Number.isInteger(value)) {
    throw new StationWorkflowError(`${field} must be a whole number.`);
  }
  return value;
}

function normalizeChanges(stationKey, changes, mode) {
  if (mode === "auto_track") {
    if (Object.keys(changes).length !== 0) {
      throw new StationWorkflowError("Automatic tracking does not accept client-supplied progress.");
    }
    return { inputs: {}, progress: {} };
  }

  if (mode !== "manual") throw new StationWorkflowError("Station command mode is not supported.");
  const station = STATIONS[stationKey];
  const inputs = {};
  const progress = {};
  const entries = Object.entries(changes);
  if (entries.length === 0 || entries.length > 8) {
    throw new StationWorkflowError("Enter between one and eight station values.");
  }

  for (const [field, rawValue] of entries) {
    const value = requireFiniteNumber(rawValue, field);
    if (station.inputs.includes(field)) {
      if (DERIVED_INPUT_FIELDS.has(field)) {
        throw new StationWorkflowError(`${field} is calculated from the selected product and cannot be entered manually.`);
      }
      if (field === "casesPerSkid" || field === "casesPerBatch" || field === "traysPerBatch"
        || field === "pizzasPerCase" || field === "batchLbs" || field === "barrelLbs") {
        if (value <= 0) throw new StationWorkflowError(`${field} must be greater than zero.`);
      }
      if (field === "ozPerPizza" && value > 16) {
        throw new StationWorkflowError("ozPerPizza must be 16 or less.");
      }
      if (field === "pizzasPerCase" && value > 100) {
        throw new StationWorkflowError("pizzasPerCase must be 100 or less.");
      }
      if (field === "autoTrackRatePerMinute" && value > 600) {
        throw new StationWorkflowError("autoTrackRatePerMinute must be 600 or less.");
      }
      if (field === "timerDurationSeconds" && value > 86_400) {
        throw new StationWorkflowError("timerDurationSeconds must be 86400 or less.");
      }
      inputs[field] = value;
      continue;
    }
    if (station.progress.includes(field)) {
      progress[field] = value;
      continue;
    }
    throw new StationWorkflowError(`This field is not used by the ${station.label} station.`);
  }

  return { inputs, progress };
}

export function validateStationCommand({ stationKey, mode = "manual", changes }) {
  if (typeof stationKey !== "string" || !Object.hasOwn(STATIONS, stationKey)) {
    throw new StationWorkflowError("Choose a supported production station.");
  }
  if (!changes || typeof changes !== "object" || Array.isArray(changes)) {
    throw new StationWorkflowError("Station changes must be an object.");
  }
  if (["timer_start", "timer_pause", "timer_resume", "timer_reset"].includes(mode)) {
    if (Object.keys(changes).length !== 0) {
      throw new StationWorkflowError("Timer commands do not accept client-supplied values.");
    }
    return {
      stationKey,
      mode,
      inputs: {},
      progress: {},
      changes: {},
      autoTrackField: STATIONS[stationKey].autoTrackField,
    };
  }
  const normalized = normalizeChanges(stationKey, changes, mode);
  const canonicalChanges = Object.fromEntries(
    Object.entries(changes).sort(([left], [right]) => left.localeCompare(right)),
  );
  return {
    stationKey,
    mode,
    inputs: normalized.inputs,
    progress: normalized.progress,
    changes: canonicalChanges,
    autoTrackField: STATIONS[stationKey].autoTrackField,
  };
}

function valueFrom(state, group, field) {
  const value = Number(state?.[group]?.[field]);
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function round(value, digits = 2) {
  const scale = 10 ** digits;
  return Math.round((value + Number.EPSILON) * scale) / scale;
}

export function deriveDoughCasesPerBatch({ doughballYield, pizzasPerCase } = {}) {
  if (typeof doughballYield !== "number" || !Number.isFinite(doughballYield)
    || doughballYield <= 0 || doughballYield > MAX_VALUE
    || typeof pizzasPerCase !== "number" || !Number.isSafeInteger(pizzasPerCase)
    || pizzasPerCase < 1 || pizzasPerCase > 100) {
    return null;
  }
  const casesPerBatch = round(doughballYield / pizzasPerCase, 4);
  return casesPerBatch > 0 ? casesPerBatch : null;
}

export function calculateStationMetrics({ stationKey, run, state }) {
  const station = STATIONS[stationKey];
  if (!station) throw new StationWorkflowError("Choose a supported production station.");
  const targetCases = Number(run?.setupSnapshot?.targetCases);
  if (!Number.isSafeInteger(targetCases) || targetCases < 1) {
    throw new StationWorkflowError("The run does not have a valid target case count.", 409);
  }

  const metrics = { targetCases };
  if (stationKey === "line") {
    const produced = valueFrom(state, "progress", "casesProduced");
    metrics.casesRemaining = Math.max(0, targetCases - produced);
    metrics.workInProgress = round(
      valueFrom(state, "progress", "casesOnLine") + valueFrom(state, "progress", "casesInFreezer"),
    );
    metrics.completionPercent = round(Math.min(100, (produced / targetCases) * 100), 1);
    return metrics;
  }

  if (stationKey === "dough") {
    const capacity = run?.doughCapacity;
    const casesPerBatch = capacity?.status === "available"
      ? deriveDoughCasesPerBatch({
        doughballYield: capacity.doughballYield,
        pizzasPerCase: capacity.pizzasPerCase,
      })
      : null;
    metrics.casesProduced = valueFrom(state, "progress", "casesProduced");
    metrics.casesRemaining = Math.max(0, targetCases - metrics.casesProduced);
    metrics.casesPerBatch = casesPerBatch;
    metrics.batchesNeeded = casesPerBatch !== null ? Math.ceil(targetCases / casesPerBatch) : null;
    metrics.batchesRemaining = metrics.batchesNeeded === null
      ? null
      : Math.max(0, metrics.batchesNeeded - valueFrom(state, "progress", "batchesMade"));
    return metrics;
  }

  if (stationKey === "packaging") {
    const packed = valueFrom(state, "progress", "casesPacked");
    const casesPerSkid = valueFrom(state, "inputs", "casesPerSkid");
    metrics.casesPacked = packed;
    metrics.casesRemaining = Math.max(0, targetCases - packed);
    metrics.skidsNeeded = casesPerSkid > 0 ? Math.ceil(targetCases / casesPerSkid) : null;
    metrics.completedSkids = casesPerSkid > 0 ? Math.floor(packed / casesPerSkid) : null;
    metrics.casesOnCurrentSkid = casesPerSkid > 0 ? round(packed % casesPerSkid) : null;
    return metrics;
  }

  const pizzasPerCase = valueFrom(state, "inputs", "pizzasPerCase");
  const ozPerPizza = valueFrom(state, "inputs", "ozPerPizza");
  const batchLbs = valueFrom(state, "inputs", "batchLbs");
  if (stationKey === "sauce") {
    const barrelLbs = valueFrom(state, "inputs", "barrelLbs");
    const totalLbs = pizzasPerCase > 0 && ozPerPizza > 0
      ? round((targetCases * pizzasPerCase * ozPerPizza) / 16 + 30)
      : null;
    const barrelsNeeded = totalLbs !== null && barrelLbs > 0 ? round(totalLbs / barrelLbs) : null;
    const barrelsMade = valueFrom(state, "progress", "barrelsMade");
    metrics.totalIngredientLbs = totalLbs;
    metrics.barrelsNeeded = barrelsNeeded;
    metrics.barrelsMade = barrelsMade;
    metrics.barrelsRemaining = barrelsNeeded === null
      ? null
      : Math.max(0, Math.ceil(barrelsNeeded) - barrelsMade);
    metrics.stockBarrels = valueFrom(state, "progress", "stockBarrels");
    return metrics;
  }
  const neededLbs = pizzasPerCase > 0 && ozPerPizza > 0
    ? round((targetCases * pizzasPerCase * ozPerPizza) / 16 + (stationKey === "frontline" ? 20 : 0))
    : null;
  if (stationKey === "frontline") {
    const onLine = valueFrom(state, "progress", "stockOnLineLbs");
    const consumed = valueFrom(state, "progress", "stockConsumedLbs");
    metrics.totalIngredientLbs = neededLbs;
    metrics.stockOnLineLbs = onLine;
    metrics.stockConsumedLbs = consumed;
    metrics.batchesNeeded = neededLbs !== null && batchLbs > 0 ? Math.ceil(neededLbs / batchLbs) : null;
    metrics.batchesToMake = neededLbs !== null && batchLbs > 0
      ? Math.ceil(Math.max(0, neededLbs - onLine - consumed) / batchLbs)
      : null;
    metrics.batchesMade = valueFrom(state, "progress", "batchesMade");
    return metrics;
  }
  metrics.casesCompleted = valueFrom(state, "progress", "casesCompleted");
  metrics.casesRemaining = Math.max(0, targetCases - metrics.casesCompleted);
  metrics.ingredientLbsNeeded = neededLbs;
  metrics.batchesNeeded = neededLbs !== null && batchLbs > 0 ? Math.ceil(neededLbs / batchLbs) : null;
  metrics.batchesRemaining = metrics.batchesNeeded === null
    ? null
    : Math.max(0, metrics.batchesNeeded - valueFrom(state, "progress", "batchesMade"));
  return metrics;
}

export const stationFieldSets = Object.freeze({ INPUT_FIELDS, PROGRESS_FIELDS });
