import { createHash } from "node:crypto";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATUSES = new Set(["planned", "running", "paused", "completed"]);
const MAX_SAFE_REVISION = Number.MAX_SAFE_INTEGER;
const MAX_RUN_LIST_LIMIT = 100;

const CREATE_SQL = `SELECT v2.create_planned_run($1::uuid, $2::uuid, $3::text, $4::text, $5::jsonb) AS result`;
const GET_SQL = `SELECT v2.get_run($1::uuid, $2::uuid) AS result`;
const LIST_SQL = `SELECT v2.list_runs($1::uuid, $2::integer) AS result`;
const LIST_PRODUCTS_SQL = `SELECT v2.list_run_products($1::uuid) AS result`;

export class RunServiceError extends Error {
  constructor(code, message, status) {
    super(message);
    this.name = "RunServiceError";
    this.code = code;
    this.status = status;
  }
}

function invalidRequest(message) {
  return new RunServiceError("INVALID_REQUEST", message, 400);
}

function normalizeUuid(value, fieldName, status = 400) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new RunServiceError("INVALID_REQUEST", `${fieldName} must be a UUID.`, status);
  }
  return value.toLowerCase();
}

function normalizeAuth(auth) {
  if (auth?.verified !== true) {
    throw new RunServiceError("UNAUTHENTICATED", "Sign in to access runs.", 401);
  }
  try {
    return {
      facilityId: normalizeUuid(auth.facilityId, "facilityId", 401),
      actorId: normalizeUuid(auth.actorId, "actorId", 401),
    };
  } catch {
    throw new RunServiceError("UNAUTHENTICATED", "Verified facility and staff identity are required.", 401);
  }
}

function normalizeSetupSnapshot(value, { fromStorage = false, requireProductionSetup = false } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw invalidRequest("setupSnapshot must contain a run label and target case count.");
  }
  const keys = Object.keys(value).sort();
  const allowedKeys = fromStorage
    ? ["label", "productCode", "productionSetupCode", "productionPlan", "targetCases"]
    : ["label", "productCode", "productionSetupCode", "targetCases"];
  if (keys.some((key) => !allowedKeys.includes(key))
    || !keys.includes("label") || !keys.includes("targetCases")
    || (keys.includes("productCode") && (typeof value.productCode !== "string"
      || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/u.test(value.productCode)))
    || (keys.includes("productionSetupCode") && (typeof value.productionSetupCode !== "string"
      || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/u.test(value.productionSetupCode)))
    || (requireProductionSetup && (!keys.includes("productCode") || !keys.includes("productionSetupCode")))) {
    throw invalidRequest("setupSnapshot contains missing or unsupported fields.");
  }
  if (typeof value.label !== "string") {
    throw invalidRequest("Run label must be text.");
  }
  const label = value.label.trim();
  if (label.length < 1 || label.length > 120) {
    throw invalidRequest("Run label must be between 1 and 120 characters.");
  }
  if (!Number.isSafeInteger(value.targetCases) || value.targetCases < 1) {
    throw invalidRequest("Target cases must be a positive whole number.");
  }
  return {
    label,
    targetCases: value.targetCases,
    ...(value.productCode ? { productCode: value.productCode } : {}),
    ...(value.productionSetupCode ? { productionSetupCode: value.productionSetupCode } : {}),
  };
}

function validCanonicalTimestamp(value, nullable = false) {
  if (nullable && value === null) return true;
  if (typeof value !== "string") return false;
  const timestamp = new Date(value);
  return !Number.isNaN(timestamp.valueOf()) && timestamp.toISOString() === value;
}

