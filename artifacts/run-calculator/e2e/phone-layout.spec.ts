import { test, expect, type Locator, type Page } from "@playwright/test";
import { Client } from "pg";
import { cleanupTestUsers, uniqueTestId } from "./isolation";

const PHONE_VIEWPORTS = [
  { width: 375, height: 812 },
  { width: 390, height: 844 },
] as const;

// 568x320 is a narrow phone in landscape (and is small enough to expose
// layouts that accidentally depend on portrait height).
const LANDSCAPE_VIEWPORT = { width: 568, height: 320 } as const;

const PRIMARY_TABS = [
  "tab-run",
  "tab-dough",
  "tab-sauce",
  "tab-frontline",
  "tab-packaging",
  "tab-warehouse",
] as const;

function getSignupCode(): string {
  const code = process.env.STAFF_SIGNUP_CODE;
  if (!code) {
    throw new Error(
      "STAFF_SIGNUP_CODE must be configured to run the phone layout suite.",
    );
  }
  return code;
}

function uniqueUsername(): string {
  return uniqueTestId("phonee2e");
}

const testUsernames = new Set<string>();
let cleanupDb: Client | undefined;

test.afterAll(async () => {
  if (!process.env.DATABASE_URL || testUsernames.size === 0) return;
  cleanupDb = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await cleanupDb.connect();
    await cleanupTestUsers(cleanupDb, testUsernames);
  } finally {
    await cleanupDb.end().catch(() => {});
  }
});

function viewportLabel(page: Page): string {
  const viewport = page.viewportSize();
  return viewport ? `${viewport.width}x${viewport.height}` : "unknown viewport";
}

