import { expect, test } from "@playwright/test";
import { createHash, X509Certificate } from "node:crypto";
import { connect as connectTls } from "node:tls";
import { Client } from "pg";
import { CONTENT_SECURITY_POLICY } from "../../api-server/src/middlewares/httpSecurity";
import {
  cleanupTestUsers,
  requireIsolatedTestDatabase,
  uniqueTestId,
} from "./isolation";
import { dismissOnboardingIfPresent, signUpAndHandleOnboarding } from "./onboarding";

const PASSWORD = "TestPass123!";
const SIGNUP_CODE = process.env.STAFF_SIGNUP_CODE ?? "";
const testUsernames = new Set<string>();

function getServedCertificatePin(host: string, port: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connectTls({
      host,
      port,
      servername: "localhost",
      rejectUnauthorized: false,
    });
    socket.once("secureConnect", () => {
      const certificate = socket.getPeerCertificate();
      if (!certificate.raw) {
        socket.destroy();
        reject(new Error("The disposable CSP server did not present a certificate."));
        return;
      }
      const publicKeyDer = new X509Certificate(certificate.raw).publicKey.export({
        type: "spki",
        format: "der",
      });
      socket.end();
      resolve(createHash("sha256").update(publicKeyDer).digest("base64"));
    });
    socket.once("error", reject);
  });
}

declare global {
  interface Window {
    __cspBrowserViolations?: Array<{
      blockedURI: string;
      violatedDirective: string;
      disposition: string;
      sourceFile: string;
      lineNumber: number;
      columnNumber: number;
    }>;
  }
}

test.beforeAll(() => {
  requireIsolatedTestDatabase("production CSP browser test");
  if (!SIGNUP_CODE) {
    throw new Error("STAFF_SIGNUP_CODE must be configured for the production CSP browser test.");
  }
});

test.afterAll(async () => {
  if (!process.env.DATABASE_URL || testUsernames.size === 0) return;
  const db = new Client({ connectionString: requireIsolatedTestDatabase("production CSP browser cleanup") });
  try {
    await db.connect();
    await cleanupTestUsers(db, testUsernames);
  } finally {
    await db.end().catch(() => {});
  }
});

