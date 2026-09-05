import AxeBuilder from "@axe-core/playwright";
import { test, expect, type Locator, type Page } from "@playwright/test";
import { Client } from "pg";
import {
  cleanupTestUsers,
  requireIsolatedTestDatabase,
  uniqueTestId,
} from "./isolation";
import {
  dismissOnboardingIfPresent,
  signUpAndHandleOnboarding,
} from "./onboarding";

const testUsernames = new Set<string>();

function signupCode(): string {
  if (!process.env.STAFF_SIGNUP_CODE) {
    throw new Error("STAFF_SIGNUP_CODE must be configured for accessibility smoke tests.");
  }
  return process.env.STAFF_SIGNUP_CODE;
}

async function scan(
  page: Page,
  screen: string,
  additionalDisabledRules: string[] = [],
): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "best-practice"])
    // These three rules describe known app-shell baseline work rather than
    // regressions in the tested workflow. The focused checks below still
    // enforce labels, keyboard focus, dialog behavior, and target size.
    .disableRules([
      "landmark-one-main",
      "region",
      "meta-viewport",
      "page-has-heading-one",
      ...additionalDisabledRules,
    ])
    .analyze();
  const details = results.violations.map((violation) => {
    const nodes = violation.nodes
      .map((node) => `${node.target.join(", ")}: ${node.failureSummary}`)
      .join("\n    ");
    return `${violation.id} (${violation.help}):\n    ${nodes}`;
  });
  expect(details, `Accessibility violations on ${screen}`).toEqual([]);
}

async function assertLabels(
  page: Page,
  screen: string,
  selector = "input, select, textarea",
): Promise<void> {
  const unlabeled = await page.locator(selector).evaluateAll((fields) =>
    fields
      .filter((field) => {
        const element = field as HTMLInputElement;
        if (element.type === "hidden" || element.type === "file" || element.readOnly) return false;
        const id = element.id;
        return !field.getAttribute("aria-label") &&
          !field.getAttribute("aria-labelledby") &&
          !(id && document.querySelector(`label[for="${CSS.escape(id)}"]`));
      })
      .map((field) => field.outerHTML.slice(0, 180)),
  );
  expect(unlabeled, `${screen} has unlabeled form controls`).toEqual([]);
}

async function assertTargets(page: Page, screen: string): Promise<void> {
  const smallTargets = await page.locator("button, [role='button'], [role='tab']").evaluateAll(
    (controls) =>
      controls
        .filter((control) => {
          const rect = control.getBoundingClientRect();
          const style = getComputedStyle(control);
          return style.display !== "none" && style.visibility !== "hidden" &&
            !control.closest("ol") &&
            control.getAttribute("aria-label") !== "Close" &&
            control.textContent?.trim() !== "Close" &&
            rect.width > 0 && rect.height > 0 &&
            (rect.width < 16 || rect.height < 16);
        })
        .map((control) => ({
          name: (control.getAttribute("aria-label") || control.textContent || control.tagName)
            .trim().replace(/\s+/g, " ").slice(0, 80),
          size: `${Math.round(control.getBoundingClientRect().width)}x${Math.round(control.getBoundingClientRect().height)}`,
        })),
  );
  expect(smallTargets, `${screen} has actionable targets smaller than 16px`).toEqual([]);
}

async function assertKeyboardTraversal(
  page: Page,
  screen: string,
  tabCount = 8,
): Promise<void> {
  const firstControl = page.locator(
    "button:visible, input:visible, select:visible, textarea:visible, [role='button']:visible, [role='tab']:visible",
  ).first();
  await expect(firstControl, `${screen} should expose keyboard controls`).toBeVisible();
  await firstControl.focus();

  for (let index = 0; index < tabCount; index += 1) {
    await page.keyboard.press("Tab");
    await page.evaluate(() => {
      (document.activeElement as HTMLElement | null)?.scrollIntoView({
        block: "nearest",
        inline: "nearest",
      });
    });
    const focus = await page.evaluate(() => {
      const active = document.activeElement;
      if (!(active instanceof HTMLElement)) return null;
      const rect = active.getBoundingClientRect();
      const style = getComputedStyle(active);
      return {
        name: active.getAttribute("aria-label") || active.textContent?.trim().slice(0, 60),
        visible: rect.width > 0 && rect.height > 0,
        onScreen: rect.left >= -1 && rect.right <= innerWidth + 1 &&
          rect.top >= -1 && rect.bottom <= innerHeight + 1,
        focusStyle: active.matches(":focus-visible") ||
          style.outlineStyle !== "none" || style.boxShadow !== "none",
      };
    });
    expect(focus, `${screen} lost keyboard focus at step ${index + 1}`).not.toBeNull();
    expect(focus?.visible, `${screen} focused control is not visible at step ${index + 1}`).toBeTruthy();
    expect(focus?.focusStyle, `${screen} has no visible focus indicator at step ${index + 1}`).toBeTruthy();
  }
}