function validInventoryConsumption(value) {
  if (value === null) return true;
  return value && typeof value === "object" && !Array.isArray(value)
    && value.status === "completed"
    && UUID_PATTERN.test(value.runId)
    && UUID_PATTERN.test(value.warehouseId)
    && typeof value.warehouseName === "string" && value.warehouseName.length >= 1 && value.warehouseName.length <= 120
    && validCanonicalTimestamp(value.occurredAt)
    && Array.isArray(value.lines)
    && value.lines.every((line) => line && typeof line === "object" && !Array.isArray(line)
      && UUID_PATTERN.test(line.productId)
      && typeof line.productCode === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/u.test(line.productCode)
      && typeof line.productName === "string" && line.productName.length >= 1 && line.productName.length <= 120
      && typeof line.unit === "string" && /^[A-Za-z][A-Za-z0-9._/-]{0,15}$/u.test(line.unit)
      && ["required", "deducted", "shortfall"].every((key) =>
        typeof line[key] === "string" && /^(0|[1-9][0-9]{0,13})(\.[0-9]{1,6})?$/u.test(line[key])));
}

function validInventoryPlanLine(line) {
  return line && typeof line === "object" && !Array.isArray(line)
    && typeof line.productId === "string" && UUID_PATTERN.test(line.productId)
    && typeof line.productCode === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/u.test(line.productCode)
    && typeof line.productName === "string" && line.productName.length >= 1 && line.productName.length <= 120
    && typeof line.unit === "string" && /^[A-Za-z][A-Za-z0-9._/-]{0,15}$/u.test(line.unit)
    && typeof line.quantity === "string"
    && /^(0|[1-9][0-9]{0,11})(\.[0-9]{1,6})?$/u.test(line.quantity)
    && Number(line.quantity) > 0;
}

function validProductionPlan(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    && typeof value.code === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/u.test(value.code)
    && typeof value.name === "string" && value.name.length >= 1 && value.name.length <= 120
    && value.warehouse && typeof value.warehouse === "object" && !Array.isArray(value.warehouse)
    && typeof value.warehouse.id === "string" && UUID_PATTERN.test(value.warehouse.id)
    && typeof value.warehouse.name === "string" && value.warehouse.name.length >= 1 && value.warehouse.name.length <= 120
    && Array.isArray(value.recipes) && value.recipes.length >= 1 && value.recipes.length <= 20
    && value.recipes.every((recipe) => recipe && typeof recipe === "object" && !Array.isArray(recipe)
      && typeof recipe.code === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/u.test(recipe.code)
      && typeof recipe.name === "string" && recipe.name.length >= 1 && recipe.name.length <= 120
      && ["dough", "cheese", "pepperoni", "sauce", "frontline"].includes(recipe.stationKey)
      && Array.isArray(recipe.ingredients) && recipe.ingredients.length >= 1 && recipe.ingredients.length <= 200
      && recipe.ingredients.every(validInventoryPlanLine))
    && Array.isArray(value.packagingPerCase) && value.packagingPerCase.length >= 1 && value.packagingPerCase.length <= 200
    && value.packagingPerCase.every(validInventoryPlanLine);
}