async function assertPhoneLayout(
  page: Page,
  area: string,
  options: { skipModalOverlayCoverage?: boolean } = {},
): Promise<void> {
  const label = `${viewportLabel(page)} ${area}`;
  const failures = await page.evaluate((skipModalOverlayCoverage) => {
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const visible = (element: Element) => {
      const style = window.getComputedStyle(element);
      const rect = (element as HTMLElement).getBoundingClientRect();
      return (
        element.getAttribute("aria-hidden") !== "true" &&
        !element.closest('[aria-hidden="true"]') &&
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        Number.parseFloat(style.opacity || "1") > 0 &&
        rect.width > 0 &&
        rect.height > 0
      );
    };
    const isInViewport = (rect: DOMRect) =>
      rect.bottom > 0 &&
      rect.right > 0 &&
      rect.top < viewportHeight &&
      rect.left < viewportWidth;
    const isFixedNavigation = (element: Element) =>
      element.matches('[role="tablist"]') &&
      ["fixed", "sticky"].includes(window.getComputedStyle(element).position);
    const isInsideFixedNavigation = (element: Element) =>
      Boolean(element.closest('[role="tablist"]'));
    const isDevBanner = (element: Element) =>
      element.tagName === "OL" &&
      (element.textContent?.includes("Publish your app") ?? false);

    const problems: string[] = [];
    if (document.documentElement.scrollWidth > viewportWidth + 1) {
      problems.push(
        `document scrollWidth ${document.documentElement.scrollWidth}px exceeds viewport ${viewportWidth}px`,
      );
    }
    if ((document.body?.scrollWidth ?? 0) > viewportWidth + 1) {
      problems.push(
        `body scrollWidth ${document.body?.scrollWidth ?? 0}px exceeds viewport ${viewportWidth}px`,
      );
    }

    for (const element of Array.from(
      document.querySelectorAll<HTMLElement>(
        'button, input, select, textarea, [role="button"], [role="tab"], a[href]',
      ),
    )) {
      if (!visible(element)) continue;
      const rect = element.getBoundingClientRect();
      const selector =
        element.getAttribute("data-testid") ||
        element.getAttribute("aria-label") ||
        element.textContent?.trim().replace(/\s+/g, " ").slice(0, 60) ||
        element.tagName.toLowerCase();

      if (rect.left < -1 || rect.right > viewportWidth + 1) {
        problems.push(
          `interactive ${JSON.stringify(selector)} extends outside viewport (${Math.round(rect.left)}..${Math.round(rect.right)}px)`,
        );
      }
      if (
        isInViewport(rect) &&
        !isInsideFixedNavigation(element) &&
        (element.matches("button, input, select, textarea") ||
          element.getAttribute("role") === "button")
      ) {
        const isInlineTextButton =
          element.matches("button") &&
          element.className.includes("text-primary") &&
          !element.className.includes("bg-");
        if (!isInlineTextButton && (rect.height < 16 || rect.width < 16)) {
          problems.push(
            `interactive ${JSON.stringify(selector)} is too small (${Math.round(rect.width)}x${Math.round(rect.height)}px; minimum 16px)`,
          );
        }
      }
    }

    for (const element of Array.from(
      document.querySelectorAll<HTMLElement>("body *"),
    )) {
      if (!visible(element)) continue;
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      if (
        isInViewport(rect) &&
        !isInsideFixedNavigation(element) &&
        rect.width > 16 &&
        rect.height > 8 &&
        style.fontSize
      ) {
        const fontSize = Number.parseFloat(style.fontSize);
        if (
          fontSize < 10 &&
          element.children.length === 0 &&
          (element.textContent?.trim().length ?? 0) > 2
        ) {
          problems.push(
            `visible text ${JSON.stringify(element.textContent?.trim().slice(0, 50))} is ${fontSize}px (minimum 10px)`,
          );
        }
      }
    }

    const fixedElements = Array.from(
      document.querySelectorAll<HTMLElement>("body *"),
    ).filter((element) => {
      if (!visible(element)) return false;
      const position = window.getComputedStyle(element).position;
      return (
        !isDevBanner(element) &&
        element.tagName !== "OL" &&
        (position === "fixed" || position === "sticky")
      );
    });
    for (const fixed of fixedElements) {
      if (skipModalOverlayCoverage) continue;
      if (isFixedNavigation(fixed)) continue;
      const fixedRect = fixed.getBoundingClientRect();
      if (
        fixedRect.width >= viewportWidth - 2 &&
        fixedRect.height >= viewportHeight - 2
      ) {
        continue;
      }
      for (const control of Array.from(
        document.querySelectorAll<HTMLElement>(
          'button, input, select, textarea, [role="button"], [role="tab"], a[href]',
        ),
      )) {
        if (!visible(control) || fixed.contains(control) || fixed === control)
          continue;
        const controlRect = control.getBoundingClientRect();
        const overlaps =
          fixedRect.left < controlRect.right &&
          fixedRect.right > controlRect.left &&
          fixedRect.top < controlRect.bottom &&
          fixedRect.bottom > controlRect.top;
        if (overlaps && isInViewport(controlRect)) {
          problems.push(
            `fixed ${fixed.getAttribute("data-testid") || fixed.tagName.toLowerCase()} covers interactive ${control.getAttribute("data-testid") || control.textContent?.trim().slice(0, 40) || control.tagName.toLowerCase()}`,
          );
        }
      }
    }

    return problems;
  }, options.skipModalOverlayCoverage ?? false);

  expect(failures, `Phone layout failures in ${label}`).toEqual([]);
}

async function assertFocusedFieldIsKeyboardSafe(
  page: Page,
  field: Locator,
  name: string,
): Promise<void> {
  await field.focus();
  await expect(field, `${name} should retain focus`).toBeFocused();

  const geometry = await field.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const viewport = window.visualViewport;
    const viewportHeight = viewport?.height ?? window.innerHeight;
    const viewportWidth = viewport?.width ?? window.innerWidth;
    return {
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      viewportHeight,
      viewportWidth,
      scrollHeight: document.documentElement.scrollHeight,
      scrollWidth: document.documentElement.scrollWidth,
    };
  });

  expect(
    geometry.left,
    `${name} left edge should remain inside the visual viewport`,
  ).toBeGreaterThanOrEqual(-1);
  expect(
    geometry.right,
    `${name} right edge should remain inside the visual viewport`,
  ).toBeLessThanOrEqual(geometry.viewportWidth + 1);
  expect(
    geometry.top,
    `${name} should not be hidden above the visual viewport`,
  ).toBeGreaterThanOrEqual(-1);
  expect(
    geometry.bottom,
    `${name} bottom edge should remain above the virtual keyboard`,
  ).toBeLessThanOrEqual(geometry.viewportHeight + 1);
  expect(
    geometry.scrollWidth,
    `${name} must not introduce horizontal overflow`,
  ).toBeLessThanOrEqual(geometry.viewportWidth + 1);
  expect(
    geometry.scrollHeight,
    `${name} should remain scrollable rather than widening the page`,
  ).toBeGreaterThanOrEqual(geometry.viewportHeight);
}