test("enforces CSP on production-built Express HTML without blocking required journeys", async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  const testTlsOrigin = new URL(baseURL!);
  expect(process.env.CSP_TLS_EXPECTED_SPKI).toBeTruthy();
  expect(
    await getServedCertificatePin(testTlsOrigin.hostname, Number(testTlsOrigin.port)),
    "the local server certificate must match the browser's exact test-only pin",
  ).toBe(process.env.CSP_TLS_EXPECTED_SPKI);
  const username = uniqueTestId("csp-production");
  testUsernames.add(username);
  const fontResponses = new Map<string, number>();
  const syncRequests: string[] = [];
  const webKitPushFixture = test.info().project.name.endsWith("-webkit");
  let signInHtmlResponse: Awaited<ReturnType<typeof page.waitForResponse>> | undefined;

  await page.addInitScript((stubWebKitPushSubscription: boolean) => {
    window.__cspBrowserViolations = [];
    window.addEventListener("securitypolicyviolation", (event) => {
      window.__cspBrowserViolations?.push({
        blockedURI: event.blockedURI,
        violatedDirective: event.violatedDirective,
        disposition: event.disposition,
        sourceFile: event.sourceFile,
        lineNumber: event.lineNumber,
        columnNumber: event.columnNumber,
      });
    });
    if (stubWebKitPushSubscription && typeof window.PushManager === "function") {
      Object.defineProperty(window.PushManager.prototype, "getSubscription", {
        configurable: true,
        writable: true,
        value: async () => null,
      });
      Object.assign(window, { __cspWebPushFixture: "webkit-empty-subscription" });
    }
  }, webKitPushFixture);
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
      fontResponses.set(url.hostname, response.status());
    }
    if (url.pathname === "/sign-in" || url.pathname === "/") {
      signInHtmlResponse = response;
    }
  });
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === "/api/sync/events") syncRequests.push(request.url());
  });
  await page.goto("/sign-in", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
  if (webKitPushFixture) {
    expect(
      await page.evaluate(() =>
        (window as Window & { __cspWebPushFixture?: string }).__cspWebPushFixture,
      ),
    ).toBe("webkit-empty-subscription");
    test.info().annotations.push({
      type: "browser-capability",
      description: "WebKit getSubscription is stubbed to an empty local subscription; native push delivery is not verified.",
    });
  }
  expect(signInHtmlResponse, "production Express should serve the built app shell").toBeTruthy();
  const htmlHeaders = await signInHtmlResponse!.allHeaders();
  const policy = htmlHeaders["content-security-policy"];
  expect(policy).toBe(CONTENT_SECURITY_POLICY);
  expect(policy).toContain("frame-ancestors 'none'");
  expect(policy).not.toMatch(/(?:^|[\s;])\*(?=[\s;]|$)/);
  expect(policy).not.toMatch(/(?:^|\s)https:(?:\s|;|$)/);
  expect(
    await page.evaluate(
      () =>
        (window as Window & {
          __zod_globalConfig?: { jitless?: boolean };
        }).__zod_globalConfig?.jitless,
    ),
  ).toBe(true);

  await page.evaluate(() => document.fonts.load("16px Inter"));
  await expect.poll(() => fontResponses.get("fonts.googleapis.com")).toBe(200);
  await expect.poll(() => fontResponses.get("fonts.gstatic.com")).toBe(200);
  expect(await page.evaluate(() => document.fonts.check("16px Inter"))).toBe(true);

  await signUpAndHandleOnboarding(page, username, PASSWORD, {
    signupCode: SIGNUP_CODE,
    onboarding: { visibilityTimeout: 5_000 },
  });
  await expect(page.locator('[title="Sync connected"]')).toBeVisible();

  const signOutResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/auth/sign-out") &&
      response.request().method() === "POST",
  );
  await page.getByTitle("More").click();
  await page.getByRole("menuitem", { name: "Sign out", exact: true }).click();
  expect((await signOutResponse).status()).toBe(204);
  await page.goto("/sign-in", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
  await page.locator("#username").fill(username);
  await page.locator("#password").fill(PASSWORD);
  syncRequests.length = 0;
  const syncConnected = page.waitForRequest(
    (request) => new URL(request.url()).pathname === "/api/sync/events",
  );
  const signInResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/auth/sign-in") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  expect((await signInResponse).status()).toBe(200);
  const syncRequest = await syncConnected;
  expect(new URL(syncRequest.url()).origin).toBe(origin);
  await page.getByTestId("tab-run").waitFor({ state: "attached" });
  await expect(page.locator('[title="Sync connected"]')).toBeVisible();

  const readServiceWorkerRegistration = () => page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    return {
      scope: registration?.scope ?? null,
      activeScript: registration?.active?.scriptURL ?? null,
      activeState: registration?.active?.state ?? null,
    };
  });
  await expect.poll(readServiceWorkerRegistration, { timeout: 10_000 }).toMatchObject({
    scope: `${origin}/`,
    activeScript: `${origin}/service-worker.js`,
    activeState: "activated",
  });

  const workerResponse = await page.request.get(`${origin}/service-worker.js`);
  expect(workerResponse.status()).toBe(200);
  expect(workerResponse.headers()["content-security-policy"]).toBe(CONTENT_SECURITY_POLICY);

  const pushCapabilities = await page.evaluate(() => {
    const notificationAvailable = typeof window.Notification === "function";
    return {
      secureContext: window.isSecureContext,
      notificationAvailable,
      serviceWorkerAvailable: "serviceWorker" in navigator,
      pushManagerAvailable: typeof window.PushManager === "function",
      permission: notificationAvailable ? window.Notification.permission : null,
    };
  });
  const unavailablePushReasons: string[] = [];
  if (!pushCapabilities.secureContext) unavailablePushReasons.push("not a secure context");
  if (!pushCapabilities.notificationAvailable) unavailablePushReasons.push("Notification API unavailable");
  if (!pushCapabilities.serviceWorkerAvailable) unavailablePushReasons.push("Service Worker API unavailable");
  if (!pushCapabilities.pushManagerAvailable) unavailablePushReasons.push("PushManager API unavailable");
  if (pushCapabilities.permission === "denied") unavailablePushReasons.push("notifications denied");
  const pushSetupAvailable = unavailablePushReasons.length === 0;
  test.info().annotations.push({
    type: "browser-capability",
    description: pushSetupAvailable
      ? "Web Push setup is available; exercising its VAPID response path."
      : `Web Push setup unavailable: ${unavailablePushReasons.join(", ")}.`,
  });

  await page.getByTitle("Cast to other screens").click();
  const qrImages = page.locator('img[alt^="QR for "]');
  await expect(qrImages).toHaveCount(7);
  await expect.poll(async () =>
    qrImages.evaluateAll((images) =>
      images.every((image) => {
        const img = image as HTMLImageElement;
        return img.complete && img.naturalWidth > 0 && new URL(img.currentSrc).hostname === "api.qrserver.com";
      }),
    ),
  ).toBe(true);

  await page.getByRole("button", { name: "Close cast to screens" }).click();
  if (pushSetupAvailable) {
    await page.getByTitle("More").click();
    const alertsMenuItem = page.getByRole("menuitem", {
      name: "Alerts & Floor Mode",
      exact: true,
    });
    await alertsMenuItem.click({ timeout: 5_000 });
    const pushButton = page.getByTestId("button-enable-web-push");
    try {
      await pushButton.waitFor({ state: "visible", timeout: 5_000 });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`Alerts dialog did not expose Web Push setup controls: ${detail}`);
    }
    const vapidResponse = page.waitForResponse(
      (response) => response.url().endsWith("/api/web-push/vapid-public-key"),
      { timeout: 10_000 },
    );
    void vapidResponse.catch(() => undefined);
    const getPushButtonGeometry = () => pushButton.evaluate((button) => {
      const rect = (element: Element | null) => {
        if (!element) return null;
        const box = element.getBoundingClientRect();
        return {
          top: box.top,
          right: box.right,
          bottom: box.bottom,
          left: box.left,
          width: box.width,
          height: box.height,
        };
      };
      const dialog = button.closest<HTMLElement>('[role="dialog"]');
      const buttonBox = button.getBoundingClientRect();
      const centerTarget = document.elementFromPoint(
        buttonBox.left + buttonBox.width / 2,
        buttonBox.top + buttonBox.height / 2,
      );
      return {
        viewport: { width: window.innerWidth, height: window.innerHeight },
        button: rect(button),
        dialog: rect(dialog),
        dialogScroll: dialog
          ? { top: dialog.scrollTop, clientHeight: dialog.clientHeight, scrollHeight: dialog.scrollHeight }
          : null,
        centerTargetIsButton: Boolean(centerTarget && (centerTarget === button || button.contains(centerTarget))),
        centerTargetTag: centerTarget?.tagName ?? null,
        centerTargetRole: centerTarget?.getAttribute("role") ?? null,
      };
    }).catch(() => ({ detached: true as const }));
    const geometryBeforeScroll = await getPushButtonGeometry();
    try {
      await pushButton.scrollIntoViewIfNeeded({ timeout: 5_000 });
      await pushButton.click({ timeout: 5_000 });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Could not activate Web Push setup: ${detail}; geometry=${JSON.stringify({
          beforeScroll: geometryBeforeScroll,
          afterScroll: await getPushButtonGeometry(),
        })}`,
      );
    }
    let vapidResponseResult: Awaited<typeof vapidResponse>;
    try {
      vapidResponseResult = await vapidResponse;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Web Push setup did not request its public key: ${detail}; geometry=${JSON.stringify({
          beforeScroll: geometryBeforeScroll,
          afterScroll: await getPushButtonGeometry(),
        })}`,
      );
    }
    expect(vapidResponseResult.status()).toBe(503);
    await expect(page.getByText(/Web push is not configured/i))
      .toBeVisible({ timeout: 5_000 });
  }

  const violations = await page.evaluate(() => window.__cspBrowserViolations ?? []);
  expect(violations, "no CSP violation should occur during the app flows").toEqual([]);

  const framePage = await page.context().newPage();
  const framePolicyMessages: string[] = [];
  framePage.on("console", (message) => framePolicyMessages.push(message.text()));
  await framePage.setContent(
    `<iframe title="CSP frame probe" src="${origin}/sign-in"></iframe>`,
    { waitUntil: "domcontentloaded" },
  );
  await expect.poll(() =>
    framePolicyMessages.some((message) => /frame-ancestors|Refused to frame/i.test(message)),
  ).toBe(true);
  await framePage.close();
});
