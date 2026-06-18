import {
  createHmac,
  randomBytes,
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
  const payload = b64url(
    JSON.stringify({ sub: userId, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SEC }),
  );
  return `${payload}.${sign(payload)}`;
}

export function verifyToken(token: string): string | null {
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
    ) as { sub?: unknown; exp?: unknown };
    if (typeof decoded.sub !== "string") return null;
    if (typeof decoded.exp !== "number" || decoded.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return decoded.sub;
  } catch {
    return null;
  }
}

export function newUserId(): string {
  return randomUUID();
}

export const SESSION_COOKIE = "rc_auth";
export const SESSION_COOKIE_MAX_AGE_MS = SESSION_TTL_SEC * 1000;
