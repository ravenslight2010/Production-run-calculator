import { Router, type IRouter } from "express";
import { ChangePasswordBody, SignInBody, SignUpBody } from "@workspace/api-zod";
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
  updateUserPassword,
} from "../lib/users";
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

export default router;
