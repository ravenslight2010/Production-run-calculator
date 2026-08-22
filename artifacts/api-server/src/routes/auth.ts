import { timingSafeEqual } from "node:crypto";
import { Router, type IRouter } from "express";
import {
  ChangePasswordBody,
  CheckUsernameAvailableQueryParams,
  ForgotPasswordBody,
  ResetPasswordBody,
  SignInBody,
  SignUpBody,
} from "@workspace/api-zod";
import {
  SESSION_COOKIE,
  SESSION_COOKIE_MAX_AGE_MS,
  signToken,
  verifyPassword,
} from "../lib/auth";
import {
  SANDBOX_PASSWORD,
  SANDBOX_USERNAME,
  sandboxAllowed,
} from "../lib/sandbox";
import {
  createUser,
  findUserByUsername,
  getUserById,
  isUsernameAvailable,
  updateUserPassword,
} from "../lib/users";
import { invalidateUserSessions } from "../lib/userValidity";
import { createResetRequest, resetPasswordWithCode } from "../lib/passwordResets";
import { createRoleForNewUser, getStaffMember } from "../lib/roles";
import { requireAuth } from "../middlewares/requireAuth";
import { rateLimit } from "../middlewares/rateLimit";
import { PostgresRateLimitStore } from "../middlewares/rateLimitStore";
import { AUTH_RATE_WINDOW_MS, AUTH_RATE_MAX } from "./authRateLimit.constants";

export { AUTH_RATE_WINDOW_MS, AUTH_RATE_MAX };

const router: IRouter = Router();

// These endpoints are all public (reachable before requireAuth / with no
// account yet), so they are the internet's only foothold for brute force,
// credential stuffing, or spam against this server. Fixed-window per-IP caps,
// generous enough not to bother a real user retyping a password a few times.
// Postgres-backed in production so the cap holds across horizontally scaled
// instances; falls back to in-memory in dev/test (single process, no DB
// dependency, and keeps the test suite's many sequential calls from tripping
// the limiter).
const authRateStore =
  process.env.NODE_ENV === "production"
    ? new PostgresRateLimitStore(AUTH_RATE_WINDOW_MS)
    : undefined;
const authRateLimit = rateLimit({
  windowMs: AUTH_RATE_WINDOW_MS,
  max: AUTH_RATE_MAX,
  store: authRateStore,
});

// Sign-up is gated behind a facility access code so the endpoint isn't fully
// public self-registration — anyone reaching it can otherwise mint an account
// with access to shared internal factory data. The code is a plain shared
// secret (like the read-only supervisor PIN elsewhere in the app), configured
// out of band via STAFF_SIGNUP_CODE and handed to legitimate new hires. If the
// operator hasn't configured one, sign-up is closed entirely rather than
// silently left open.
function timingSafeCodeMatches(supplied: string, expected: string | undefined): boolean {
  // Trim surrounding whitespace on both sides before comparing. Access codes
  // never carry meaningful leading/trailing spaces, and secret managers (and
  // users pasting into a form) commonly append a stray space or trailing
  // newline — an exact byte compare would then reject the *correct* code.
  const expectedTrimmed = expected?.trim();
  if (!expectedTrimmed) return false;
  const a = Buffer.from(supplied.trim());
  const b = Buffer.from(expectedTrimmed);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// A sign-up may present EITHER the ordinary shared staff code, or the
// separate, narrower INITIAL_MANAGER_ACCESS_CODE bootstrap secret (see
// isDesignatedInitialManager in lib/roles.ts) — the intended first
// administrator only needs to know their own bootstrap code, not the
// general-staff one, to get past this gate.
function accessCodeMatches(supplied: string): boolean {
  return (
    timingSafeCodeMatches(supplied, process.env.STAFF_SIGNUP_CODE) ||
    timingSafeCodeMatches(supplied, process.env.INITIAL_MANAGER_ACCESS_CODE)
  );
}

function setSessionCookie(
  res: import("express").Response,
  token: string,
): void {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_COOKIE_MAX_AGE_MS,
    path: "/",
  });
}

// Create a staff account and start a session. Requires a valid facility
// access code (STAFF_SIGNUP_CODE) — see accessCodeMatches above. Note that
// this shared code is deliberately NOT sufficient on its own to decide who
// becomes manager: bootstrap also requires the SAME access-code field to match
// the separate INITIAL_MANAGER_ACCESS_CODE secret AND the username to match
// INITIAL_MANAGER_USERNAME (see createRoleForNewUser / resolveBootstrapRole /
// isDesignatedInitialManager in lib/roles.ts); everyone else, including the
// very first sign-up, defaults to operator. createRoleForNewUser inserts
// inside one Postgres advisory-locked transaction so two concurrent sign-ups
// can't race the bootstrap decision.
router.post("/auth/sign-up", authRateLimit, async (req, res): Promise<void> => {
  const parsed = SignUpBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { username, password, accessCode } = parsed.data;
  if (!accessCodeMatches(accessCode)) {
    res.status(403).json({ error: "Incorrect facility code." });
    return;
  }
  const created = await createUser(username, password);
  if (!created.ok) {
    res.status(409).json({ error: "That username is already taken." });
    return;
  }
  await createRoleForNewUser(created.user.id, username, accessCode);
  const token = signToken(created.user.id);
  setSessionCookie(res, token);
  res.status(201).json({ token, user: await getStaffMember(created.user.id) });
});