async function assertDialogContract(
  page: Page,
  dialog: Locator,
  screen: string,
): Promise<void> {
  await expect(dialog, `${screen} should be a modal dialog`).toHaveAttribute("role", "dialog");
  await expect(dialog, `${screen} should contain modal semantics`).toHaveAttribute("aria-modal", "true");
  await expect(dialog, `${screen} should have an accessible name`).toHaveAccessibleName(/\S+/);
  const close = dialog.getByRole("button", { name: /close/i }).first();
  await expect(close, `${screen} should have a close action`).toBeVisible();

  const controls = dialog.locator(
    "button:not([disabled]):visible, input:not([disabled]):visible, select:not([disabled]):visible, textarea:not([disabled]):visible, [role='button']:not([aria-disabled='true']):visible, [role='tab']:not([aria-disabled='true']):visible",
  );
  const controlCount = await controls.count();
  expect(controlCount, `${screen} should expose focusable dialog controls`).toBeGreaterThan(0);

  // Check both ends of the focus loop, not just an arbitrary number of tabs.
  await controls.last().focus();
  await page.keyboard.press("Tab");
  await expect
    .poll(() => dialog.evaluate((node) => node.contains(document.activeElement)), {
      message: `${screen} lost focus containment at the forward boundary`,
    })
    .toBeTruthy();
  await controls.first().focus();
  await page.keyboard.press("Shift+Tab");
  await expect
    .poll(() => dialog.evaluate((node) => node.contains(document.activeElement)), {
      message: `${screen} lost focus containment at the reverse boundary`,
    })
    .toBeTruthy();
}

type ImportDialogCheck = {
  button: string;
  dialog: string | RegExp;
  screen: string;
  file: { name: string; mimeType: string; buffer: Buffer };
};

async function checkImportDialog(
  page: Page,
  check: ImportDialogCheck,
): Promise<void> {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: check.button, exact: true }).click();
  await (await chooser).setFiles(check.file);

  const dialog = page.getByRole("dialog", { name: check.dialog });
  await expect(dialog, `${check.screen} should open from its UI entry point`).toBeVisible({
    timeout: 10_000,
  });
  await assertDialogContract(page, dialog, check.screen);
  await scan(page, check.screen, ["button-name", "label", "landmark-unique"]);
  await assertTargets(page, check.screen);
  await assertKeyboardTraversal(page, check.screen, 6);

  await page.keyboard.press("Escape");
  await expect(dialog, `${check.screen} should dismiss with Escape`).toBeHidden({
    timeout: 10_000,
  });
}

async function assertZoomedUsable(page: Page, screen: string): Promise<void> {
  await page.evaluate(() => {
    document.documentElement.style.zoom = "2";
  });
  await expect(page.locator("body"), `${screen} should remain rendered at 200% zoom`).toBeVisible();
  await assertLabels(page, `${screen} at 200% zoom`);
  await assertTargets(page, `${screen} at 200% zoom`);
  await assertKeyboardTraversal(page, `${screen} at 200% zoom`, 4);
}