async function assertMobileViewportAndSafeArea(
  page: Page,
  field: Locator,
  name: string,
): Promise<{
  viewportHeight: number;
  viewportWidth: number;
  safeArea: Record<"top" | "right" | "bottom" | "left", number>;
  safeAreaRaw: Record<"top" | "right" | "bottom" | "left", string>;
  authScreenPadding: Record<"top" | "right" | "bottom" | "left", number>;
}> {
  await field.focus();
  await expect(field, `${name} should retain focus`).toBeFocused();

  const geometry = await page.evaluate(() => {
    const viewport = window.visualViewport;
    if (!viewport) return null;

    const safeAreaProbe = document.createElement("div");
    safeAreaProbe.style.cssText =
      "position:fixed;visibility:hidden;pointer-events:none;" +
      "padding-top:env(safe-area-inset-top);" +
      "padding-right:env(safe-area-inset-right);" +
      "padding-bottom:env(safe-area-inset-bottom);" +
      "padding-left:env(safe-area-inset-left);";
    document.body.append(safeAreaProbe);
    const safeAreaStyle = window.getComputedStyle(safeAreaProbe);
    const cssPixels = (value: string) => Number.parseFloat(value) || 0;
    const authScreen = document.querySelector<HTMLElement>(
      '[data-testid="auth-screen"]',
    );
    const authScreenStyle = authScreen
      ? window.getComputedStyle(authScreen)
      : null;
    safeAreaProbe.remove();

    return {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      viewportWidth: viewport.width,
      viewportHeight: viewport.height,
      viewportScale: viewport.scale,
      field: document.activeElement?.getBoundingClientRect().toJSON(),
      safeArea: {
        top: cssPixels(safeAreaStyle.paddingTop),
        right: cssPixels(safeAreaStyle.paddingRight),
        bottom: cssPixels(safeAreaStyle.paddingBottom),
        left: cssPixels(safeAreaStyle.paddingLeft),
      },
      safeAreaRaw: {
        top: safeAreaStyle.paddingTop,
        right: safeAreaStyle.paddingRight,
        bottom: safeAreaStyle.paddingBottom,
        left: safeAreaStyle.paddingLeft,
      },
      authScreenPadding: authScreenStyle
        ? {
            top: cssPixels(authScreenStyle.paddingTop),
            right: cssPixels(authScreenStyle.paddingRight),
            bottom: cssPixels(authScreenStyle.paddingBottom),
            left: cssPixels(authScreenStyle.paddingLeft),
          }
        : null,
      viewportMeta: document
        .querySelector('meta[name="viewport"]')
        ?.getAttribute("content"),
    };
  });

  expect(geometry, "mobile browsers should expose visualViewport").not.toBeNull();
  if (!geometry) {
    throw new Error("Mobile browser did not expose visualViewport.");
  }

  expect(
    geometry.viewportWidth,
    "visualViewport width should stay within the mobile layout viewport",
  ).toBeLessThanOrEqual(geometry.innerWidth + 1);
  expect(
    geometry.viewportHeight,
    "visualViewport height should stay within the mobile layout viewport",
  ).toBeLessThanOrEqual(geometry.innerHeight + 1);
  expect(
    geometry.viewportScale,
    "the browser should begin at the page's configured scale",
  ).toBeGreaterThan(0);
  expect(
    geometry.viewportMeta,
    "the page must opt into display under a device safe area",
  ).toContain("viewport-fit=cover");
  expect(
    geometry.authScreenPadding,
    "the sign-in screen should reserve its safe-area padding",
  ).not.toBeNull();
  if (!geometry.authScreenPadding) {
    throw new Error("Sign-in screen was not found for safe-area verification.");
  }

  for (const edge of ["top", "right", "bottom", "left"] as const) {
    expect(
      geometry.authScreenPadding[edge],
      `sign-in ${edge} padding should include the ${edge} safe area`,
    ).toBeGreaterThanOrEqual(Math.max(24, geometry.safeArea[edge]) - 1);
  }

  const rect = geometry.field;
  expect(rect, `${name} should be the active element`).toBeTruthy();
  if (!rect) {
    throw new Error(`${name} was not the active element.`);
  }
  expect(rect.left, `${name} should fit the mobile visual viewport`).toBeGreaterThanOrEqual(-1);
  expect(rect.right, `${name} should fit the mobile visual viewport`).toBeLessThanOrEqual(
    geometry.viewportWidth + 1,
  );
  expect(rect.bottom, `${name} should remain above the visual viewport bottom`).toBeLessThanOrEqual(
    geometry.viewportHeight + 1,
  );

  return {
    viewportHeight: geometry.viewportHeight,
    viewportWidth: geometry.viewportWidth,
    safeArea: geometry.safeArea,
    safeAreaRaw: geometry.safeAreaRaw,
    authScreenPadding: geometry.authScreenPadding,
  };
}