function validateRun(value) {
  if (
    !value || typeof value !== "object" || Array.isArray(value)
    || !UUID_PATTERN.test(value.id)
    || !STATUSES.has(value.status)
    || !Number.isSafeInteger(value.revision)
    || value.revision < 0
    || value.revision > MAX_SAFE_REVISION
    || !validCanonicalTimestamp(value.createdAt)
    || !validCanonicalTimestamp(value.updatedAt)
    || !validCanonicalTimestamp(value.startedAt, true)
    || !validCanonicalTimestamp(value.pausedAt, true)
    || !validCanonicalTimestamp(value.resumedAt, true)
    || !validCanonicalTimestamp(value.completedAt, true)
    || !Array.isArray(value.pauseIntervals)
  ) {
    throw new RunServiceError("INVALID_STORAGE_RESPONSE", "Run storage returned invalid data.", 502);
  }
  try {
    normalizeSetupSnapshot(value.setupSnapshot, { fromStorage: true });
  } catch {
    throw new RunServiceError("INVALID_STORAGE_RESPONSE", "Run storage returned invalid setup data.", 502);
  }
  if (value.setupSnapshot.productionPlan !== undefined
    && (!value.setupSnapshot.productCode || !value.setupSnapshot.productionSetupCode
      || !validProductionPlan(value.setupSnapshot.productionPlan))) {
    throw new RunServiceError("INVALID_STORAGE_RESPONSE", "Run storage returned invalid production setup data.", 502);
  }
  if (value.inventoryConsumption !== undefined && !validInventoryConsumption(value.inventoryConsumption)) {
    throw new RunServiceError("INVALID_STORAGE_RESPONSE", "Run storage returned invalid inventory consumption data.", 502);
  }
  if (value.doughCapacity !== undefined && (
    !value.doughCapacity || typeof value.doughCapacity !== "object" || Array.isArray(value.doughCapacity)
    || !["available", "unavailable"].includes(value.doughCapacity.status)
    || !Array.isArray(value.doughCapacity.reasons)
    || value.doughCapacity.reasons.some((reason) => typeof reason !== "string" || reason.length > 80)
    || (value.doughCapacity.status === "available"
      && (typeof value.doughCapacity.doughballYield !== "number"
        || !Number.isFinite(value.doughCapacity.doughballYield)
        || value.doughCapacity.doughballYield <= 0
        || typeof value.doughCapacity.pizzasPerCase !== "number"
        || !Number.isSafeInteger(value.doughCapacity.pizzasPerCase)
        || value.doughCapacity.pizzasPerCase < 1
        || value.doughCapacity.pizzasPerCase > 100))
  )) {
    throw new RunServiceError("INVALID_STORAGE_RESPONSE", "Run storage returned invalid dough source status.", 502);
  }
  for (const interval of value.pauseIntervals) {
    if (
      !interval || typeof interval !== "object" || Array.isArray(interval)
      || !validCanonicalTimestamp(interval.startedAt)
      || !validCanonicalTimestamp(interval.endedAt, true)
    ) {
      throw new RunServiceError("INVALID_STORAGE_RESPONSE", "Run storage returned invalid pause history.", 502);
    }
  }
  return value;
}

function requireResult(result, predicate, message) {
  const value = result?.rows?.[0]?.result;
  if (!predicate(value)) {
    throw new RunServiceError("INVALID_STORAGE_RESPONSE", message, 502);
  }
  return value;
}

function throwSafeStorageError(error) {
  if (error?.code === "22023") {
    throw new RunServiceError("IDEMPOTENCY_CONFLICT", "This request ID was already used for different run details.", 409);
  }
  throw error;
}

async function authorize(authorizeAction, auth, action) {
  const allowed = await authorizeAction({ auth, action });
  if (allowed !== true) {
    throw new RunServiceError("FORBIDDEN", "You do not have permission to access this run.", 403);
  }
}

