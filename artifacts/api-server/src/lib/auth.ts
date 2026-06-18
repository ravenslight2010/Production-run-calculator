import {
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";

// ── Password hashing ─────────────────────────────────────────────────────────
// scrypt is a vetted, memory-hard KDF shipped in Node's standard library, so we
// avoid a native dependency. Stored format: `scrypt$<saltB64>$<hashB64>`.
const SCRYPT_KEYLEN = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN);
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const salt = Buffer.from(parts[1], "base64");
  const expected = Buffer.from(parts[2], "base64");
  let actual: Buffer;
  try {
    actual = scryptSync(password, salt, expected.length);
  } catch {
    return false;
  }
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

// ── Session tokens ───────────────────────────────────────────────────────────
// Compact, stateless, HMAC-SHA256-signed token: `<payloadB64url>.<sigB64url>`.
// Payload carries the user id and an expiry; verification is a constant-time
// signature check plus expiry check, so sessions survive server restarts.
const SESSION_TTL_SEC = 60 * 60 * 24 * 30; // 30 days

// Fallback issued-at (seconds) for legacy tokens minted before the `iat` field
// existed. We use the process start time so that, on the deploy that introduces
// daily-reset fencing, already-signed-in users are NOT logged out immediately
// (their effective issued-at is the deploy time, which is newer than any reset
// boundary set earlier that day) — yet the NEXT daily reset, which advances the
// boundary past the deploy time, still signs them out. Legacy tokens are
// replaced with `iat`-stamped tokens on every sign-in, so they disappear within
// a day of deploy.
const PROCESS_START_SEC = Math.floor(Date.now() / 1000);

function getSecret(): string {
  const secret = process.env.AUTH_TOKEN_SECRET || process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error(
      "Missing AUTH_TOKEN_SECRET (or SESSION_SECRET) for signing session tokens",
    );
  }
  return secret;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function sign(data: string): string {
  return b64url(createHmac("sha256", getSecret()).update(data).digest());
}

export function signToken(userId: string): string {
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url(
    JSON.stringify({ sub: userId, iat: now, exp: now + SESSION_TTL_SEC }),
  );
  return `${payload}.${sign(payload)}`;
}

// A verified token: the subject (user id) plus its issued-at time in seconds.
// `iat` falls back to PROCESS_START_SEC for legacy tokens that lack the field
// (see the comment on PROCESS_START_SEC for the deploy-safety rationale).
export type VerifiedToken = { sub: string; iat: number };

export function verifyToken(token: string): VerifiedToken | null {
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = sign(payload);
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }
  try {
    const decoded = JSON.parse(
      Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"),
    ) as { sub?: unknown; iat?: unknown; exp?: unknown };
    if (typeof decoded.sub !== "string") return null;
    if (typeof decoded.exp !== "number" || decoded.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    const iat =
      typeof decoded.iat === "number" ? decoded.iat : PROCESS_START_SEC;
    return { sub: decoded.sub, iat };
  } catch {
    return null;
  }
}

export function newUserId(): string {
  return randomUUID();
}

// ── Password reset relay codes ───────────────────────────────────────────────
// Short single-use codes a manager reads aloud / hands to a locked-out user.
// Drawn from an unambiguous alphabet (no 0/O/1/I) and formatted in two groups so
// they're easy to relay verbally. 8 chars over a 31-symbol alphabet is ~10^12
// possibilities — combined with manager-gated issuance, single use, and a short
// expiry, that's far beyond any practical guessing. Only the sha256 hash is
// stored; the plaintext is shown to the manager exactly once.
const RESET_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const RESET_CODE_LENGTH = 8;
export const RESET_CODE_TTL_MS = 30 * 60 * 1000; // 30 minutes

export function newResetCode(): string {
  let raw = "";
  for (let i = 0; i < RESET_CODE_LENGTH; i += 1) {
    raw += RESET_CODE_ALPHABET[randomInt(RESET_CODE_ALPHABET.length)];
  }
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

// Normalize before hashing so the user can type the code in any case and with or
// without the separating dash / surrounding whitespace.
export function hashResetCode(code: string): string {
  const normalized = code.replace(/[\s-]/g, "").toUpperCase();
  return createHash("sha256").update(normalized).digest("hex");
}

export const SESSION_COOKIE = "rc_auth";
export const SESSION_COOKIE_MAX_AGE_MS = SESSION_TTL_SEC * 1000;
