// Route-inspection test: authRateLimit is present on every sensitive auth route.
//
// The middleware-level tests in rateLimit.test.ts prove the rateLimit() factory
// works correctly in isolation. The integration tests (signupRateLimit and
// usernameAvailableRateLimit) prove two specific routes actually fire the cap.
// THIS test covers the remaining gap — sign-in, forgot-password, and
// reset-password — and gives a single exhaustive assertion across all five
// sensitive routes without spinning up a live database.
//
// Strategy: mock every DB-touching dependency so routes/auth.ts can be imported
// in unit-test context. Then walk the real Express router's internal stack to
// find the ordered middleware chain for each route. Drive a synthetic request
// through that chain and verify the RateLimit-Limit header is set. The
// rateLimit() factory always sets that header on every request it processes
// (even well-within-cap ones), so its presence is a reliable proof that
// authRateLimit is wired into the route. Removing authRateLimit from any route
// removes the header and fails this test.
import { describe, it, expect, vi } from "vitest";
import type { Request, Response, NextFunction } from "express";

// Mocks must be declared before any import that transitively pulls the real
// modules, because Vitest hoists vi.mock() calls before the import block.

vi.mock("../middlewares/rateLimitStore", () => ({
  PostgresRateLimitStore: class {
    hit() {
      return Promise.resolve({ count: 0, resetAt: Date.now() + 60_000 });
    }
  },
}));

vi.mock("@workspace/db", () => ({
  db: {},
  pool: { on() {} },
  rateLimitCountersTable: {},
  usersTable: {},
  userRolesTable: {},
  rolesTable: {},
  passwordResetsTable: {},
}));

vi.mock("@workspace/api-zod", () => ({
  SignUpBody: { safeParse: vi.fn(() => ({ success: false, error: { message: "mocked" } })) },
  SignInBody: { safeParse: vi.fn(() => ({ success: false, error: { message: "mocked" } })) },
  ForgotPasswordBody: { safeParse: vi.fn(() => ({ success: false, error: { message: "mocked" } })) },
  ResetPasswordBody: { safeParse: vi.fn(() => ({ success: false, error: { message: "mocked" } })) },
  ChangePasswordBody: { safeParse: vi.fn(() => ({ success: false, error: { message: "mocked" } })) },
  CheckUsernameAvailableQueryParams: {
    safeParse: vi.fn(() => ({ success: false, error: { message: "mocked" } })),
  },
}));

vi.mock("../lib/users", () => ({
  createUser: vi.fn(),
  findUserByUsername: vi.fn(),
  getUserById: vi.fn(),
  isUsernameAvailable: vi.fn(),
  updateUserPassword: vi.fn(),
}));

vi.mock("../lib/userValidity", () => ({
  invalidateUserSessions: vi.fn(),
}));

vi.mock("../lib/passwordResets", () => ({
  createResetRequest: vi.fn(),
  resetPasswordWithCode: vi.fn(),
}));

vi.mock("../lib/roles", () => ({
  createRoleForNewUser: vi.fn(),
  getStaffMember: vi.fn(),
}));

vi.mock("../lib/auth", () => ({
  SESSION_COOKIE: "session",
  SESSION_COOKIE_MAX_AGE_MS: 86_400_000,
  signToken: vi.fn(() => "tok"),
  verifyPassword: vi.fn(() => false),
}));

vi.mock("../lib/sandbox", () => ({
  sandboxAllowed: vi.fn(() => false),
}));

vi.mock("../middlewares/requireAuth", () => ({
  requireAuth: (_req: Request, _res: Response, next: NextFunction) => next(),
}));

// Dynamic import so the mocks above are definitely active before auth.ts runs.
const { default: authRouter } = await import("./auth");

// Express internal types are not part of the public surface. Model just the
// fields we read for route-stack inspection.
type RouteLayer = {
  handle: (req: Request, res: Response, next: NextFunction) => void;
};
type Route = {
  path: string;
  methods: Record<string, boolean>;
  stack: RouteLayer[];
};
type StackLayer = {
  route?: Route;
};

// Walk the assembled router's layer stack and return the ordered middleware
// handles for the given HTTP method + path, or null if the route is not found.
function handlersFor(
  method: string,
  path: string,
): ((req: Request, res: Response, next: NextFunction) => void)[] | null {
  const stack = (authRouter as unknown as { stack?: StackLayer[] }).stack;
  if (!stack) return null;
  for (const layer of stack) {
    if (layer.route && layer.route.path === path && layer.route.methods[method]) {
      return layer.route.stack.map((l) => l.handle);
    }
  }
  return null;
}

// Drive a synthetic request through the given handler chain in order. Stops
// advancing once a middleware sets a response status (signals it did not call
// next). Returns all headers set during the chain run.
//
// The rateLimit() factory runs its logic in a fire-and-forget async IIFE, so
// we wait a short time for it to settle before inspecting the result.
async function runHandlers(
  handlers: ((req: Request, res: Response, next: NextFunction) => void)[],
): Promise<Record<string, string>> {
  const headers: Record<string, string> = {};
  let responseSent = false;

  const res = {
    setHeader(name: string, value: string | number) {
      headers[name] = String(value);
    },
    status(_code: number) {
      responseSent = true;
      return res;
    },
    json() {
      return res;
    },
    cookie() {},
    end() {},
  } as unknown as Response;

  const req = {
    ip: "127.0.0.1",
    log: { info() {}, warn() {}, error() {}, debug() {} },
    cookies: {},
    headers: { "content-type": "application/json" },
    body: {},
    query: {},
  } as unknown as Request;

  let idx = 0;
  function next() {
    if (responseSent) return;
    const handler = handlers[idx++];
    if (handler) handler(req, res, next);
  }
  next();

  // The rateLimit middleware body runs in a fire-and-forget async IIFE; wait
  // long enough for the in-process MemoryRateLimitStore to resolve and for
  // `setHeader` / `next` to be called.
  await new Promise<void>((resolve) => setTimeout(resolve, 30));

  return headers;
}

// The five auth routes that MUST be protected by authRateLimit at all times.
const SENSITIVE_ROUTES: ReadonlyArray<readonly [string, string]> = [
  ["post", "/auth/sign-in"],
  ["post", "/auth/sign-up"],
  ["post", "/auth/forgot-password"],
  ["post", "/auth/reset-password"],
  ["get", "/auth/username-available"],
] as const;

describe("authRateLimit is wired onto every sensitive auth route", () => {
  for (const [method, path] of SENSITIVE_ROUTES) {
    it(
      `${method.toUpperCase()} ${path} — RateLimit-Limit header is set (authRateLimit present)`,
      async () => {
        const handlers = handlersFor(method, path);

        expect(
          handlers,
          `Route ${method.toUpperCase()} ${path} was not found in the auth router stack. ` +
            `It may have been renamed or removed.`,
        ).not.toBeNull();

        expect(
          handlers!.length,
          `Route ${method.toUpperCase()} ${path} has no middleware at all.`,
        ).toBeGreaterThan(0);

        const headers = await runHandlers(handlers!);

        expect(
          headers["RateLimit-Limit"],
          `${method.toUpperCase()} ${path}: RateLimit-Limit header was NOT set. ` +
            `authRateLimit is missing from this route — removing it leaves the endpoint ` +
            `open to brute-force attacks. Re-add authRateLimit as the first middleware ` +
            `argument on this route in routes/auth.ts.`,
        ).toBeDefined();
      },
    );
  }
});
