// Unit tests for the session-token half of the daily-reset fence.
//
// The boundary check in requireAuth compares a token's issued-at (`iat`) against
// today's reset timestamp, so the value verifyToken reports for `iat` is
// security-critical:
//  - tokens minted by signToken carry a real `iat`,
//  - legacy tokens minted before the field existed must fall back to the process
//    start time (NOT 0), or every old session would be fenced out the instant
//    any reset is recorded.
import { createHmac } from "node:crypto";
import { describe, it, expect } from "vitest";

// getSecret() reads this lazily (per call), so setting it before any token is
// signed/verified is enough; PROCESS_START_SEC is captured at import and needs
// no secret.
const SECRET = "test-secret-for-auth-unit";
process.env.AUTH_TOKEN_SECRET = SECRET;

import { signToken, verifyToken } from "./auth";

function b64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// Mint a token with an arbitrary payload, signed with the same secret the module
// uses. Lets us forge "legacy" (no `iat`) and expired tokens the public
// signToken would never produce.
function craft(payload: Record<string, unknown>): string {
  const body = b64url(JSON.stringify(payload));
  const sig = b64url(createHmac("sha256", SECRET).update(body).digest());
  return `${body}.${sig}`;
}

const nowSec = () => Math.floor(Date.now() / 1000);

describe("verifyToken", () => {
  it("returns the subject and the exact iat for a freshly signed token", () => {
    const before = nowSec();
    const token = signToken("user-1");
    const verified = verifyToken(token);
    expect(verified).not.toBeNull();
    expect(verified!.sub).toBe("user-1");
    // The token's iat is its mint time, within a second or two of now.
    expect(verified!.iat).toBeGreaterThanOrEqual(before);
    expect(verified!.iat).toBeLessThanOrEqual(nowSec());
  });

  it("falls back to the process start time for a legacy token with no iat", () => {
    // A valid, unexpired token that predates the `iat` field. It must still
    // verify, and its effective iat must be a sane recent timestamp (the process
    // start), never 0 — otherwise any recorded reset would fence it out.
    const start = nowSec();
    const legacy = craft({ sub: "legacy-user", exp: nowSec() + 1000 });
    const verified = verifyToken(legacy);
    expect(verified).not.toBeNull();
    expect(verified!.sub).toBe("legacy-user");
    expect(verified!.iat).toBeGreaterThan(0);
    // Process start was captured at import, i.e. shortly before this test ran.
    expect(verified!.iat).toBeLessThanOrEqual(start + 1);
    expect(verified!.iat).toBeGreaterThan(start - 60);
  });

  it("rejects a token whose signature does not match (tampered)", () => {
    const token = signToken("user-1");
    const tampered = token.slice(0, -1) + (token.endsWith("A") ? "B" : "A");
    expect(verifyToken(tampered)).toBeNull();
  });

  it("rejects an expired token", () => {
    const expired = craft({ sub: "user-1", iat: nowSec() - 2000, exp: nowSec() - 1000 });
    expect(verifyToken(expired)).toBeNull();
  });

  it("rejects a malformed token", () => {
    expect(verifyToken("not-a-token")).toBeNull();
    expect(verifyToken("")).toBeNull();
  });
});
