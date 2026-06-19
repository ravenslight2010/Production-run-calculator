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
  createUser,
  findUserByUsername,
  getUserById,
  isUsernameAvailable,
  updateUserPassword,
} from "../lib/users";
import { createResetRequest, resetPasswordWithCode } from "../lib/passwordResets";
import { createRoleForNewUser, getStaffMember } from "../lib/roles";
import { requireAuth } from "../middlewares/requireAuth";

const router: IRouter = Router();

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

// Create a staff account and start a session. The first account ever created
// becomes a manager (bootstrap); every later account defaults to operator.
router.post("/auth/sign-up", async (req, res): Promise<void> => {
  const parsed = SignUpBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { username, password } = parsed.data;
  const created = await createUser(username, password);
  if (!created.ok) {
    res.status(409).json({ error: "That username is already taken." });
    return;
  }
  await createRoleForNewUser(created.user.id);
  const token = signToken(created.user.id);
  setSessionCookie(res, token);
  res.status(201).json({ token, user: await getStaffMember(created.user.id) });
});

// Read-only username availability check for the live sign-up hint. Public, the
// same as sign-up. Case-insensitive, matching how accounts are actually created.
router.get("/auth/username-available", async (req, res): Promise<void> => {
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
router.post("/auth/sign-in", async (req, res): Promise<void> => {
  const parsed = SignInBody.safeParse(req.body);
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
router.post(
  "/auth/change-password",
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
    res.status(204).end();
  },
);

// Request a manager-approved password reset for a forgotten password. Public —
// the user is signed out. Always responds 200 with { ok: true } whether or not
// the account exists, so the endpoint can't be used to discover usernames.
router.post("/auth/forgot-password", async (req, res): Promise<void> => {
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
router.post("/auth/reset-password", async (req, res): Promise<void> => {
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
