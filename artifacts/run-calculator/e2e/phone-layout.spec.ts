import { test, expect, type Locator, type Page } from "@playwright/test";
import { Client } from "pg";
import {
  cleanupTestUsers,
  requireIsolatedTestDatabase,
  uniqueTestId,
} from "./isolation";
import {
  signUpAndHandleOnboarding,
} from "./onboarding";

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

test.beforeEach(async () => {
  requireIsolatedTestDatabase("phone layout smoke beforeEach");
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await db.connect();
    await db.query("DELETE FROM daily_sync WHERE date = $1", [
      new Date().toLocaleDateString("en-CA"),
    ]);
  } finally {
    await db.end().catch(() => {});
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

async function assertOverlayActionHitTargets(
  overlay: Locator,
  area: string,
): Promise<void> {
  const failures = await overlay.evaluate((root) => {
    const isVisible = (element: HTMLElement) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return (
        element.getAttribute("aria-hidden") !== "true" &&
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        Number.parseFloat(style.opacity || "1") > 0 &&
        rect.width > 0 &&
        rect.height > 0
      );
    };
    const describe = (element: HTMLElement) =>
      element.getAttribute("data-testid") ||
      element.getAttribute("aria-label") ||
      element.textContent?.trim().replace(/\s+/g, " ").slice(0, 60) ||
      element.tagName.toLowerCase();
    const controls = Array.from(
      root.querySelectorAll<HTMLElement>(
        'button, input, select, textarea, [role="button"], [role="tab"], a[href]',
      ),
    ).filter(
      (element) =>
        isVisible(element) &&
        !element.hasAttribute("disabled") &&
        element.getAttribute("aria-disabled") !== "true",
    );
    const failures: string[] = [];

    for (const control of controls) {
      control.scrollIntoView({ block: "nearest", inline: "nearest" });
      const rect = control.getBoundingClientRect();
      if (
        rect.bottom <= 0 ||
        rect.right <= 0 ||
        rect.top >= window.innerHeight ||
        rect.left >= window.innerWidth
      ) {
        continue;
      }

      // Probe the lower edge specifically: that is where a fixed bottom
      // navigation can intercept an otherwise reachable action.
      const x = Math.min(
        window.innerWidth - 1,
        Math.max(0, rect.left + rect.width / 2),
      );
      const y = Math.min(
        window.innerHeight - 1,
        Math.max(0, rect.bottom - 2),
      );
      const hit = document.elementFromPoint(x, y);
      const hitElement = hit instanceof HTMLElement ? hit : null;
      const isExternalPreviewBanner =
        hitElement?.textContent?.includes("temporary development preview") ??
        false;
      if (!hit || (!control.contains(hit) && !isExternalPreviewBanner)) {
        failures.push(
          `${JSON.stringify(describe(control))} lower edge is hit by ` +
            `${hitElement ? JSON.stringify(describe(hitElement)) : "nothing"}`,
        );
      }
    }

    return failures;
  });

  expect(failures, `Overlay action hit targets in ${area}`).toEqual([]);
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

async function signInToSandbox(page: Page): Promise<boolean> {
  const password = "PhoneLayoutTest123!";
  const username = uniqueUsername();
  testUsernames.add(username);
  return signUpAndHandleOnboarding(page, username, password, {
    signupCode: getSignupCode(),
  });
}

async function signInToManagerSandbox(page: Page): Promise<void> {
  const password = "PhoneLayoutTest123!";
  const username = uniqueUsername();
  testUsernames.add(username);
  await signUpAndHandleOnboarding(page, username, password, {
    signupCode: getSignupCode(),
  });
  await promoteToManager(username);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
}

async function promoteToManager(username: string): Promise<void> {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await db.connect();
    const user = await db.query("SELECT id FROM users WHERE username = $1", [username]);
    expect(user.rows).toHaveLength(1);
    await db.query(
      `INSERT INTO user_roles (user_id, role) VALUES ($1, 'manager')
       ON CONFLICT (user_id) DO UPDATE SET role = 'manager'`,
      [user.rows[0].id],
    );
    await db.query(
      "UPDATE roles SET capabilities = $1::jsonb WHERE name = 'manager'",
      [JSON.stringify([
        "manage-staff",
        "manage-inventory",
        "edit-production-rules",
        "approve-password-resets",
        "review-incidents",
        "use-ai-tools",
        "manage-factory-settings",
        "manage-profiles",
      ])],
    );
  } finally {
    await db.end().catch(() => {});
  }
}

async function assertReachableDialogAction(
  action: Locator,
  area: string,
): Promise<void> {
  await action.scrollIntoViewIfNeeded();
  await expect(action, `${area} should be visible after scrolling`).toBeVisible();
  const viewport = action.page().viewportSize();
  const geometry = await action.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const x = Math.min(window.innerWidth - 1, Math.max(0, rect.left + rect.width / 2));
    const y = Math.min(window.innerHeight - 1, Math.max(0, rect.bottom - 2));
    const hit = document.elementFromPoint(x, y);
    return {
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      hit: hit ? element.contains(hit) : false,
    };
  });
  expect(geometry.left, `${area} left edge should stay on-screen`).toBeGreaterThanOrEqual(-1);
  expect(geometry.right, `${area} right edge should stay on-screen`).toBeLessThanOrEqual((viewport?.width ?? 0) + 1);
  expect(geometry.top, `${area} top edge should stay on-screen`).toBeGreaterThanOrEqual(-1);
  expect(geometry.bottom, `${area} bottom edge should stay on-screen`).toBeLessThanOrEqual((viewport?.height ?? 0) + 1);
  expect(geometry.hit, `${area} lower edge should receive the action`).toBe(true);
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
    'button, input, select, textarea, [role="button"], [role="tab"]',
  ).filter({ visible: true });
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
      await expect(page.locator('[data-testid="tab-warehouse"]')).toHaveAttribute(
        "aria-label",
        "Warehouse",
      );
      await expect(page.locator('[data-testid="tab-warehouse"]')).toContainText("Warehouse");
      await expect(page.getByTestId("warehouse-page-heading")).toContainText(
        "Warehouse",
      );
      await expect(page.getByTestId("warehouse-attention-header")).toBeVisible();
      const warehouseDetails = page.getByTestId("warehouse-run-details");
      if (await warehouseDetails.count()) {
        await expect(warehouseDetails).not.toHaveAttribute("open", "");
        await warehouseDetails.locator("summary").click();
        await expect(warehouseDetails).toHaveAttribute("open", "");
      }
      await assertPhoneLayout(page, "long-content warehouse surface");

      const moreButton = page.getByRole("button", { name: "More" });
      await expect(moreButton).toBeVisible();
      await moreButton.click();
      await expect(
        page.getByRole("menuitem", { name: "Inventory", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("menuitem", { name: /^(Stock|Whse)$/ }),
      ).toHaveCount(0);
      await page.getByRole("menuitem", { name: "Inventory", exact: true }).click();
      await expect(page.getByTestId("inventory-page-heading")).toContainText(
        "Inventory",
      );
      await expect(
        page.getByText("Review stock, lots, alerts, transfers, and substitutions.", {
          exact: true,
        }),
      ).toBeVisible();
      const newInventoryItem = page.getByRole("button", { name: "New", exact: true });
      if (await newInventoryItem.isVisible()) {
        const newItemBox = await newInventoryItem.boundingBox();
        expect(newItemBox?.height).toBeGreaterThanOrEqual(44);
        await newInventoryItem.click();
        await expect(page.getByRole("button", { name: "From production", exact: true })).toBeVisible();
        await expect(page.getByRole("button", { name: "Custom", exact: true })).toBeVisible();
        await expect(page.getByRole("button", { name: "Add to inventory", exact: true })).toBeVisible();
        await assertPhoneLayout(page, "inventory add-item controls");
      }

      await moreButton.click();
      await page.getByRole("menuitem", { name: "Settings" }).click();
      const manageDialog = page.getByRole("heading", {
        name: "Manage Lists & Settings",
      });
      await expect(manageDialog).toBeVisible();
      await assertOverlayActionHitTargets(
        page.getByRole("dialog", { name: "Manage Lists & Settings" }),
        "Manage Lists & Settings",
      );
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

  for (const viewport of [PHONE_VIEWPORTS[0], LANDSCAPE_VIEWPORT] as const) {
    test(`guided tour lower actions remain reachable at ${viewport.width}x${viewport.height}`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await signInToSandbox(page);

      await page.getByRole("button", { name: "More" }).click();
      await page.getByRole("menuitem", { name: "Guided Tour" }).click();
      const tour = page.locator('[role="dialog"][aria-modal="true"]');
      await expect(tour).toBeVisible();
      await assertOverlayActionHitTargets(
        tour,
        `Guided Tour at ${viewport.width}x${viewport.height}`,
      );

      await tour.getByRole("button", { name: "Next" }).click();
      await assertOverlayActionHitTargets(
        tour,
        `Guided Tour second step at ${viewport.width}x${viewport.height}`,
      );
      await tour.getByRole("button", { name: "Back" }).click();
      await tour.getByRole("button", { name: "Skip" }).click();
      await expect(tour).toBeHidden();
    });
  }

  for (const viewport of [
    { width: 375, height: 812 },
    { width: 568, height: 320 },
    { width: 768, height: 1024 },
    { width: 1280, height: 800 },
  ] as const) {
    test(`Floor Mode remains opaque and closable at ${viewport.width}x${viewport.height}`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await signInToSandbox(page);
      await page.getByTestId("tab-run").click();
      const startRun = page.getByTestId("button-start-run");
      if (await startRun.isVisible()) await startRun.click();

      // New accounts start with Floor Mode disabled, but enabling it here
      // exercises the account-backed setting and the real header launch path.
      await page.getByRole("button", { name: "More" }).click();
      await page.getByRole("menuitem", { name: "Alerts & Floor Mode" }).click();
      const floorSwitch = page.getByTestId("switch-floor-mode");
      await expect(floorSwitch).toBeVisible();
      await expect(floorSwitch).not.toBeChecked();
      await floorSwitch.click();
      await expect(floorSwitch).toBeChecked();
      await page.keyboard.press("Escape");

      await page.getByTitle("Floor mode — big numbers, status color").click();
      const overlay = page.getByTestId("floor-mode-overlay");
      await expect(overlay).toBeVisible();
      // Floor Mode intentionally drifts its contents for monitor burn-in. Freeze
      // that visual-only animation in the geometry/activation smoke so Chromium
      // can observe a stable hit target; the physical-device journey still uses
      // real touch dispatch against the live animation.
      await page.addStyleTag({
        content: ".floor-drift { animation: none !important; transform: none !important; }",
      });
      const exit = page.getByRole("button", {
        name: "Exit Floor Mode and return to calculator",
      });
      await expect(exit).toBeVisible();
      const pause = page.getByTestId("floor-pause-run");
      await expect(pause).toBeVisible();
      await expect(pause).toHaveAccessibleName(/Pause$/);
      await expect(page.getByTestId("floor-cases-minus")).toBeVisible();
      await expect(page.getByTestId("floor-cases-plus")).toBeVisible();
      await expect(page.getByTestId("floor-skid-done")).toBeVisible();
      await expect(page.getByTestId("floor-complete-run")).toBeVisible();
      await assertOverlayActionHitTargets(overlay, "Floor Mode controls");
      for (const testId of [
        "floor-pause-run",
        "floor-cases-minus",
        "floor-cases-plus",
        "floor-skid-done",
        "floor-complete-run",
      ]) {
        const box = await page.getByTestId(testId).boundingBox();
        expect(box?.height, `${testId} height at ${viewport.width}x${viewport.height}`).toBeGreaterThanOrEqual(44);
        expect(box?.width, `${testId} width at ${viewport.width}x${viewport.height}`).toBeGreaterThanOrEqual(44);
      }

      await pause.click();
      await expect(page.getByTestId("floor-resume-run")).toBeVisible();
      await page.getByTestId("floor-resume-run").click();
      await expect(page.getByTestId("floor-pause-run")).toBeVisible();
      await page.getByTestId("floor-complete-run").click();
      const completeDialog = page.getByRole("alertdialog", { name: "Complete this run?" });
      await expect(completeDialog).toBeVisible();
      await assertOverlayActionHitTargets(completeDialog, "Floor Mode completion dialog");
      if (viewport.width === 1280) {
        await completeDialog.getByTestId("floor-confirm-complete-run").click();
        await expect(completeDialog).toBeHidden();
        await expect(overlay.getByText("ENDED", { exact: true })).toBeVisible();
      } else {
        await completeDialog.getByRole("button", { name: "Keep running" }).click();
      }
      await expect(completeDialog).toBeHidden();

      const geometry = await exit.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const viewport = window.visualViewport;
        const probe = document.createElement("div");
        probe.style.cssText =
          "position:fixed;visibility:hidden;pointer-events:none;" +
          "padding-top:env(safe-area-inset-top);" +
          "padding-right:env(safe-area-inset-right);" +
          "padding-bottom:env(safe-area-inset-bottom);" +
          "padding-left:env(safe-area-inset-left);";
        document.body.append(probe);
        const safeArea = getComputedStyle(probe);
        const px = (value: string) => Number.parseFloat(value) || 0;
        probe.remove();
        return {
          rect: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom },
          viewport: {
            width: viewport?.width ?? window.innerWidth,
            height: viewport?.height ?? window.innerHeight,
          },
          safeArea: {
            top: px(safeArea.paddingTop),
            right: px(safeArea.paddingRight),
            bottom: px(safeArea.paddingBottom),
            left: px(safeArea.paddingLeft),
          },
          width: rect.width,
          height: rect.height,
        };
      });
      expect(geometry.width).toBeGreaterThanOrEqual(44);
      expect(geometry.height).toBeGreaterThanOrEqual(44);
      expect(geometry.rect.left).toBeGreaterThanOrEqual(geometry.safeArea.left - 1);
      expect(geometry.rect.right).toBeLessThanOrEqual(
        geometry.viewport.width - geometry.safeArea.right + 1,
      );
      expect(geometry.rect.top).toBeGreaterThanOrEqual(geometry.safeArea.top - 1);
      expect(geometry.rect.bottom).toBeLessThanOrEqual(
        geometry.viewport.height - geometry.safeArea.bottom + 1,
      );

      await assertPhoneLayout(page, "Floor Mode overlay", {
        skipModalOverlayCoverage: true,
      });
      // The old 90-second inactivity path dimmed this layer. Waiting briefly
      // still verifies the overlay remains fully opaque without slowing the
      // suite by the removed interval.
      await page.waitForTimeout(1_000);
      await expect(overlay).toHaveCSS("opacity", "1");

      // Verify pointer/touch-style activation, then keyboard activation and
      // the return to the calculator from both paths.
      // The Replit preview banner is browser chrome outside the app and can
      // intercept a synthetic click at the top edge; installed/full-screen
      // station displays do not render it.
      await page.addStyleTag({
        content:
          "#replit-dev-banner { display: none !important; pointer-events: none !important; }",
      });
      await exit.click();
      await expect(overlay).toBeHidden();
      await page.getByTitle("Floor mode — big numbers, status color").click();
      await expect(overlay).toBeVisible();
      await exit.focus();
      await expect(exit).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(overlay).toBeHidden();
      await expect(page.getByTestId("tab-run")).toBeVisible();
    });
  }

  test("sync details stay fully visible from phone through desktop widths", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signInToSandbox(page);

    const syncStatus = page.locator('button[title^="Sync"]');
    await expect(syncStatus).toBeVisible();

    for (const viewport of [
      { width: 390, height: 844 },
      { width: 768, height: 1024 },
      { width: 1280, height: 900 },
    ]) {
      await page.setViewportSize(viewport);
      await syncStatus.click();

      const popover = syncStatus.locator("xpath=..").locator("div.absolute.top-9");
      await expect(popover).toBeVisible();
      await expect(popover.getByText("Next action", { exact: true })).toBeVisible();
      await expect(
        popover.getByText("Last acknowledgment", { exact: true }),
      ).toBeVisible();
      const retry = popover.getByRole("button", {
        name: /retry latest retained change/i,
      });
      if (await retry.count()) await expect(retry).toBeVisible();

      const geometry = await page.evaluate(() => {
        const panel = document.querySelector("div.absolute.top-9");
        if (!panel) return null;
        const rect = panel.getBoundingClientRect();
        return {
          left: rect.left,
          right: rect.right,
          viewportWidth: window.innerWidth,
          documentScrollWidth: document.documentElement.scrollWidth,
          bodyScrollWidth: document.body.scrollWidth,
        };
      });
      expect(geometry, `${viewport.width}px sync popover should render`).not.toBeNull();
      expect(geometry?.left, `${viewport.width}px panel should stay inside left edge`).toBeGreaterThanOrEqual(-1);
      expect(geometry?.right, `${viewport.width}px panel should stay inside right edge`).toBeLessThanOrEqual(viewport.width + 1);
      expect(geometry?.documentScrollWidth, `${viewport.width}px document should not scroll horizontally`).toBeLessThanOrEqual(viewport.width + 1);
      expect(geometry?.bodyScrollWidth, `${viewport.width}px body should not scroll horizontally`).toBeLessThanOrEqual(viewport.width + 1);

      await syncStatus.click();
    }
  });

  test("failed sync keeps the retained-change retry action visible on phone", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signInToSandbox(page);

    let failedWrites = 0;
    await page.route("**/api/sync/today**", async (route) => {
      if (route.request().method() === "PUT") {
        failedWrites += 1;
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "controlled sync failure" }),
        });
        return;
      }
      await route.continue();
    });

    await page.getByTestId("tab-run").click();
    const editableNumber = page.locator('input[type="number"]').filter({ visible: true }).first();
    await expect(editableNumber).toBeVisible();
    await editableNumber.fill("1");
    const syncStatus = page.locator('button[title^="Sync"]');
    await expect(syncStatus).toBeVisible();
    await syncStatus.click();
    const popover = syncStatus.locator("xpath=..").locator("div.absolute.top-9");
    await expect(popover).toBeVisible();

    await expect.poll(() => failedWrites, { timeout: 20_000 }).toBeGreaterThan(0);
    await expect(popover.getByText("Sync failed", { exact: true })).toBeVisible({
      timeout: 20_000,
    });
    await expect(
      popover.getByText(
        "Your local change is retained on this device. It is not shared until the server acknowledges it.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(popover.getByText("Next action", { exact: true })).toBeVisible();
    const retry = popover.getByRole("button", {
      name: /retry latest retained change/i,
    });
    await expect(retry).toBeVisible();
    const retryGeometry = await retry.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
    });
    expect(retryGeometry.left).toBeGreaterThanOrEqual(0);
    expect(retryGeometry.right).toBeLessThanOrEqual(390);
    expect(retryGeometry.top).toBeGreaterThanOrEqual(0);
    expect(retryGeometry.bottom).toBeLessThanOrEqual(844);
  });

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

  for (const viewport of [PHONE_VIEWPORTS[0], LANDSCAPE_VIEWPORT] as const) {
    test(`operational dialog actions remain reachable at ${viewport.width}x${viewport.height}`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await signInToManagerSandbox(page);
      await page.addStyleTag({
        content:
          "#replit-dev-banner { display: none !important; pointer-events: none !important; }",
      });

      // Start a disposable run through the real Run workflow so Log Line Stop
      // opens from the same action an operator uses on the station screen.
      await page.getByTestId("tab-run").click();
      const casesNeeded = page.getByTestId("input-casesNeeded");
      await expect(casesNeeded).toBeVisible();
      await casesNeeded.fill("1");
      await page.getByTestId("button-start-run").click();
      await expect(page.getByRole("button", { name: /pause run/i })).toBeVisible();

      const logStoppage = page.getByTestId("button-log-stoppage");
      await expect(logStoppage).toBeVisible();
      await logStoppage.click();
      const stopDialog = page.getByRole("dialog", { name: "Log Line Stop" });
      await expect(stopDialog).toBeVisible();
      await assertOverlayActionHitTargets(
        stopDialog,
        `Log Line Stop at ${viewport.width}x${viewport.height}`,
      );
      await assertReachableDialogAction(
        stopDialog.getByRole("button", { name: "Log Without Reason" }),
        `Log Without Reason at ${viewport.width}x${viewport.height}`,
      );

      // The manager-only stop-reason editor is opened from the stop dialog,
      // not by directly mounting a fixture state.
      await stopDialog.getByRole("button", { name: "Edit list" }).click();
      const reasonDialog = page.getByRole("dialog", { name: "Quick Reason List" });
      await expect(reasonDialog).toBeVisible();
      await assertOverlayActionHitTargets(
        reasonDialog,
        `Quick Reason List at ${viewport.width}x${viewport.height}`,
      );
      await assertReachableDialogAction(
        reasonDialog.getByPlaceholder("Add new reason…"),
        `Quick Reason List input at ${viewport.width}x${viewport.height}`,
      );
      await assertReachableDialogAction(
        reasonDialog.getByRole("button", { name: "Add", exact: true }),
        `Quick Reason List Add at ${viewport.width}x${viewport.height}`,
      );
      await assertReachableDialogAction(
        reasonDialog.getByRole("button", { name: "Reset to defaults" }),
        `Quick Reason List reset at ${viewport.width}x${viewport.height}`,
      );
      await reasonDialog.getByRole("button", { name: "Close quick reason list" }).click();
      await expect(reasonDialog).toBeHidden();
      await stopDialog.getByRole("button", { name: "Cancel" }).click();
      await expect(stopDialog).toBeHidden();

      // Password uses the manager's More menu and remains unsubmitted: filling
      // valid-shaped values enables the real lower action without changing the
      // disposable account's credentials.
      await page.getByRole("button", { name: "More", exact: true }).click();
      await page.getByRole("menuitem", { name: "Password", exact: true }).click();
      const passwordDialog = page.getByRole("dialog", { name: "Password" });
      await expect(passwordDialog).toBeVisible();
      await passwordDialog.getByLabel("Current password").fill("not-the-password");
      await passwordDialog.getByRole("textbox", { name: "New password", exact: true }).fill("PhoneLayoutNew123!");
      await passwordDialog.getByRole("textbox", { name: "Confirm new password", exact: true }).fill("PhoneLayoutNew123!");
      await assertReachableDialogAction(
        passwordDialog.getByRole("button", { name: "Update password", exact: true }),
        `Update password at ${viewport.width}x${viewport.height}`,
      );
      await passwordDialog.getByRole("button", { name: "Close password dialog" }).click();
      await expect(passwordDialog).toBeHidden();

      // Schedule is also opened from More. Exercise both the list's lower
      // action and the editor's lower actions without saving a schedule.
      await page.getByRole("button", { name: "More", exact: true }).click();
      await page.getByRole("menuitem", { name: "Schedule", exact: true }).click();
      const scheduleDialog = page.getByRole("dialog");
      await expect(scheduleDialog).toBeVisible();
      await expect(scheduleDialog.getByRole("heading", { name: "Scheduled Days" })).toBeVisible();
      await assertOverlayActionHitTargets(
        scheduleDialog,
        `Scheduled Days list at ${viewport.width}x${viewport.height}`,
      );
      await assertReachableDialogAction(
        scheduleDialog.getByRole("button", { name: "Schedule New Day" }),
        `Schedule New Day at ${viewport.width}x${viewport.height}`,
      );
      await scheduleDialog.getByRole("button", { name: "Schedule New Day" }).click();
      await expect(scheduleDialog.getByRole("heading", { name: /Plan for/ })).toBeVisible();
      await expect(scheduleDialog.getByRole("button", { name: "Save Schedule" })).toBeVisible();
      await assertReachableDialogAction(
        scheduleDialog.getByRole("button", { name: "Cancel", exact: true }),
        `Schedule editor Cancel at ${viewport.width}x${viewport.height}`,
      );
      await scheduleDialog.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(scheduleDialog.getByRole("button", { name: "Schedule New Day" })).toBeVisible();
      await scheduleDialog.getByRole("button", { name: "Close scheduled days" }).click();
      await expect(scheduleDialog).toBeHidden();
    });
  }

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

  test("@real-mobile-browser physical Android Chrome dismisses first-login onboarding before Run interactions", async ({
    page,
  }) => {
    test.skip(
      test.info().project.name !== "real-mobile-chromium",
      "This optional check requires PLAYWRIGHT_REAL_MOBILE_WS_ENDPOINT.",
    );

    const onboardingDismissed = await signInToSandbox(page);
    expect(
      onboardingDismissed,
      "a fresh physical-device account should show and dismiss the Welcome dialog",
    ).toBe(true);

    const welcome = page.getByRole("dialog", {
      name: /welcome to production run calculator/i,
    });
    await expect(welcome).toBeHidden();

    const runTab = page.locator('[data-testid="tab-run"]');
    await expect(runTab).toBeVisible();
    await expect(runTab).toBeEnabled();
    await expect(runTab).toHaveAttribute("data-state", "active");
    await expect(
      page.locator('[data-testid="button-start-run"]'),
    ).toBeVisible();
    await assertPhoneLayout(page, "real mobile onboarding dismissed");
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

  test("@real-mobile-browser physical Android Chrome exercises disposable floor controls", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "real-mobile-chromium",
      "This optional check requires PLAYWRIGHT_REAL_MOBILE_WS_ENDPOINT.",
    );

    const username = uniqueUsername();
    testUsernames.add(username);
    const db = new Client({ connectionString: process.env.DATABASE_URL });
    const itemName = `Physical device intake ${uniqueTestId("inventory")}`;
    const itemKey = `ingredient:${itemName}:cases`;
    let actionItemId: number | null = null;
    const browserErrors: string[] = [];
    page.on("pageerror", (error) => browserErrors.push(error.message));
    page.on("response", (response) => {
      if (response.status() >= 500) {
        browserErrors.push(`${response.status()} ${response.request().method()} ${response.url()}`);
      }
    });

    try {
      await signUpAndHandleOnboarding(page, username, "PhoneLayoutTest123!", {
        signupCode: getSignupCode(),
      });
      await promoteToManager(username);
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });

      // Keep this journey inside the disposable E2E database. The account-backed
      // Floor Mode setting and run lifecycle are real, but no production state is
      // reachable from this project/command.
      await page.getByTestId("tab-run").click();
      const startRun = page.getByTestId("button-start-run");
      if (await startRun.isVisible()) {
        const casesNeeded = page.getByTestId("input-casesNeeded");
        await casesNeeded.fill("4");
        await startRun.tap();
      }
      await expect(page.getByRole("button", { name: /pause run/i })).toBeVisible();

      await page.getByRole("button", { name: "More", exact: true }).tap();
      await page.getByRole("menuitem", { name: "Alerts & Floor Mode" }).tap();
      const floorSwitch = page.getByTestId("switch-floor-mode");
      await expect(floorSwitch).toBeVisible();
      if (!(await floorSwitch.isChecked())) await floorSwitch.tap();
      await page.keyboard.press("Escape");
      await page.getByTitle("Floor mode — big numbers, status color").tap();

      const overlay = page.getByTestId("floor-mode-overlay");
      await expect(overlay).toBeVisible();
      await expect(page.getByTestId("floor-pause-run")).toBeVisible();
      await expect(page.getByTestId("floor-cases-minus")).toBeVisible();
      await expect(page.getByTestId("floor-cases-plus")).toBeVisible();
      await expect(page.getByTestId("floor-skid-done")).toBeVisible();
      await expect(page.getByTestId("floor-complete-run")).toBeVisible();

      // Use tap rather than click so this path exercises the device's touch
      // dispatch. Each control is intentionally used once in a reversible order.
      await page.getByTestId("floor-cases-plus").tap();
      await page.getByTestId("floor-cases-minus").tap();
      await page.getByTestId("floor-skid-done").tap();

      await overlay.getByRole("button", { name: /log stop/i }).tap();
      const stopDialog = page.getByRole("dialog", { name: "Log Line Stop" });
      await expect(stopDialog).toBeVisible();
      await stopDialog.getByRole("button", { name: "Log Without Reason" }).tap();
      await expect(overlay.getByRole("button", { name: "End Stop" })).toBeVisible();
      await overlay.getByRole("button", { name: "End Stop" }).tap();

      await page.getByTestId("floor-pause-run").tap();
      await expect(page.getByTestId("floor-resume-run")).toBeVisible();
      const pauseDecision = page.getByTestId("pause-tunnel-decision");
      if (await pauseDecision.isVisible().catch(() => false)) {
        await pauseDecision.getByRole("button", { name: "Use default" }).tap();
      }
      await page.getByTestId("floor-resume-run").tap();
      await expect(page.getByTestId("floor-pause-run")).toBeVisible();

      await page.getByTestId("floor-complete-run").tap();
      const completeDialog = page.getByRole("alertdialog", { name: "Complete this run?" });
      await expect(completeDialog).toBeVisible();
      await completeDialog.getByTestId("floor-confirm-complete-run").tap();
      await expect(completeDialog).toBeHidden();
      await expect(overlay.getByText("ENDED", { exact: true })).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath("physical-floor-controls-complete.png") });
      await overlay.getByRole("button", {
        name: "Exit Floor Mode and return to calculator",
      }).tap();
      await expect(overlay).toBeHidden();

      // Inventory intake uses a unique item and is committed only to the
      // disposable database. The item is removed in finally below.
      await page.getByRole("button", { name: "More", exact: true }).tap();
      await page.getByRole("menuitem", { name: "Inventory", exact: true }).tap();
      await expect(page.getByTestId("inventory-page-heading")).toContainText("Inventory");
      await page.getByRole("button", { name: "New", exact: true }).tap();
      await page.getByRole("button", { name: "Custom", exact: true }).tap();
      await page.getByLabel("Inventory item name").fill(itemName);
      await page.getByLabel("Inventory unit").fill("cases");
      await page.getByRole("button", { name: "Add to inventory", exact: true }).tap();
      await expect(page.getByText(itemName, { exact: true })).toBeVisible();
      const itemCard = page.getByText(itemName, { exact: true }).locator("xpath=../../..");
      await page.getByRole("button", { name: new RegExp(itemName, "i") }).tap();
      const restockQuantity = page.getByLabel(`Restock quantity for ${itemName}`);
      await expect(restockQuantity).toBeVisible();
      await restockQuantity.fill("2");
      await itemCard.getByRole("button", { name: "Add stock", exact: true }).tap();
      await expect(restockQuantity).toHaveValue("");
      await page.screenshot({ path: testInfo.outputPath("physical-inventory-intake.png") });

      // Seed one manager queue item after the floor/inventory journey, then
      // exercise claim, details, status, and note controls on the same device.
      await db.connect();
      const queue = await db.query(
        `INSERT INTO action_items
          (scope, dedup_key, category, severity, title, description, source_type, source_id, source_path, status, version)
         VALUES ('live', $1, 'sync', 'warning', $2, $3, 'sync', $1, '#sync-diagnostics', 'open', 1)
         RETURNING id`,
        [
          `e2e:physical_floor_queue:${uniqueTestId("queue")}`,
          `Physical device queue ${uniqueTestId("title")}`,
          "Disposable queue fixture for touch validation",
        ],
      );
      actionItemId = queue.rows[0].id as number;

      await page.getByRole("button", { name: "More", exact: true }).tap();
      await page.getByRole("menuitem", { name: "Manager action queue", exact: true }).tap();
      const queuePanel = page.getByTestId("manager-action-queue");
      await expect(queuePanel).toBeVisible();
      const queueTitle = queuePanel.getByText(/Physical device queue /).first();
      await expect(queueTitle).toBeVisible();
      const queueCard = queueTitle.locator("xpath=../../..");
      const queueTitleText = (await queueTitle.textContent())?.trim() ?? "";
      await queueCard.getByRole("button", { name: "Claim", exact: true }).tap();
      await expect(
        queueCard.getByLabel(`Status for ${queueTitleText}`),
      ).toHaveValue("in_progress");
      await queueCard.getByRole("button", { name: "Details", exact: true }).tap();
      await queueCard.getByRole("button", { name: "Add note", exact: true }).tap();
      await queueCard.getByPlaceholder("Resolution or handoff note").fill("Touch trial complete");
      await queueCard.getByRole("button", { name: "Save note", exact: true }).tap();
      await expect(queueCard).toContainText("Touch trial complete");
      await page.screenshot({ path: testInfo.outputPath("physical-manager-queue.png") });

      const deviceEvidence = await page.evaluate(() => ({
        userAgent: navigator.userAgent,
        viewport: {
          innerWidth: window.innerWidth,
          innerHeight: window.innerHeight,
          visualViewportWidth: window.visualViewport?.width ?? null,
          visualViewportHeight: window.visualViewport?.height ?? null,
        },
        devicePixelRatio: window.devicePixelRatio,
        touchPoints: navigator.maxTouchPoints,
      }));
      await testInfo.attach("physical-floor-device-evidence", {
        body: JSON.stringify(deviceEvidence, null, 2),
        contentType: "application/json",
      });
      await testInfo.attach("physical-floor-browser-errors", {
        body: JSON.stringify(browserErrors, null, 2),
        contentType: "application/json",
      });
      expect(browserErrors).toEqual([]);
    } finally {
      await db.end().catch(() => {});
      const cleanup = new Client({ connectionString: process.env.DATABASE_URL });
      await cleanup.connect().catch(() => {});
      if (actionItemId !== null) {
        await cleanup.query("DELETE FROM action_items WHERE id = $1", [actionItemId]).catch(() => {});
      }
      await cleanup.query("DELETE FROM inventory_items WHERE key = $1", [itemKey]).catch(() => {});
      await cleanup.end().catch(() => {});
    }
  });
});