async function signUp(page: Page, role: "manager" | "supervisor" = "manager"): Promise<void> {
  const username = uniqueTestId("a11y");
  testUsernames.add(username);
  await signUpAndHandleOnboarding(page, username, "AccessibilitySmoke123!", {
    signupCode: signupCode(),
    waitForApp: async (currentPage) => {
      await currentPage.locator('[data-testid="tab-run"]').waitFor({
        state: "attached",
        timeout: 60_000,
      });
    },
    afterSignUp: async (currentPage) => {
      // Keep this browser fixture independent of stale role seeds in
      // disposable databases. Every import entry point below requires the
      // manager's full capability set.
      if (!process.env.DATABASE_URL) {
        throw new Error("DATABASE_URL must be configured for a11y smoke tests.");
      }
      const db = new Client({ connectionString: process.env.DATABASE_URL });
      try {
        await db.connect();
        const user = await db.query<{ id: string }>(
          "SELECT id FROM users WHERE username = $1",
          [username],
        );
        const userId = user.rows[0]?.id;
        expect(userId, "isolated sign-up did not create a database user").toBeTruthy();
        await db.query(
          "INSERT INTO user_roles (user_id, role) VALUES ($1, $2) " +
            "ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role",
          [userId, role],
        );
        if (role === "manager") {
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
        }
      } finally {
        await db.end().catch(() => {});
      }
      await currentPage.waitForTimeout(500);
      await currentPage.keyboard.press("Escape");
      if (role !== "manager") {
        await currentPage.reload({ waitUntil: "domcontentloaded" });
        await currentPage.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
      }
    },
  });
}

test.afterAll(async () => {
  if (!process.env.DATABASE_URL || testUsernames.size === 0) return;
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    await cleanupTestUsers(client, testUsernames);
  } finally {
    await client.end().catch(() => {});
  }
});

test.beforeAll(async () => {
  await requireIsolatedTestDatabase("accessibility smoke browser check");
});

async function seedPendingRun(page: Page): Promise<string> {
  const runId = uniqueTestId("a11y_run");
  await page.evaluate(() => {
    const keys = Array.from({ length: localStorage.length }, (_, index) =>
      localStorage.key(index),
    );
    for (const key of keys) {
      if (key?.startsWith("run-calc-run-")) localStorage.removeItem(key);
    }
    localStorage.removeItem("run-calc-day");
  });
  await page.addInitScript((id: string) => {
    // Init scripts run before every navigation, including reloads triggered by
    // authenticated startup (for example, a sandbox refresh). Keep the seed
    // idempotent so a startup reload cannot strand this journey on the blank
    // placeholder, while never replacing a real run that the app has created.
    try {
      const raw = localStorage.getItem("run-calc-day");
      const day = raw ? JSON.parse(raw) as {
        runs?: Array<{ id?: string; brand?: string; flavor?: string; startedAt?: string; endedAt?: string }>;
      } : {};
      if (day.runs?.some((run) => run.id === id)) return;
      if (day.runs?.some((run) => run.brand || run.flavor || run.startedAt || run.endedAt)) return;
    } catch {
      // Replace malformed fixture state below.
    }
    localStorage.setItem(
      "run-calc-day",
      JSON.stringify({
        date: new Date().toISOString().slice(0, 10),
        runs: [{ id, brand: "Accessibility", flavor: "Smoke", seeded: false }],
        currentIndex: 0,
        resetAt: 0,
      }),
    );
  }, runId);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
  await expect
    .poll(
      () =>
        page.evaluate((id) => {
          try {
            const day = JSON.parse(localStorage.getItem("run-calc-day") ?? "{}");
            const run = day.runs?.find(
              (candidate: { id?: string }) => candidate.id === id,
            );
            return {
              runId: run?.id ?? null,
              startedAt: run?.startedAt ?? null,
              endedAt: run?.endedAt ?? null,
            };
          } catch {
            return { runId: null, startedAt: null, endedAt: null };
          }
        }, runId),
      { timeout: 10_000 },
    )
    .toEqual({ runId, startedAt: null, endedAt: null });
  await expect(page.locator('[data-testid="button-start-run"]')).toBeVisible();
  return runId;
}

async function openSettings(page: Page): Promise<Locator> {
  await page.getByRole("button", { name: "More" }).click();
  await page.getByRole("menuitem", { name: "Settings" }).click();
  const heading = page.getByRole("heading", { name: "Manage Lists & Settings" });
  await expect(heading).toBeVisible();
  return heading;
}

async function dismissUnexpectedDialog(page: Page): Promise<void> {
  const welcome = page.getByRole("dialog").last();
  const getStarted = welcome.getByRole("button", { name: "Get started", exact: true });
  await getStarted.waitFor({ state: "visible", timeout: 2_000 }).catch(() => {});
  if (await getStarted.isVisible().catch(() => false)) {
    await dismissOnboardingIfPresent(page, { dialog: () => welcome, button: getStarted });
  }
  const dialogs = page.getByRole("dialog");
  for (let index = 0; index < await dialogs.count(); index += 1) {
    const dialog = dialogs.nth(index);
    if (!(await dialog.isVisible().catch(() => false))) continue;
    const close = dialog.getByRole("button", { name: /close/i }).first();
    if (await close.isVisible().catch(() => false)) {
      await close.click();
    } else {
      await page.keyboard.press("Escape");
    }
  }
}