export function createRunService({ query, authorize: authorizeAction }) {
  if (typeof query !== "function") {
    throw new TypeError("A parameterized database query function is required.");
  }
  if (typeof authorizeAction !== "function") {
    throw new TypeError("A server authorization function is required.");
  }

  return Object.freeze({
    async create({ auth, requestId, setupSnapshot }) {
      const identity = normalizeAuth(auth);
      const normalizedRequestId = normalizeUuid(requestId, "requestId");
      const normalizedSetup = normalizeSetupSnapshot(setupSnapshot, { requireProductionSetup: true });
      await authorize(authorizeAction, auth, "run.create");

      const requestHash = createHash("sha256").update(JSON.stringify({
        facilityId: identity.facilityId,
        actorId: identity.actorId,
        requestId: normalizedRequestId,
        setupSnapshot: normalizedSetup,
      }), "utf8").digest("hex");

      let result;
      try {
        result = await query(CREATE_SQL, [
          identity.facilityId,
          identity.actorId,
          normalizedRequestId,
          requestHash,
          JSON.stringify(normalizedSetup),
        ]);
      } catch (error) {
        throwSafeStorageError(error);
      }

      const response = requireResult(
        result,
        (value) => value?.outcome === "created" && typeof value.replayed === "boolean",
        "Run creation returned an unexpected result.",
      );
      validateRun(response.run);
      if (
        response.run.status !== "planned"
        || !response.run.setupSnapshot.productionPlan
        || response.run.setupSnapshot.label !== normalizedSetup.label
        || response.run.setupSnapshot.targetCases !== normalizedSetup.targetCases
        || response.run.setupSnapshot.productCode !== normalizedSetup.productCode
        || response.run.setupSnapshot.productionSetupCode !== normalizedSetup.productionSetupCode
      ) {
        throw new RunServiceError("INVALID_STORAGE_RESPONSE", "Run creation returned a different run setup.", 502);
      }
      return response;
    },

    async get({ auth, runId }) {
      const identity = normalizeAuth(auth);
      const normalizedRunId = normalizeUuid(runId, "runId");
      await authorize(authorizeAction, auth, "run.read");
      let result;
      try {
        result = await query(GET_SQL, [identity.facilityId, normalizedRunId]);
      } catch (error) {
        throwSafeStorageError(error);
      }
      const run = requireResult(result, (value) => value === null || typeof value === "object", "Run read returned an unexpected result.");
      return run === null ? null : validateRun(run);
    },

    async list({ auth, limit = 50 }) {
      const identity = normalizeAuth(auth);
      if (!Number.isInteger(limit) || limit < 1 || limit > MAX_RUN_LIST_LIMIT) {
        throw invalidRequest(`limit must be an integer from 1 to ${MAX_RUN_LIST_LIMIT}.`);
      }
      await authorize(authorizeAction, auth, "run.read");
      let result;
      try {
        result = await query(LIST_SQL, [identity.facilityId, limit]);
      } catch (error) {
        throwSafeStorageError(error);
      }
      const runs = requireResult(result, Array.isArray, "Run list returned an unexpected result.");
      return runs.map(validateRun);
    },

    async listProducts({ auth }) {
      const identity = normalizeAuth(auth);
      await authorize(authorizeAction, auth, "run.read");
      let result;
      try {
        result = await query(LIST_PRODUCTS_SQL, [identity.facilityId]);
      } catch (error) {
        throwSafeStorageError(error);
      }
      const catalog = requireResult(result, (value) => value && typeof value === "object" && !Array.isArray(value),
        "Run product list returned an unexpected result.");
      const products = catalog.products;
      const productionWarehouse = catalog.productionWarehouse;
      if (!Array.isArray(products)
        || (productionWarehouse !== null && (!productionWarehouse
          || typeof productionWarehouse !== "object" || Array.isArray(productionWarehouse)
          || !UUID_PATTERN.test(productionWarehouse.id)
          || typeof productionWarehouse.name !== "string"
          || productionWarehouse.name.length < 1 || productionWarehouse.name.length > 120))) {
        throw new RunServiceError("INVALID_STORAGE_RESPONSE", "Run product list returned invalid warehouse data.", 502);
      }
      for (const product of products) {
        if (!product || typeof product !== "object" || Array.isArray(product)
          || typeof product.code !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/u.test(product.code)
          || typeof product.name !== "string" || product.name.length < 1 || product.name.length > 120
          || !Array.isArray(product.productionSetups)
          || product.productionSetups.some((setup) => !setup || typeof setup !== "object" || Array.isArray(setup)
            || typeof setup.code !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/u.test(setup.code)
            || typeof setup.name !== "string" || setup.name.length < 1 || setup.name.length > 120)
          || !product.doughCapacity || typeof product.doughCapacity !== "object"
          || !["available", "unavailable"].includes(product.doughCapacity.status)
          || !Array.isArray(product.doughCapacity.reasons)
          || product.doughCapacity.reasons.some((reason) => typeof reason !== "string" || reason.length > 80)
          || (product.doughCapacity.status === "available"
            && (typeof product.doughCapacity.doughballYield !== "number"
              || !Number.isFinite(product.doughCapacity.doughballYield)
              || typeof product.doughCapacity.pizzasPerCase !== "number"
              || !Number.isSafeInteger(product.doughCapacity.pizzasPerCase)))) {
          throw new RunServiceError("INVALID_STORAGE_RESPONSE", "Run product list returned invalid data.", 502);
        }
      }
      return { products, productionWarehouse };
    },
  });
}
