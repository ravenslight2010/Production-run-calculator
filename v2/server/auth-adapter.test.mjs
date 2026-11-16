import assert from "node:assert/strict";
import test from "node:test";
import { createAuthAdapter, hashPassword, verifyPassword } from "./auth-adapter.mjs";

const USER_ID = "71000000-0000-4000-8000-000000000001";
const FACILITY_ID = "71000000-0000-4000-8000-000000000099";
const PASSWORD = "correct horse battery";

function principalRow({
  actorId = USER_ID,
  facilityId = FACILITY_ID,
  username = "ShiftManager",
  role = "manager",
  capabilities = ["manage-staff"],
  csrfHash,
  expiresAt = new Date(Date.now() + 60_000).toISOString(),
} = {}) {
  return {
    actor_id: actorId,
    facility_id: facilityId,
    username,
    role_name: role,
    capabilities,
    csrf_hash: csrfHash,
    expires_at: expiresAt,
  };
}

async function createFixture(t, { maxAttempts = 20, clock = Date.now } = {}) {
  const passwordHash = await hashPassword(PASSWORD);
  const sessions = new Map();
  const calls = [];
  const query = async (sql, params) => {
    calls.push({ sql, params });
    if (sql.includes("find_staff_for_sign_in")) {
      return params[0] === "shiftmanager"
        ? { rows: [{ staff_id: USER_ID, password_hash: passwordHash, disabled: false }] }
        : { rows: [] };
    }
    if (sql.includes("open_staff_session")) {
      const [staffId, tokenHash, csrfHash, expiresAt] = params;
      if (staffId !== USER_ID) return { rows: [{ opened: false }] };
      sessions.set(tokenHash, { csrfHash, expiresAt });
      return { rows: [{ opened: true }] };
    }
    if (sql.includes("resolve_staff_session")) {
      const [tokenHash] = params;
      const session = sessions.get(tokenHash);
      if (!session || new Date(session.expiresAt).valueOf() <= clock()) return { rows: [] };
      return { rows: [principalRow({ csrfHash: session.csrfHash, expiresAt: session.expiresAt })] };
    }
    if (sql.includes("revoke_staff_session")) {
      const [tokenHash] = params;
      const revoked = sessions.delete(tokenHash);
      return { rows: [{ revoked }] };
    }
    throw new Error("Unexpected query");
  };
  const adapter = createAuthAdapter({
    query,
    clock,
    loginLimit: { maxAttempts, windowMs: 60_000 },
  });
  t.after(() => sessions.clear());
  return { adapter, calls, sessions };
}

test("hashes passwords with salted Argon2id and verifies without timing-unsafe equality", async () => {
  const first = await hashPassword(PASSWORD);
  const second = await hashPassword(PASSWORD);
  assert.match(first, /^argon2id\$v=19\$m=19456,t=2,p=1\$/);
  assert.notEqual(first, second);
  assert.equal(await verifyPassword(PASSWORD, first), true);
  assert.equal(await verifyPassword("wrong password", first), false);
  assert.equal(await verifyPassword(PASSWORD, "plain-text-password"), false);
  assert.equal(await verifyPassword(PASSWORD, "scrypt$invalid$invalid"), false);
  assert.equal(await verifyPassword(PASSWORD, first.replace("m=19456,t=2,p=1", "m=999999,t=2,p=1")), false);
});

test("bounds concurrent Argon2id password checks under login pressure", async () => {
  const encodedHash = await hashPassword(PASSWORD);
  const results = await Promise.allSettled(
    Array.from({ length: 5 }, () => verifyPassword(PASSWORD, encodedHash)),
  );
  assert.equal(results.filter((result) => result.status === "fulfilled" && result.value === true).length, 4);
  const rejected = results.filter((result) => result.status === "rejected");
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason.status, 429);
});

test("first-manager status is closed without a configured secret and rate-limited when open", async () => {
  let queryCount = 0;
  const query = async () => {
    queryCount += 1;
    return { rows: [{ available: true }] };
  };
  const closed = createAuthAdapter({ query });
  assert.equal(await closed.bootstrapAvailable(), false);
  assert.equal(queryCount, 0);

  const configured = createAuthAdapter({
    query,
    bootstrapSecret: "a".repeat(32),
    bootstrapStatusLimit: { maxAttempts: 1, windowMs: 60_000 },
  });
  assert.equal(await configured.bootstrapAvailable({ clientKey: "bootstrap-client" }), true);
  await assert.rejects(
    configured.bootstrapAvailable({ clientKey: "bootstrap-client" }),
    { name: "V2AuthError", status: 429 },
  );
  assert.equal(queryCount, 1);
});