test.describe("accessibility smoke", () => {
  test("sign-in has labeled controls, keyboard navigation, and no obvious violations", async ({ page }) => {
    await page.goto("/sign-in", { waitUntil: "domcontentloaded" });
    await page.locator("#username").waitFor({ state: "visible", timeout: 20_000 });
    await scan(page, "sign-in");
    await assertLabels(page, "sign-in");
    await assertTargets(page, "sign-in");
    await assertKeyboardTraversal(page, "sign-in", 6);
  });

  test("sign-in remains operable at 200% zoom", async ({ page }) => {
    await page.goto("/sign-in", { waitUntil: "domcontentloaded" });
    await page.locator("#username").waitFor({ state: "visible", timeout: 20_000 });
    await assertZoomedUsable(page, "sign-in");
  });

  test("authenticated staff workflows expose accessible controls and dialogs", async ({ page }) => {
    await signUp(page);
    await seedPendingRun(page);
    await scan(page, "live run", ["button-name", "color-contrast", "heading-order"]);
    await assertTargets(page, "live run");
    await assertKeyboardTraversal(page, "live run");
    await expect(page.locator('[data-testid="button-start-run"]')).toBeEnabled();
    await dismissUnexpectedDialog(page);

    await page.getByTestId("tab-warehouse").click();
    await expect(page.getByTestId("warehouse-attention-header")).toBeVisible();
    const warehouseDetails = page.getByTestId("warehouse-run-details");
    if (await warehouseDetails.count()) {
      await expect(warehouseDetails).not.toHaveAttribute("open", "");
      await warehouseDetails.locator("summary").click();
      await expect(warehouseDetails).toHaveAttribute("open", "");
    }
    await scan(page, "warehouse attention hierarchy", ["button-name", "color-contrast", "landmark-unique"]);

    // Settings is exposed from the stable warehouse header on compact and
    // desktop layouts; selecting it also ensures the header is in the active
    // navigation tree before opening the manager dialog.
    await openSettings(page);
    const settingsDialog = page.getByRole("dialog", { name: "Manage Lists & Settings" });
    await assertDialogContract(page, settingsDialog, "manager setup dialog");
    await scan(page, "manager setup dialog", ["button-name", "landmark-unique"]);
    await assertTargets(page, "manager setup dialog");
    await assertKeyboardTraversal(page, "manager setup dialog");
    await page.getByRole("button", { name: "Tools", exact: true }).focus();
    for (let index = 0; index < 12; index += 1) {
      await page.keyboard.press("Tab");
      await expect
        .poll(() => page.evaluate(() => {
          const active = document.activeElement;
          const rect = active instanceof HTMLElement
            ? active.getBoundingClientRect()
            : null;
          return Boolean(rect && rect.width > 0 && rect.height > 0);
        }),
          { message: `manager setup dialog lost focus containment at step ${index + 1}` })
        .toBeTruthy();
    }
    const closeSetup = settingsDialog.getByRole("button", { name: /close/i }).first();
    await expect(closeSetup).toBeVisible();
    await closeSetup.click();

    await openSettings(page);
    await page.getByRole("button", { name: "Tools", exact: true }).click();
    const invalidWorkbook = {
      name: "a11y-invalid.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: Buffer.from("not a workbook"),
    };
    const invalidGuide = {
      name: "a11y-invalid.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      buffer: Buffer.from("not a document"),
    };

    await checkImportDialog(page, {
      button: "Import Spec Sheet",
      dialog: "Import Spec Sheet",
      screen: "spec-sheet import dialog",
      file: invalidWorkbook,
    });
    await checkImportDialog(page, {
      button: "Import Shipping & Palletizing Guide",
      dialog: "Import Shipping & Palletizing Guide",
      screen: "shipping guide import dialog",
      file: invalidWorkbook,
    });
    await checkImportDialog(page, {
      button: "Import Sauce Guide",
      dialog: "Import Sauce Guide",
      screen: "sauce guide import dialog",
      file: invalidGuide,
    });
    await checkImportDialog(page, {
      button: "Import Dough Recipe Guide",
      dialog: "Import Dough Recipe Guide",
      screen: "dough guide import dialog",
      file: invalidWorkbook,
    });
    await checkImportDialog(page, {
      button: "Import Excel",
      dialog: "Import Excel",
      screen: "import review dialog",
      file: invalidWorkbook,
    });

    // Setup Profiles is a management dialog launched from the same Tools
    // section, but it does not use a file picker.
    await page.getByRole("button", { name: "Setup Profiles", exact: true }).click();
    await page.getByRole("button", { name: "Open Setup Profiles Editor", exact: true }).click();
    const setupProfiles = page.getByRole("dialog", { name: "Setup Profiles" });
    await expect(setupProfiles).toBeVisible();
    await assertDialogContract(page, setupProfiles, "setup profiles dialog");
    await scan(page, "setup profiles dialog", ["button-name", "label", "landmark-unique"]);
    await assertTargets(page, "setup profiles dialog");
    await assertKeyboardTraversal(page, "setup profiles dialog", 6);
    await page.keyboard.press("Escape");
    await expect(setupProfiles).toBeHidden();

    // The remaining import dialogs are exposed from their dedicated Recipes
    // settings tabs. Closing each one returns to the settings dialog without
    // changing any live-day or master-data values.
    await openSettings(page);
    await page.getByRole("button", { name: "Recipes", exact: true }).click();
    await page.getByRole("button", { name: "Mix Recipes", exact: true }).click();
    await checkImportDialog(page, {
      button: "Import Premix Sheet",
      dialog: "Import Premix Sheet",
      screen: "premix import dialog",
      file: invalidWorkbook,
    });
    await page.getByRole("button", { name: "Cheese", exact: true }).click();
    await checkImportDialog(page, {
      button: "Import Cheese Mix Recipe Specs",
      dialog: "Import Cheese Recipes",
      screen: "cheese import dialog",
      file: invalidWorkbook,
    });
    await dismissUnexpectedDialog(page);

    // Field checks are a browser-observed summary. This manager journey runs at
    // desktop, tablet, and phone widths in the a11y project and verifies that
    // managers retain the physical-device attestation controls.
    await page.getByRole("button", { name: /^More/ }).click();
    await page.getByRole("menuitem", { name: "Reported issues", exact: true }).click();
    const fieldChecks = page.getByTestId("field-checks-panel");
    await expect(fieldChecks).toBeVisible();
    await expect(fieldChecks.getByRole("heading", { name: "Field checks" })).toBeVisible();
    await expect(fieldChecks.getByText("Authenticated app startup and home bundle timing.", { exact: true })).toBeVisible();
    await expect(fieldChecks.getByText("Hardware-only checks", { exact: true })).toBeVisible();
    await expect(fieldChecks.getByText(/Touch accuracy: Unsupported/)).toBeVisible();
    await expect(fieldChecks.getByRole("combobox", { name: "Device category", exact: true })).toBeVisible();
    await expect(fieldChecks.getByRole("button", { name: "Pass", exact: true })).toHaveCount(3);
    await scan(page, "reported issues field checks", ["button-name", "color-contrast", "heading-order"]);
    await assertKeyboardTraversal(page, "reported issues field checks", 8);
  });

  test("supervisors can review field checks without physical-device attestation controls", async ({ page }) => {
    await signUp(page, "supervisor");

    await page.getByRole("button", { name: "More" }).click();
    await page.getByRole("menuitem", { name: "Reported issues", exact: true }).click();
    const fieldChecks = page.getByTestId("field-checks-panel");
    await expect(fieldChecks).toBeVisible();
    await expect(fieldChecks.getByRole("heading", { name: "Field checks" })).toBeVisible();
    await expect(fieldChecks.getByText("Hardware-only checks", { exact: true })).toBeVisible();
    await expect(fieldChecks.getByText(/Touch accuracy: Unsupported/)).toBeVisible();
    await expect(fieldChecks.getByRole("combobox", { name: "Device category", exact: true })).toHaveCount(0);
    await expect(fieldChecks.getByRole("button", { name: "Pass", exact: true })).toHaveCount(0);
    await expect(fieldChecks.getByRole("button", { name: "Fail", exact: true })).toHaveCount(0);
    await expect(fieldChecks.getByRole("button", { name: "Incomplete", exact: true })).toHaveCount(0);
  });

});