async function dismissOnboardingIfPresent(page: Page): Promise<void> {
  const getStarted = page.getByRole("button", { name: /^get.?started$/i });
  if (await getStarted.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await getStarted.click();
    await page.waitForTimeout(250);
  }
}

async function signInToSandbox(page: Page): Promise<void> {
  await page.goto("/sign-up", { waitUntil: "domcontentloaded" });
  await page
    .locator("#username")
    .waitFor({ state: "visible", timeout: 20_000 });
  const password = "PhoneLayoutTest123!";
  const username = uniqueUsername();
  testUsernames.add(username);
  await page.locator("#username").fill(username);
  await page.locator("#password").fill(password);
  await page.locator("#confirm").fill(password);
  await page.locator("#accessCode").fill(getSignupCode());
  await page.getByRole("button", { name: /create.?account|sign.?up/i }).click();
  await page
    .locator('[data-testid="tab-run"]')
    .waitFor({ state: "attached", timeout: 25_000 });
  await dismissOnboardingIfPresent(page);
}

async function visible(locator: Locator): Promise<boolean> {
  return locator.isVisible({ timeout: 5_000 }).catch(() => false);
}

async function assertKeyboardReachable(
  page: Page,
  area: string,
  tabCount = 10,
): Promise<void> {
  const controls = page.locator(
    'button:visible, input:visible, select:visible, textarea:visible, [role="button"]:visible, [role="tab"]:visible',
  );
  await expect(controls.first(), `${area} should expose a keyboard-reachable control`).toBeVisible();
  await controls.first().focus();

  for (let i = 0; i < tabCount; i += 1) {
    await page.keyboard.press("Tab");
    const focusGeometry = await page.evaluate(() => {
      const element = document.activeElement;
      if (!(element instanceof HTMLElement)) return null;
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return {
        tag: element.tagName,
        disabled: "disabled" in element && Boolean((element as HTMLButtonElement).disabled),
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        outline: style.outlineStyle,
      };
    });
    expect(focusGeometry, `${area} should retain a visible focused element`).not.toBeNull();
    expect(focusGeometry?.disabled, `${area} should not focus disabled controls`).toBeFalsy();
    expect(focusGeometry?.left, `${area} focus should remain on-screen`).toBeGreaterThanOrEqual(-1);
    expect(focusGeometry?.right, `${area} focus should remain on-screen`).toBeLessThanOrEqual((page.viewportSize()?.width ?? 0) + 1);
    expect(focusGeometry?.top, `${area} focus should remain on-screen`).toBeGreaterThanOrEqual(-1);
    expect(focusGeometry?.bottom, `${area} focus should remain on-screen`).toBeLessThanOrEqual((page.viewportSize()?.height ?? 0) + 1);
  }
}

async function closeImportReview(page: Page): Promise<void> {
  const title = page.locator("span").filter({ hasText: /^Import Excel$/ });
  await expect(title).toBeVisible();
  await title.locator("xpath=../..").getByRole("button").first().click();
  await expect(title).toBeHidden();
}