test("sign-in normalizes username, creates a fresh opaque session, and never sends hashes to the client", async (t) => {
  const { adapter, calls, sessions } = await createFixture(t);
  const result = await adapter.signIn({
    username: "ShiftManager",
    password: PASSWORD,
    clientKey: "trusted-client-key",
  });

  assert.match(result.token, /^[A-Za-z0-9_-]{43}$/);
  assert.match(result.csrfToken, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(result.staff.userId, USER_ID);
  assert.equal(result.staff.username, "ShiftManager");
  assert.equal(result.staff.role, "manager");
  assert.deepEqual(result.staff.capabilities, ["manage-staff"]);
  assert.equal(JSON.stringify(result).includes("password_hash"), false);
  assert.equal(calls[0].params[0], "shiftmanager");
  assert.equal(calls[1].params[0], USER_ID);
  assert.match(calls[1].params[1], /^[0-9a-f]{64}$/);
  assert.match(calls[1].params[2], /^[0-9a-f]{64}$/);
  assert.equal(sessions.size, 1);
});

test("unknown usernames and bad passwords return the same safe failure", async (t) => {
  const { adapter } = await createFixture(t);
  await assert.rejects(
    adapter.signIn({ username: "not-a-user", password: PASSWORD, clientKey: "ip-a" }),
    { name: "V2AuthError", status: 401, message: "Invalid username or password." },
  );
  await assert.rejects(
    adapter.signIn({ username: "ShiftManager", password: "incorrect", clientKey: "ip-b" }),
    { name: "V2AuthError", status: 401, message: "Invalid username or password." },
  );
});

test("sign-in input is bounded and rate-limited by client and normalized username", async (t) => {
  let now = 1000;
  const { adapter, calls } = await createFixture(t, { maxAttempts: 1, clock: () => now });
  await assert.rejects(
    adapter.signIn({ username: "ab", password: PASSWORD, clientKey: "ip-a" }),
    { status: 400 },
  );
  await adapter.signIn({ username: "ShiftManager", password: PASSWORD, clientKey: "ip-a" });
  await assert.rejects(
    adapter.signIn({ username: "shiftmanager", password: PASSWORD, clientKey: "ip-a" }),
    { status: 429, retryAfterSeconds: 60 },
  );
  assert.equal(calls.filter((call) => call.sql.includes("find_staff_for_sign_in")).length, 1);

  now += 60_001;
  await adapter.signIn({ username: "ShiftManager", password: PASSWORD, clientKey: "ip-a" });
  assert.equal(calls.filter((call) => call.sql.includes("find_staff_for_sign_in")).length, 2);
});

test("authentication resolves only the hashed cookie and rejects malformed or duplicate cookies", async (t) => {
  const { adapter } = await createFixture(t);
  const signedIn = await adapter.signIn({
    username: "ShiftManager",
    password: PASSWORD,
    clientKey: "ip-a",
  });
  const request = {
    headers: {
      cookie: `theme=dark; v2_session=${signedIn.token}; v2_csrf=${signedIn.csrfToken}`,
    },
  };
  const auth = await adapter.authenticate(request);
  assert.equal(auth.verified, true);
  assert.equal(auth.actorId, USER_ID);
  assert.equal(auth.facilityId, FACILITY_ID);
  assert.deepEqual(auth.capabilities, ["manage-staff"]);
  assert.equal("token" in auth, false);

  assert.equal(await adapter.authenticate({ headers: { cookie: "v2_session=bad" } }), null);
  assert.equal(
    await adapter.authenticate({ headers: { cookie: `v2_session=${signedIn.token}; v2_session=${signedIn.token}` } }),
    null,
  );
});

test("CSRF verification requires the matching readable cookie and request header", async (t) => {
  const { adapter } = await createFixture(t);
  const signedIn = await adapter.signIn({
    username: "ShiftManager",
    password: PASSWORD,
    clientKey: "ip-a",
  });
  const auth = await adapter.authenticate({
    headers: { cookie: `v2_session=${signedIn.token}; v2_csrf=${signedIn.csrfToken}` },
  });
  const cookie = `v2_session=${signedIn.token}; v2_csrf=${signedIn.csrfToken}`;
  assert.equal(await adapter.verifyCsrf({ headers: { cookie, "x-csrf-token": signedIn.csrfToken } }, auth), true);
  assert.equal(await adapter.verifyCsrf({ headers: { cookie, "x-csrf-token": "wrong" } }, auth), false);
  assert.equal(await adapter.verifyCsrf({ headers: { cookie } }, auth), false);
  assert.equal(await adapter.verifyCsrf({ headers: { cookie, "x-csrf-token": signedIn.csrfToken } }, null), false);
});

test("sign-out revokes the session, and run authorization accepts only authenticated run actions", async (t) => {
  const { adapter } = await createFixture(t);
  const signedIn = await adapter.signIn({
    username: "ShiftManager",
    password: PASSWORD,
    clientKey: "ip-a",
  });
  const request = {
    headers: {
      cookie: `v2_session=${signedIn.token}; v2_csrf=${signedIn.csrfToken}`,
      "x-csrf-token": signedIn.csrfToken,
    },
  };
  const auth = await adapter.authenticate(request);
  assert.equal(adapter.authorizeRun({ auth, action: "run.lifecycle.command" }), true);
  assert.equal(adapter.authorizeRun({ auth, action: "station.command" }), true);
  assert.equal(adapter.authorizeRun({ auth, action: "staff.delete" }), false);
  assert.equal(adapter.authorizeRun({ auth: null, action: "run.read" }), false);
  assert.equal(await adapter.signOut(request), true);
  assert.equal(await adapter.authenticate(request), null);
});

test("session cookie helpers are HttpOnly and clear the same V2 cookie", (t) => {
  const adapter = createAuthAdapter({ query: async () => ({ rows: [] }) });
  const token = "a".repeat(43);
  const cookie = adapter.sessionCookie(token, { secure: true });
  assert.match(cookie, /^v2_session=/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Secure/);
  const cleared = adapter.clearSessionCookie({ secure: true });
  assert.match(cleared, /Max-Age=0/);
  assert.match(cleared, /HttpOnly/);
  assert.match(cleared, /Secure/);
  const csrf = adapter.csrfCookie(token, { secure: true });
  assert.match(csrf, /^v2_csrf=/);
  assert.doesNotMatch(csrf, /HttpOnly/);
  assert.match(csrf, /SameSite=Lax/);
  assert.match(csrf, /Secure/);
  const clearedCsrf = adapter.clearCsrfCookie({ secure: true });
  assert.match(clearedCsrf, /Max-Age=0/);
  assert.match(clearedCsrf, /Secure/);
});
