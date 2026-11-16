import {
  argon2 as argon2Callback,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const SESSION_COOKIE = "v2_session";
const CSRF_COOKIE = "v2_csrf";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const MAX_LOGIN_KEYS = 10_000;
const PASSWORD_HASH_LENGTH = 32;
const ARGON2_PARAMETERS = Object.freeze({ memory: 19_456, passes: 2, parallelism: 1 });
const MAX_ACTIVE_PASSWORD_CHECKS = 4;
const RUN_ACTIONS = new Set([
  "run.read", "run.create", "run.lifecycle.command", "station.read", "station.command",
]);
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
let activePasswordChecks = 0;

const FIND_STAFF_SQL = "SELECT * FROM v2.find_staff_for_sign_in($1::text)";
const OPEN_SESSION_SQL = "SELECT v2.open_staff_session($1::uuid, $2::text, $3::text, $4::timestamptz) AS opened";
const RESOLVE_SESSION_SQL = "SELECT * FROM v2.resolve_staff_session($1::text)";
const REVOKE_SESSION_SQL = "SELECT v2.revoke_staff_session($1::text) AS revoked";
const BOOTSTRAP_OPEN_SQL = "SELECT v2.staff_bootstrap_open() AS available";
const BOOTSTRAP_MANAGER_SQL = "SELECT v2.bootstrap_first_manager($1::text, $2::text) AS created";
const LIST_STAFF_SQL = "SELECT * FROM v2.list_staff_accounts($1::uuid)";
const LIST_STAFF_ROLES_SQL = "SELECT * FROM v2.list_staff_roles($1::uuid)";
const CREATE_STAFF_SQL = "SELECT v2.create_staff_account($1::uuid, $2::text, $3::text, $4::text) AS outcome";
const UPDATE_STAFF_SQL = "SELECT v2.update_staff_account($1::uuid, $2::uuid, $3::boolean, $4::text) AS outcome";

export class V2AuthError extends Error {
  constructor(status, message, retryAfterSeconds = undefined) {
    super(message);
    this.name = "V2AuthError";
    this.status = status;
    if (retryAfterSeconds !== undefined) this.retryAfterSeconds = retryAfterSeconds;
  }
}

function normalizeUsername(value) {
  if (
    typeof value !== "string"
    || value.trim() !== value
    || value.length < 3
    || value.length > 40
    || /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new V2AuthError(400, "Enter a valid username and password.");
  }
  return value.toLowerCase();
}

function validatePassword(value) {
  if (typeof value !== "string" || value.length < 1 || value.length > 128) {
    throw new V2AuthError(400, "Enter a valid username and password.");
  }
}

function hashHex(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function canonicalBase64(value) {
  if (typeof value !== "string" || value.length === 0) return null;
  const decoded = Buffer.from(value, "base64");
  return decoded.toString("base64") === value ? decoded : null;
}

async function derivePasswordHash(password, salt) {
  if (typeof argon2Callback !== "function") {
    throw new Error("This V2 runtime does not provide the required Argon2id implementation.");
  }
  const result = await new Promise((resolve, reject) => {
    argon2Callback("argon2id", {
      message: Buffer.from(password, "utf8"),
      nonce: salt,
      parallelism: ARGON2_PARAMETERS.parallelism,
      tagLength: PASSWORD_HASH_LENGTH,
      memory: ARGON2_PARAMETERS.memory,
      passes: ARGON2_PARAMETERS.passes,
    }, (error, derived) => error ? reject(error) : resolve(derived));
  });
  return Buffer.from(result);
}

export async function hashPassword(password) {
  if (typeof password !== "string" || password.length < 6 || password.length > 128) {
    throw new TypeError("Passwords must be between 6 and 128 characters.");
  }
  if (activePasswordChecks >= MAX_ACTIVE_PASSWORD_CHECKS) {
    throw new V2AuthError(429, "Password processing is temporarily busy. Wait briefly and try again.", 1);
  }
  activePasswordChecks += 1;
  try {
    const salt = randomBytes(16);
    const derived = await derivePasswordHash(password, salt);
    return `argon2id$v=19$m=${ARGON2_PARAMETERS.memory},t=${ARGON2_PARAMETERS.passes},p=${ARGON2_PARAMETERS.parallelism}$${salt.toString("base64")}$${derived.toString("base64")}`;
  } finally {
    activePasswordChecks -= 1;
  }
}

export async function verifyPassword(password, encodedHash) {
  if (
    typeof password !== "string"
    || password.length < 1
    || password.length > 128
    || typeof encodedHash !== "string"
    || encodedHash.length > 256
  ) {
    return false;
  }
  const parts = encodedHash.split("$");
  const expectedParameters = `m=${ARGON2_PARAMETERS.memory},t=${ARGON2_PARAMETERS.passes},p=${ARGON2_PARAMETERS.parallelism}`;
  if (parts.length !== 5 || parts[0] !== "argon2id" || parts[1] !== "v=19" || parts[2] !== expectedParameters) return false;
  const salt = canonicalBase64(parts[3]);
  const expected = canonicalBase64(parts[4]);
  if (!salt || salt.length !== 16 || !expected || expected.length !== PASSWORD_HASH_LENGTH) return false;
  if (activePasswordChecks >= MAX_ACTIVE_PASSWORD_CHECKS) {
    throw new V2AuthError(429, "Sign-in is temporarily busy. Wait briefly and try again.", 1);
  }

  activePasswordChecks += 1;
  try {
    const actual = await derivePasswordHash(password, salt);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  } finally {
    activePasswordChecks -= 1;
  }
}

function createRateLimiter({ maxAttempts, windowMs, clock }) {
  const entries = new Map();
  return {
    consume(key) {
      const now = clock();
      for (const [existingKey, item] of entries) {
        if (item.resetAt <= now) entries.delete(existingKey);
      }

      let item = entries.get(key);
      if (!item || item.resetAt <= now) {
        item = { count: 0, resetAt: now + windowMs };
        entries.delete(key);
        entries.set(key, item);
      } else {
        entries.delete(key);
        entries.set(key, item);
      }
      if (entries.size > MAX_LOGIN_KEYS) {
        const oldestKey = entries.keys().next().value;
        if (oldestKey !== undefined) entries.delete(oldestKey);
      }

      if (item.count >= maxAttempts) {
        return {
          allowed: false,
          retryAfterSeconds: Math.max(1, Math.ceil((item.resetAt - now) / 1000)),
        };
      }
      item.count += 1;
      return { allowed: true };
    },
  };
}

function parseCookie(request, cookieName) {
  const raw = request?.headers?.cookie;
  if (typeof raw !== "string" || raw.length > 4096) return null;
  let found = null;
  for (const part of raw.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 1) continue;
    const name = part.slice(0, separator).trim();
    if (name !== cookieName) continue;
    if (found !== null) return null;
    const value = part.slice(separator + 1).trim();
    if (!/^[A-Za-z0-9_-]{43}$/.test(value)) return null;
    found = value;
  }
  return found;
}

function validatePrincipal(row) {
  const capabilities = row?.capabilities;
  if (
    !row
    || !UUID_PATTERN.test(row.actor_id ?? "")
    || !UUID_PATTERN.test(row.facility_id ?? "")
    || typeof row.username !== "string"
    || typeof row.role_name !== "string"
    || !Array.isArray(capabilities)
    || capabilities.length > 100
    || capabilities.some((capability) => typeof capability !== "string" || capability.length > 80)
    || typeof row.csrf_hash !== "string"
    || !HASH_PATTERN.test(row.csrf_hash)
    || typeof row.expires_at !== "string" && !(row.expires_at instanceof Date)
  ) {
    throw new V2AuthError(503, "Sign-in is temporarily unavailable. Try again.");
  }
  const expiresAt = new Date(row.expires_at);
  if (Number.isNaN(expiresAt.valueOf())) {
    throw new V2AuthError(503, "Sign-in is temporarily unavailable. Try again.");
  }
  return {
    verified: true,
    actorId: row.actor_id.toLowerCase(),
    facilityId: row.facility_id.toLowerCase(),
    username: row.username,
    role: row.role_name,
    capabilities,
    csrfHash: row.csrf_hash,
    sessionExpiresAt: expiresAt.toISOString(),
  };
}

function publicStaff(auth) {
  return {
    userId: auth.actorId,
    username: auth.username,
    role: auth.role,
    capabilities: [...auth.capabilities],
  };
}

function makeCookie(token, { secure, maxAgeSeconds }) {
  const safeAge = Number.isSafeInteger(maxAgeSeconds) && maxAgeSeconds >= 0
    ? maxAgeSeconds
    : Math.floor(SESSION_TTL_MS / 1000);
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${safeAge}${secure ? "; Secure" : ""}`;
}

export function createAuthAdapter({
  query,
  clock = Date.now,
  sessionTtlMs = SESSION_TTL_MS,
  loginLimit = { maxAttempts: 20, windowMs: 60_000 },
  bootstrapSecret = "",
  bootstrapStatusLimit = { maxAttempts: 60, windowMs: 60_000 },
  bootstrapLimit = { maxAttempts: 5, windowMs: 60_000 },
  staffReadLimit = { maxAttempts: 120, windowMs: 60_000 },
  staffLimit = { maxAttempts: 10, windowMs: 60_000 },
  logger = () => {},
} = {}) {
  if (typeof query !== "function") throw new TypeError("A parameterized V2 database query is required.");
  if (typeof clock !== "function") throw new TypeError("A clock function is required.");
  if (!Number.isSafeInteger(sessionTtlMs) || sessionTtlMs < 60_000 || sessionTtlMs > MAX_SESSION_TTL_MS) {
    throw new TypeError("sessionTtlMs must be between one minute and 90 days.");
  }
  if (
    !Number.isSafeInteger(loginLimit?.maxAttempts)
    || loginLimit.maxAttempts < 1
    || !Number.isSafeInteger(loginLimit.windowMs)
    || loginLimit.windowMs < 1000
  ) {
    throw new TypeError("A positive login rate limit is required.");
  }
  for (const [name, limit] of [
    ["bootstrapStatusLimit", bootstrapStatusLimit],
    ["bootstrapLimit", bootstrapLimit],
    ["staffReadLimit", staffReadLimit],
    ["staffLimit", staffLimit],
  ]) {
    if (
      !Number.isSafeInteger(limit?.maxAttempts)
      || limit.maxAttempts < 1
      || !Number.isSafeInteger(limit.windowMs)
      || limit.windowMs < 1000
    ) {
      throw new TypeError(`A positive ${name} is required.`);
    }
  }

  const limiter = createRateLimiter({ ...loginLimit, clock });
  const bootstrapStatusLimiter = createRateLimiter({ ...bootstrapStatusLimit, clock });
  const bootstrapLimiter = createRateLimiter({ ...bootstrapLimit, clock });
  const staffReadLimiter = createRateLimiter({ ...staffReadLimit, clock });
  const staffLimiter = createRateLimiter({ ...staffLimit, clock });
  const bootstrapIsConfigured = typeof bootstrapSecret === "string"
    && bootstrapSecret.length >= 32
    && bootstrapSecret.length <= 256;
  let dummyHashPromise;

  function consumeLimit(targetLimiter, keys, message) {
    const results = keys.map((key) => targetLimiter.consume(key));
    const blocked = results.find((result) => !result.allowed);
    if (blocked) {
      throw new V2AuthError(429, message, blocked.retryAfterSeconds);
    }
  }

  function checkBootstrapSecret(value) {
    if (!bootstrapIsConfigured) return false;
    if (typeof value !== "string" || value.length < 32 || value.length > 256) return false;
    const actual = Buffer.from(hashHex(value), "hex");
    const expected = Buffer.from(hashHex(bootstrapSecret), "hex");
    return timingSafeEqual(actual, expected);
  }

  async function dummyHash() {
    dummyHashPromise ??= hashPassword(randomBytes(24).toString("hex"));
    return dummyHashPromise;
  }

  async function signIn({ username, password, clientKey }) {
    const normalizedUsername = normalizeUsername(username);
    validatePassword(password);
    if (typeof clientKey !== "string" || clientKey.length < 1 || clientKey.length > 256) {
      throw new V2AuthError(400, "Sign-in request is invalid.");
    }

    const ipLimit = limiter.consume(`ip:${hashHex(clientKey)}`);
    const accountLimit = limiter.consume(`account:${hashHex(normalizedUsername)}`);
    if (!ipLimit.allowed || !accountLimit.allowed) {
      const retryAfterSeconds = Math.max(
        ipLimit.retryAfterSeconds ?? 0,
        accountLimit.retryAfterSeconds ?? 0,
      );
      logger({
        event: "v2.auth.sign_in",
        outcome: "rate_limited",
        retryAfterSeconds,
      });
      throw new V2AuthError(429, "Too many sign-in attempts. Wait and try again.", retryAfterSeconds);
    }

    const lookup = await query(FIND_STAFF_SQL, [normalizedUsername]);
    const account = lookup?.rows?.[0];
    const passwordHash = typeof account?.password_hash === "string"
      ? account.password_hash
      : await dummyHash();
    const passwordMatches = await verifyPassword(password, passwordHash);
    if (!account || account.disabled !== false || !passwordMatches) {
      logger({ event: "v2.auth.sign_in", outcome: "rejected" });
      throw new V2AuthError(401, "Invalid username or password.");
    }

    const token = randomBytes(32).toString("base64url");
    const csrfToken = randomBytes(32).toString("base64url");
    const tokenHash = hashHex(token);
    const csrfHash = hashHex(csrfToken);
    const expiresAt = new Date(clock() + sessionTtlMs);
    const opened = await query(OPEN_SESSION_SQL, [
      account.staff_id,
      tokenHash,
      csrfHash,
      expiresAt.toISOString(),
    ]);
    if (opened?.rows?.[0]?.opened !== true) {
      logger({ event: "v2.auth.sign_in", outcome: "rejected" });
      throw new V2AuthError(401, "Invalid username or password.");
    }

    const auth = await resolveToken(token);
    if (!auth) {
      await query(REVOKE_SESSION_SQL, [tokenHash]);
      logger({ event: "v2.auth.sign_in", outcome: "unavailable" });
      throw new V2AuthError(503, "Sign-in is temporarily unavailable. Try again.");
    }

    logger({ event: "v2.auth.sign_in", outcome: "accepted", actorId: auth.actorId });
    return {
      token,
      csrfToken,
      expiresAt: auth.sessionExpiresAt,
      staff: publicStaff(auth),
    };
  }

  function validateClientKey(clientKey, message) {
    if (typeof clientKey !== "string" || clientKey.length < 1 || clientKey.length > 256) {
      throw new V2AuthError(400, message);
    }
    return hashHex(clientKey);
  }

  function validateActorId(actorId) {
    if (typeof actorId !== "string" || !UUID_PATTERN.test(actorId)) {
      throw new V2AuthError(401, "Sign in to manage staff accounts.");
    }
  }

  async function listStaff(actorId) {
    validateActorId(actorId);
    consumeLimit(
      staffReadLimiter,
      [`actor:${actorId}`],
      "Staff account reads are temporarily limited. Wait and try again.",
    );
    const [staffResult, roleResult] = await Promise.all([
      query(LIST_STAFF_SQL, [actorId]),
      query(LIST_STAFF_ROLES_SQL, [actorId]),
    ]);
    return {
      staff: (staffResult?.rows ?? []).map((row) => ({
        userId: row.staff_id,
        username: row.username,
        role: row.role_name,
        disabled: row.disabled,
        createdAt: new Date(row.created_at).toISOString(),
      })),
      roles: (roleResult?.rows ?? []).map((row) => ({
        name: row.role_name,
        capabilities: row.capabilities,
      })),
    };
  }

  async function bootstrapAvailable({ clientKey } = {}) {
    if (!bootstrapIsConfigured) return false;
    const clientHash = validateClientKey(clientKey, "Setup status request is invalid.");
    consumeLimit(
      bootstrapStatusLimiter,
      [`client:${clientHash}`],
      "Setup status checks are temporarily limited. Wait and try again.",
    );
    const result = await query(BOOTSTRAP_OPEN_SQL, []);
    return result?.rows?.[0]?.available === true;
  }

  async function bootstrapManager({ username, password, bootstrapCode, clientKey }) {
    if (!bootstrapIsConfigured) {
      throw new V2AuthError(404, "First-manager setup is unavailable.");
    }
    const clientHash = validateClientKey(clientKey, "First-manager setup request is invalid.");
    consumeLimit(
      bootstrapLimiter,
      [`client:${clientHash}`],
      "Too many setup attempts. Wait and try again.",
    );
    if (!checkBootstrapSecret(bootstrapCode)) {
      logger({ event: "v2.auth.bootstrap", outcome: "rejected" });
      throw new V2AuthError(401, "First-manager setup could not be completed.");
    }
    const normalizedUsername = normalizeUsername(username);
    if (typeof password !== "string" || password.length < 6 || password.length > 128) {
      throw new V2AuthError(400, "Passwords must be between 6 and 128 characters.");
    }
    if (!await bootstrapAvailable({ clientKey })) {
      throw new V2AuthError(409, "First-manager setup has already been completed.");
    }
    const passwordHash = await hashPassword(password);
    const result = await query(BOOTSTRAP_MANAGER_SQL, [normalizedUsername, passwordHash]);
    if (result?.rows?.[0]?.created !== true) {
      logger({ event: "v2.auth.bootstrap", outcome: "closed" });
      throw new V2AuthError(409, "First-manager setup has already been completed.");
    }
    logger({ event: "v2.auth.bootstrap", outcome: "created" });
    return signIn({ username: normalizedUsername, password, clientKey });
  }

  async function createStaffAccount({ actorId, username, password, roleName, clientKey }) {
    validateActorId(actorId);
    const clientHash = validateClientKey(clientKey, "Staff account request is invalid.");
    consumeLimit(
      staffLimiter,
      [`client:${clientHash}`, `actor:${actorId}`],
      "Too many staff account changes. Wait and try again.",
    );
    const normalizedUsername = normalizeUsername(username);
    if (typeof password !== "string" || password.length < 6 || password.length > 128) {
      throw new V2AuthError(400, "Passwords must be between 6 and 128 characters.");
    }
    if (typeof roleName !== "string" || roleName.length < 1 || roleName.length > 80) {
      throw new V2AuthError(400, "Choose a valid staff role.");
    }

    const passwordHash = await hashPassword(password);
    const result = await query(CREATE_STAFF_SQL, [actorId, normalizedUsername, passwordHash, roleName]);
    const outcome = result?.rows?.[0]?.outcome;
    if (outcome === "duplicate") throw new V2AuthError(409, "That username is already in use.");
    if (outcome === "invalid_role") throw new V2AuthError(400, "Choose a valid staff role.");
    if (outcome !== "created") throw new V2AuthError(503, "The staff account could not be created. Try again.");
    logger({ event: "v2.auth.staff.create", outcome: "created", actorId });
    return true;
  }

  async function updateStaffAccount({ actorId, staffId, disabled, roleName, clientKey }) {
    validateActorId(actorId);
    if (typeof staffId !== "string" || !UUID_PATTERN.test(staffId)) {
      throw new V2AuthError(400, "Choose a valid staff account.");
    }
    if (disabled !== undefined && typeof disabled !== "boolean") {
      throw new V2AuthError(400, "Choose whether the account is enabled or disabled.");
    }
    if (roleName !== undefined && (typeof roleName !== "string" || roleName.length < 1 || roleName.length > 80)) {
      throw new V2AuthError(400, "Choose a valid staff role.");
    }
    if (disabled === undefined && roleName === undefined) {
      throw new V2AuthError(400, "Choose an account status or role to change.");
    }
    const clientHash = validateClientKey(clientKey, "Staff account request is invalid.");
    consumeLimit(
      staffLimiter,
      [`client:${clientHash}`, `actor:${actorId}`],
      "Too many staff account changes. Wait and try again.",
    );
    const result = await query(UPDATE_STAFF_SQL, [
      actorId,
      staffId,
      disabled ?? null,
      roleName ?? null,
    ]);
    const outcome = result?.rows?.[0]?.outcome;
    if (outcome === "not_found") throw new V2AuthError(404, "Staff account not found.");
    if (outcome === "invalid_role") throw new V2AuthError(400, "Choose a valid staff role.");
    if (outcome === "last_manager") {
      throw new V2AuthError(409, "At least one enabled manager account must remain.");
    }
    if (outcome === "self_change") {
      throw new V2AuthError(409, "You cannot change your own staff account.");
    }
    if (outcome !== "updated" && outcome !== "unchanged") {
      throw new V2AuthError(503, "The staff account could not be updated. Try again.");
    }
    logger({ event: "v2.auth.staff.update", outcome, actorId, targetId: staffId });
    return { outcome };
  }

  async function resolveToken(token) {
    if (!token) return null;
    const result = await query(RESOLVE_SESSION_SQL, [hashHex(token)]);
    const row = result?.rows?.[0];
    return row ? validatePrincipal(row) : null;
  }

  return Object.freeze({
    signIn,

    bootstrapAvailable,

    bootstrapManager,

    listStaff,

    createStaffAccount,

    updateStaffAccount,

    authenticate(request) {
      return resolveToken(parseCookie(request, SESSION_COOKIE));
    },

    async verifyCsrf(request, auth) {
      const supplied = request?.headers?.["x-csrf-token"];
      const cookieToken = parseCookie(request, CSRF_COOKIE);
      if (
        auth?.verified !== true
        || typeof supplied !== "string"
        || supplied.length !== 43
        || cookieToken === null
        || supplied !== cookieToken
      ) return false;
      const actualHash = Buffer.from(hashHex(supplied), "hex");
      const expectedHash = Buffer.from(auth.csrfHash, "hex");
      return actualHash.length === expectedHash.length && timingSafeEqual(actualHash, expectedHash);
    },

    async signOut(request) {
      const token = parseCookie(request, SESSION_COOKIE);
      if (!token) return false;
      const result = await query(REVOKE_SESSION_SQL, [hashHex(token)]);
      return result?.rows?.[0]?.revoked === true;
    },

    authorizeRun({ auth, action }) {
      return auth?.verified === true && RUN_ACTIONS.has(action);
    },

    sessionCookie(token, { secure = process.env.NODE_ENV === "production" } = {}) {
      if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
        throw new TypeError("A generated V2 session token is required.");
      }
      return makeCookie(token, {
        secure,
        maxAgeSeconds: Math.floor(sessionTtlMs / 1000),
      });
    },

    csrfCookie(token, { secure = process.env.NODE_ENV === "production" } = {}) {
      if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
        throw new TypeError("A generated V2 CSRF token is required.");
      }
      const maxAgeSeconds = Math.floor(sessionTtlMs / 1000);
      return `${CSRF_COOKIE}=${token}; Path=/; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure ? "; Secure" : ""}`;
    },

    clearSessionCookie({ secure = process.env.NODE_ENV === "production" } = {}) {
      return makeCookie("", { secure, maxAgeSeconds: 0 });
    },

    clearCsrfCookie({ secure = process.env.NODE_ENV === "production" } = {}) {
      return `${CSRF_COOKIE}=; Path=/; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;
    },
  });
}