test.describe("phone layout smoke", () => {
  test.describe.configure({ mode: "serial" });

  for (const viewport of PHONE_VIEWPORTS) {
    test(`sign-in is usable without overflow at ${viewport.width}x${viewport.height}`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await page.goto("/sign-in", { waitUntil: "domcontentloaded" });
      await page
        .locator("#username")
        .waitFor({ state: "visible", timeout: 20_000 });

      await assertPhoneLayout(page, "sign-in");
      await expect(
        page.getByRole("heading", { name: /sign in to run calculator/i }),
      ).toBeVisible();
      await expect(page.locator("#username")).toBeEditable();
      await expect(page.locator("#password")).toBeEditable();
      await expect(
        page.getByRole("button", { name: /^sign in$/i }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: /log in as test user/i }),
      ).toBeVisible();
    });
  }

  for (const viewport of PHONE_VIEWPORTS) {
    test(`authenticated calculator stays usable at ${viewport.width}x${viewport.height}`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await signInToSandbox(page);

      await assertPhoneLayout(page, "main calculator");
      for (const tab of PRIMARY_TABS) {
        const tabLocator = page.locator(`[data-testid="${tab}"]`);
        await expect(
          tabLocator,
          `${viewport.width}x${viewport.height} ${tab}`,
        ).toBeVisible();
        await expect(tabLocator).toBeEnabled();
      }

      await page.locator('[data-testid="tab-run"]').click();
      await expect(
        page.locator('[data-testid="button-start-run"]'),
      ).toBeVisible();
      await assertPhoneLayout(page, "run controls");

      await page.locator('[data-testid="tab-warehouse"]').click();
      await expect(
        page.locator('[data-testid="tab-warehouse"]'),
      ).toHaveAttribute("data-state", "active");
      await assertPhoneLayout(page, "long-content warehouse surface");

      const moreButton = page.getByRole("button", { name: "More" });
      await expect(moreButton).toBeVisible();
      await moreButton.click();
      await page.getByRole("menuitem", { name: "Settings" }).click();
      const manageDialog = page.getByRole("heading", {
        name: "Manage Lists & Settings",
      });
      await expect(manageDialog).toBeVisible();
      await assertPhoneLayout(page, "setup/manage surface");
      await assertKeyboardReachable(page, "setup/manage surface", 12);

      // Exercise the manager's setup editor navigation without saving anything.
      // These tabs are present for the first signed-up manager and expose the
      // same compact scroll container used by the longer manager workflows.
      const setupProfilesTab = page.getByRole("button", { name: "Setup Profiles", exact: true });
      if (await visible(setupProfilesTab)) {
        await setupProfilesTab.click();
        await assertPhoneLayout(page, "setup profiles editor");
        await assertKeyboardReachable(page, "setup profiles editor", 8);
      }

      await page.getByRole("button", { name: "Tools", exact: true }).click();
      const importTab = page.getByRole("button", { name: "Import", exact: true });
      await expect(importTab).toBeVisible();
      await importTab.click();
      await assertPhoneLayout(page, "manager import controls");
      await assertKeyboardReachable(page, "manager import controls", 8);

      // Use an invalid in-memory workbook to reach the real review/error dialog.
      // No schedule, profile, or master-data write can occur on this path.
      const importInput = page.locator('input[type="file"]').first();
      await importInput.setInputFiles({
        name: "phone-layout-invalid.xlsx",
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        buffer: Buffer.from("not a workbook"),
      });
      await expect(
        page.locator("span").filter({ hasText: /^Import Excel$/ }),
      ).toBeVisible({ timeout: 10_000 });
      await assertPhoneLayout(page, "Excel import review dialog");
      await assertKeyboardReachable(page, "Excel import review dialog", 8);
      await closeImportReview(page);
    });
  }

  test(`manager workflows stay usable in narrow landscape at ${LANDSCAPE_VIEWPORT.width}x${LANDSCAPE_VIEWPORT.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(LANDSCAPE_VIEWPORT);
    await signInToSandbox(page);
    await page.getByTestId("tab-warehouse").click();
    await page.getByRole("button", { name: "More" }).click();
    await page.getByRole("menuitem", { name: "Settings" }).click();
    await expect(
      page.getByRole("heading", { name: "Manage Lists & Settings" }),
    ).toBeVisible();
    await assertPhoneLayout(page, "narrow landscape manager settings", {
      // The compact manager modal intentionally uses a clipped-height fixed
      // backdrop while its scroll container owns the controls. Overflow and
      // focus are still checked below; backdrop hit-testing is covered by the
      // portrait dialog checks above.
      skipModalOverlayCoverage: true,
    });
    await assertKeyboardReachable(page, "narrow landscape manager settings", 12);
  });

  test(`sign-in is usable without overflow in narrow landscape at ${LANDSCAPE_VIEWPORT.width}x${LANDSCAPE_VIEWPORT.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(LANDSCAPE_VIEWPORT);
    await page.goto("/sign-in", { waitUntil: "domcontentloaded" });
    await page
      .locator("#username")
      .waitFor({ state: "visible", timeout: 20_000 });

    await assertPhoneLayout(page, "narrow landscape sign-in");
    await expect(
      page.getByRole("heading", { name: /sign in to run calculator/i }),
    ).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Username" })).toBeEditable();
    await expect(page.getByRole("textbox", { name: "Password" })).toBeEditable();
    await expect(
      page.getByRole("button", { name: /^sign in$/i }),
    ).toBeVisible();
  });

  test("focused sign-in fields stay reachable when the virtual keyboard reduces the viewport", async ({
    page,
  }) => {
    await page.setViewportSize(LANDSCAPE_VIEWPORT);
    await page.goto("/sign-in", { waitUntil: "domcontentloaded" });
    await page
      .locator("#username")
      .waitFor({ state: "visible", timeout: 20_000 });

    await assertFocusedFieldIsKeyboardSafe(
      page,
      page.getByRole("textbox", { name: "Username" }),
      "Username",
    );

    // Desktop Chromium has no on-screen keyboard. Reducing the viewport after
    // the first focus models the visualViewport resize that mobile browsers
    // perform when the keyboard opens.
    await page.setViewportSize({
      width: LANDSCAPE_VIEWPORT.width,
      height: 220,
    });
    await assertPhoneLayout(page, "keyboard-safe username field");

    await assertFocusedFieldIsKeyboardSafe(
      page,
      page.getByRole("textbox", { name: "Password" }),
      "Password",
    );
    await assertPhoneLayout(page, "keyboard-safe password field");
  });

  test("@real-mobile-browser physical Android Chrome keeps sign-in fields above the real keyboard", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "real-mobile-chromium",
      "This optional check requires PLAYWRIGHT_REAL_MOBILE_WS_ENDPOINT.",
    );

    await page.goto("/sign-in", { waitUntil: "domcontentloaded" });
    await page.locator("#username").waitFor({ state: "visible", timeout: 20_000 });

    const preKeyboardViewportHeight = await page.evaluate(
      () => window.visualViewport?.height ?? null,
    );
    expect(
      preKeyboardViewportHeight,
      "the physical mobile browser should expose visualViewport",
    ).not.toBeNull();
    if (!preKeyboardViewportHeight) return;

    const username = page.getByRole("textbox", { name: "Username" });
    await username.focus();
    await expect(username, "Username should retain focus").toBeFocused();
    await page.waitForFunction(
      (initialHeight) =>
        Boolean(
          window.visualViewport &&
            window.visualViewport.height < initialHeight - 80,
        ),
      preKeyboardViewportHeight,
      { timeout: 15_000 },
    );
    const postKeyboardViewportHeight = await page.evaluate(
      () => window.visualViewport?.height ?? null,
    );
    expect(
      postKeyboardViewportHeight,
      "opening the real software keyboard should shrink visualViewport",
    ).toBeLessThan(preKeyboardViewportHeight - 80);

    const usernameGeometry = await assertMobileViewportAndSafeArea(
      page,
      username,
      "Username",
    );
    await assertFocusedFieldIsKeyboardSafe(
      page,
      username,
      "Username",
    );
    await testInfo.attach("real-mobile-keyboard-viewport", {
      body: JSON.stringify({
        preKeyboardViewportHeight,
        postKeyboardViewportHeight,
        usernameGeometry,
      }),
      contentType: "application/json",
    });

    const password = page.getByRole("textbox", { name: "Password" });
    await password.focus();
    await expect(password, "Password should retain focus").toBeFocused();
    await page.waitForFunction(
      (keyboardViewportHeight) =>
        Boolean(
          window.visualViewport &&
            window.visualViewport.height <= keyboardViewportHeight + 1,
        ),
      postKeyboardViewportHeight,
      { timeout: 5_000 },
    );
    await assertMobileViewportAndSafeArea(
      page,
      password,
      "Password",
    );
    await assertFocusedFieldIsKeyboardSafe(
      page,
      password,
      "Password",
    );
    await assertPhoneLayout(page, "real mobile browser sign-in");
  });
});