// Read-only username availability check for the live sign-up hint. Public, the
// same as sign-up. Case-insensitive, matching how accounts are actually created.
router.get("/auth/username-available", authRateLimit, async (req, res): Promise<void> => {
  // The generated query schema coerces a missing param to the string
  // "undefined", so guard presence explicitly before validating length.
  const raw = req.query.username;
  if (typeof raw !== "string" || raw.trim().length === 0) {
    res.status(400).json({ error: "username query parameter is required" });
    return;
  }
  const parsed = CheckUsernameAvailableQueryParams.safeParse({ username: raw });
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const available = await isUsernameAvailable(parsed.data.username);
  res.json({ available });
});

// Sign in with username + password.
router.post("/auth/sign-in", authRateLimit, async (req, res): Promise<void> => {
  // The development-only sandbox shortcut deliberately uses "test"/"test".
  // Its public four-character password predates the normal six-character
  // staff-password policy, so admit this exact pair through validation and
  // retain the existing sandbox flag/production gate below. All other sign-in
  // attempts still use the generated contract unchanged.
  const isSandboxShortcut =
    req.body?.username === SANDBOX_USERNAME &&
    req.body?.password === SANDBOX_PASSWORD;
  const parsed = isSandboxShortcut
    ? { success: true as const, data: { username: SANDBOX_USERNAME, password: SANDBOX_PASSWORD } }
    : SignInBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { username, password } = parsed.data;
  const user = await findUserByUsername(username);
  if (!user || !verifyPassword(password, user.passwordHash)) {
    res.status(401).json({ error: "Invalid username or password." });
    return;
  }
  // The seeded sandbox account uses a well-known public password and is a
  // non-production demo shortcut only (see sandboxAllowed()). Refuse to
  // authenticate it in production even if a sandbox row lingers in the DB, so
  // there is no anonymous path into the app on a real deployment.
  if (user.sandbox && !sandboxAllowed()) {
    res.status(401).json({ error: "Invalid username or password." });
    return;
  }
  const token = signToken(user.id);
  setSessionCookie(res, token);
  res.json({ token, user: await getStaffMember(user.id) });
});

// Sign out — clears the web session cookie. Mobile simply discards its stored
// token; the stateless token naturally expires.
router.post("/auth/sign-out", (_req, res): void => {
  res.clearCookie(SESSION_COOKIE, { path: "/" });
  res.status(204).end();
});

// Change the signed-in user's password. Gated by requireAuth (this router is
// otherwise mounted publicly, before the global auth gate). The current
// password is verified against the stored hash before it is replaced.
//
// Changing the password invalidates every session token issued before this
// moment (see requireAuth's password-change fence) — including the token used
// to authenticate this very request — so a fresh token must be minted and
// handed back, exactly like sign-in, or the caller would be logged out by
// their own password change.
router.post(
  "/auth/change-password",
  authRateLimit,
  requireAuth,
  async (req, res): Promise<void> => {
    const parsed = ChangePasswordBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const { currentPassword, newPassword } = parsed.data;
    const user = await getUserById(req.userId!);
    if (!user || !verifyPassword(currentPassword, user.passwordHash)) {
      res.status(401).json({ error: "Current password is incorrect." });
      return;
    }
    await updateUserPassword(user.id, newPassword);
    invalidateUserSessions(user.id);
    const token = signToken(user.id);
    setSessionCookie(res, token);
    res.json({ token, user: await getStaffMember(user.id) });
  },
);

// Request a manager-approved password reset for a forgotten password. Public —
// the user is signed out. Always responds 200 with { ok: true } whether or not
// the account exists, so the endpoint can't be used to discover usernames.
router.post("/auth/forgot-password", authRateLimit, async (req, res): Promise<void> => {
  const parsed = ForgotPasswordBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  await createResetRequest(parsed.data.username);
  res.json({ ok: true });
});

// Complete a reset with the single-use code a manager issued. Public. Verifies
// the code belongs to an approved, unused, unexpired request for the named user
// before replacing the password; a bad/expired/used code yields a 401.
router.post("/auth/reset-password", authRateLimit, async (req, res): Promise<void> => {
  const parsed = ResetPasswordBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { username, code, newPassword } = parsed.data;
  const result = await resetPasswordWithCode(username, code, newPassword);
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  res.status(204).end();
});

export default router;
