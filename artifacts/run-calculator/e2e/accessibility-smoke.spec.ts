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
const DOCUMENT_SHELL_RULES = ["landmark-one-main", "region"] as const;
const SCREEN_RULES: Record<string, readonly string[]> = {
  "sign-in": [],
  "live run": ["button-name", "color-contrast", "heading-order"],
  "warehouse attention hierarchy": ["button-name", "color-contrast", "landmark-unique"],
  "manager setup dialog": ["button-name", "landmark-unique"],
  "setup profiles dialog": ["button-name", "label", "landmark-unique"],
  "reported issues field checks": ["button-name", "color-contrast", "heading-order"],
};

/*
 * Contrast audit finding log for the operational themes:
 * - Stoppage Pause label (`text-blue-400/70`) failed on `bg-blue-950/20`.
 * - Inactive Pause icon (`text-blue-400/50`) failed on the surrounding card.
 * - Stoppage Manual label (`text-violet-400/70`) failed on the surrounding card.
 * - Inactive Stoppage icon (`text-orange-400/50`) failed on the surrounding card.
 * - Active Stoppage label (`text-orange-400/70`) passed on `bg-orange-950/20`;
 *   keep its existing opacity because that combination is not failing.
 * - Light-theme manual and completed-stop labels use darker violet/orange
 *   foregrounds on the light card surface; the active-stop row uses a light
 *   orange background with the same darker orange foreground.
 * - Surplus Mix count/name/amount labels passed on `bg-sky-950/30`; keep their
 *   existing opacity because those combinations are not failing.
 */
const OPERATIONAL_CONTRAST_FIXTURES = [
  {
    theme: "dark",
    id: "stoppage-pause-label",
    wrapperClass: "bg-blue-950/20",
    textClass: "text-[10px] font-semibold uppercase tracking-wider text-blue-400",
    text: "Pause",
  },
  {
    theme: "dark",
    id: "stoppage-inactive-pause-icon",
    wrapperClass: "bg-card/40",
    textClass: "text-blue-400",
    text: "Pause icon",
  },
  {
    theme: "dark",
    id: "stoppage-manual-label",
    wrapperClass: "bg-card/40",
    textClass: "text-violet-300",
    text: "Manual",
  },
  {
    theme: "dark",
    id: "stoppage-active-label",
    wrapperClass: "bg-orange-950/20",
    textClass: "text-orange-400/70",
    text: "Stop",
  },
  {
    theme: "dark",
    id: "stoppage-inactive-icon",
    wrapperClass: "bg-card/40",
    textClass: "text-orange-400",
    text: "Stop icon",
  },
  {
    theme: "light",
    id: "stoppage-manual-label",
    wrapperClass: "bg-violet-50/70",
    textClass: "text-violet-700",
    text: "Manual",
  },
  {
    theme: "light",
    id: "stoppage-active-label",
    wrapperClass: "bg-orange-100/70",
    textClass: "text-orange-800",
    text: "Stop",
  },
  {
    theme: "light",
    id: "stoppage-completed-label",
    wrapperClass: "bg-orange-50/70",
    textClass: "text-orange-800",
    text: "Stop",
  },
  {
    theme: "light",
    id: "stoppage-inactive-icon",
    wrapperClass: "bg-card/40",
    textClass: "text-orange-800",
    text: "Stop icon",
  },
  {
    theme: "dark",
    id: "surplus-count",
    wrapperClass: "bg-sky-950/30",
    textClass: "text-xs text-sky-400/80",
    text: "(2 mixes)",
  },
  {
    theme: "dark",
    id: "surplus-name",
    wrapperClass: "bg-sky-950/30",
    textClass: "text-sky-200/90",
    text: "Mix name",
  },
  {
    theme: "dark",
    id: "surplus-amount-label",
    wrapperClass: "bg-sky-950/30",
    textClass: "text-[11px] text-sky-300/80",
    text: "lbs on hand",
  },
] as const;

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
  include?: string,
): Promise<void> {
  const documentedRules = new Set([
    ...DOCUMENT_SHELL_RULES,
    ...Object.values(SCREEN_RULES).flat(),
    // Import dialogs share the same narrowly-scoped legacy shell exceptions.
    "button-name",
    "label",
    "landmark-unique",
  ]);
  const undocumentedRules = additionalDisabledRules.filter(
    (rule) => !documentedRules.has(rule),
  );
  expect(
    undocumentedRules,
    `Accessibility scan on ${screen} used an undocumented rule suppression`,
  ).toEqual([]);
  let builder = new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "best-practice"])
    .exclude("#replit-dev-banner")
    .disableRules(additionalDisabledRules);
  if (include) builder = builder.include(include);
  const results = await builder.analyze();
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
    "button, input, select, textarea, [role='button'], [role='tab']",
  ).filter({ visible: true }).first();
  await expect(firstControl, `${screen} should expose keyboard controls`).toBeVisible();
  await firstControl.focus();

  for (let index = 0; index < tabCount; index += 1) {
    await page.keyboard.press("Tab");
    // Chromium may put the document body between the last control in the
    // page and the first control in the next tab cycle. The body is not an
    // actionable control and cannot provide a meaningful focus indicator, so
    // advance past that browser focus sentinel before asserting the contract.
    for (let sentinel = 0; sentinel < 2; sentinel += 1) {
      if (!(await page.evaluate(() => document.activeElement === document.body))) break;
      await page.keyboard.press("Tab");
    }
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
    "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [role='button']:not([aria-disabled='true']), [role='tab']:not([aria-disabled='true'])",
  ).filter({ visible: true });
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

async function signUp(
  page: Page,
  role: "manager" | "supervisor" | "operator" = "manager",
  username = uniqueTestId("a11y"),
): Promise<void> {
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
      await currentPage.addStyleTag({
        content: "#replit-dev-banner { display: none !important; pointer-events: none !important; }",
      });
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
      // Role and capability changes happen after the initial app hydration.
      // Reload every fixture so the browser exercises the role that was just
      // persisted instead of retaining the pre-seed operator snapshot.
      await currentPage.reload({ waitUntil: "domcontentloaded" });
      await currentPage.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
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
  const date = new Date().toISOString().slice(0, 10);
  const now = Date.now();
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await db.connect();
    await db.query(
      "DELETE FROM daily_sync WHERE date = $1 AND scope = 'live'",
      [date],
    );
  } finally {
    await db.end().catch(() => {});
  }
  const stoppages = [
    {
      id: `${runId}-active`,
      reason: "Conveyor check",
      startedAt: now - 60_000,
      type: "stop",
    },
    {
      id: `${runId}-manual`,
      reason: "Manual cleanup",
      startedAt: now - 180_000,
      endedAt: now - 120_000,
      type: "manual",
    },
    {
      id: `${runId}-paused`,
      reason: "Ingredient refill",
      startedAt: now - 360_000,
      type: "pause",
    },
    {
      id: `${runId}-completed`,
      reason: "Safety reset",
      startedAt: now - 600_000,
      endedAt: now - 450_000,
      type: "stop",
    },
  ];
  const payload = {
    dayState: {
      date,
      runs: [{
        id: runId,
        brand: "Accessibility",
        flavor: "Smoke",
        seeded: false,
        stoppages,
      }],
      currentIndex: 0,
      resetAt: 0,
    },
  };
  await page.evaluate(() => {
    const keys = Array.from({ length: localStorage.length }, (_, index) =>
      localStorage.key(index),
    );
    for (const key of keys) {
      if (key?.startsWith("run-calc-run-")) localStorage.removeItem(key);
    }
    localStorage.removeItem("run-calc-day");
  });
  await page.addInitScript((seed: { payload: typeof payload; runId: string }) => {
    // Init scripts run before every navigation, including reloads triggered by
    // authenticated startup (for example, a sandbox refresh). Keep the seed
    // idempotent so a startup reload cannot strand this journey on the blank
    // placeholder, while never replacing a real run that the app has created.
    try {
      const raw = localStorage.getItem("run-calc-day");
      const day = raw ? JSON.parse(raw) as {
        runs?: Array<{ id?: string; brand?: string; flavor?: string; startedAt?: string; endedAt?: string }>;
      } : {};
      if (day.runs?.some((run) => run.id === seed.runId)) return;
      if (day.runs?.some((run) => run.brand || run.flavor || run.startedAt || run.endedAt)) return;
    } catch {
      // Replace malformed fixture state below.
    }
    localStorage.setItem("run-calc-day", JSON.stringify(seed.payload.dayState));
  }, { payload, runId });
  await page.route("**/api/sync/today**", async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: {
        "X-Sync-Canonical-Revision": "1",
        "X-Sync-Server-Time": String(now),
      },
      body: JSON.stringify(payload),
    });
  });
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

async function seedBreakSchedule(): Promise<{
  runIds: [string, string];
  deletedRunId: string;
}> {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL must be configured for break scheduling browser tests.");
  }
  const date = new Date().toISOString().slice(0, 10);
  const runIds: [string, string] = [
    uniqueTestId("break_run_one"),
    uniqueTestId("break_run_two"),
  ];
  const deletedRunId = uniqueTestId("deleted_after_run");
  const now = Date.now();
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await db.connect();
    await db.query("DELETE FROM daily_sync WHERE date = $1 AND scope = 'live'", [date]);
    await db.query(
      `INSERT INTO daily_sync (date, scope, data, updated_at)
       VALUES ($1, 'live', $2::jsonb, NOW())`,
      [
        date,
        JSON.stringify({
          dayState: {
            date,
            runs: [
              { id: runIds[0], brand: "Break E2E One", flavor: "Morning", casesNeeded: 0 },
              { id: runIds[1], brand: "Break E2E Two", flavor: "Afternoon", casesNeeded: 0 },
            ],
            currentIndex: 0,
            resetAt: 0,
            breaks: [
              { slot: 1, enabled: true, mode: "after-run", runId: deletedRunId, durationMin: 30 },
              { slot: 2, enabled: false, mode: "after-run", durationMin: 30 },
              { slot: 3, enabled: false, mode: "after-run", durationMin: 30 },
            ],
          },
          runValues: {
            [runIds[0]]: { casesNeeded: 0, pizzasPerCase: 12, approxLineSpeed: 10 },
            [runIds[1]]: { casesNeeded: 0, pizzasPerCase: 12, approxLineSpeed: 10 },
          },
          runValuesUpdatedAt: { [runIds[0]]: now, [runIds[1]]: now },
        }),
      ],
    );
  } finally {
    await db.end().catch(() => {});
  }
  return { runIds, deletedRunId };
}

async function openSettings(page: Page): Promise<Locator> {
  await page.getByRole("button", { name: "More" }).click();
  await page.getByRole("menuitem", { name: "Settings" }).click();
  const heading = page.getByRole("heading", { name: "Manage Lists & Settings" });
  await expect(heading).toBeVisible();
  return heading;
}

async function dismissUnexpectedDialog(page: Page): Promise<void> {
  // The Replit preview banner is outside the app but can overlap the modal
  // close action in short tablet viewports.
  await page.locator("#replit-dev-banner").evaluateAll((nodes) => {
    for (const node of nodes) node.remove();
  });
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
      await close.click({ force: true });
    } else {
      await page.keyboard.press("Escape");
    }
  }
  // Import/settings flows can close and re-mount a dialog while the loop is
  // walking the Radix portal collection. Finish on the stable public state.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (await page.locator('[role="dialog"]:visible').count() === 0) break;
    await page.keyboard.press("Escape");
    await page.waitForTimeout(100);
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

  test("stoppage and surplus labels pass contrast on operational backgrounds", async ({ page }) => {
    await page.goto("/sign-in", { waitUntil: "domcontentloaded" });
    await page.locator("#username").waitFor({ state: "visible", timeout: 20_000 });
    await page.evaluate((fixtures) => {
      const root = document.createElement("main");
      root.id = "operational-contrast-audit";
      root.innerHTML = fixtures
        .map(
          (fixture) =>
            `<section id="${fixture.theme}-${fixture.id}" data-theme="${fixture.theme}" class="${fixture.wrapperClass}" style="padding: 12px; margin: 4px"><span class="${fixture.textClass}">${fixture.text}</span></section>`,
        )
        .join("");
      document.body.append(root);
    }, OPERATIONAL_CONTRAST_FIXTURES);

    const violations: string[] = [];
    for (const theme of ["dark", "light"] as const) {
      await page.evaluate((activeTheme) => {
        const root = document.querySelector<HTMLElement>("#operational-contrast-audit");
        if (!root) throw new Error("Operational contrast audit fixture was not mounted");
        document.documentElement.classList.toggle("dark", activeTheme === "dark");
        for (const section of root.querySelectorAll<HTMLElement>("[data-theme]")) {
          section.hidden = section.dataset.theme !== activeTheme;
        }
      }, theme);
      const results = await new AxeBuilder({ page })
        .include("#operational-contrast-audit")
        .withRules(["color-contrast"])
        .analyze();
      violations.push(
        ...results.violations.map((violation) => {
          const nodes = violation.nodes
            .map((node) => `${node.target.join(", ")}: ${node.failureSummary}`)
            .join(" | ");
          return `${theme}: ${violation.id}: ${nodes}`;
        }),
      );
    }
    expect(violations, "Operational stoppage and surplus label contrast audit").toEqual([]);
  });

  test("authenticated staff workflows expose accessible controls and dialogs", async ({ page }) => {
    await signUp(page);
    await seedPendingRun(page);
    await page.getByRole("button", { name: "More" }).click();
    await page.getByRole("menuitem", { name: "Stoppages", exact: true }).click();
    const stoppageLog = page.getByTestId("stoppage-log");
    await expect(stoppageLog).toBeVisible();
    await expect(stoppageLog).toContainText("4 events");
    await expect(stoppageLog.getByText("Stop", { exact: true }).first()).toBeVisible();
    await expect(stoppageLog.getByText("Manual", { exact: true })).toBeVisible();
    await expect(stoppageLog.getByText("Pause", { exact: true })).toBeVisible();
    const stoppageContrast = await new AxeBuilder({ page })
      .include('[data-testid="stoppage-log"]')
      .withRules(["color-contrast"])
      .analyze();
    expect(
      stoppageContrast.violations,
      "Rendered stoppage log color contrast audit",
    ).toEqual([]);
    await page.getByTestId("tab-run").click();
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
    await expect(fieldChecks.getByText("Guided hardware confirmations", { exact: true })).toBeVisible();
    await expect(fieldChecks.getByText(/Touch accuracy: Unsupported/)).toBeVisible();
    await expect(fieldChecks.getByRole("combobox", { name: "Device category", exact: true })).toBeVisible();
    expect(
      await fieldChecks.getByRole("button", { name: "Pass", exact: true }).count(),
    ).toBeGreaterThanOrEqual(3);
    await scan(page, "reported issues field checks", ["button-name", "color-contrast", "heading-order"]);
    await assertKeyboardTraversal(page, "reported issues field checks", 8);
  });

  test("schedule calendar is labeled, keyboard operable, and free of obvious violations", async ({
    page,
  }) => {
    await signUp(page);
    await page.getByRole("button", { name: "More" }).click();
    await page.getByRole("menuitem", { name: "Schedule", exact: true }).click();
    const scheduledDaysDialog = page.getByRole("dialog", { name: "Scheduled Days" });
    await expect(scheduledDaysDialog).toBeVisible();
    await scheduledDaysDialog.getByRole("button", { name: "Schedule New Day" }).click();
    const scheduleEditor = page.getByRole("dialog", { name: /Plan for/ });
    await assertDialogContract(page, scheduleEditor, "schedule editor");
    const scheduleDateTrigger = scheduleEditor.getByRole("button", {
      name: "Choose production date",
    });
    await expect(scheduleDateTrigger).toBeVisible();
    await scheduleDateTrigger.focus();
    await page.keyboard.press("Enter");
    const scheduleCalendar = page.locator('[data-slot="calendar"]');
    await expect(scheduleCalendar.getByRole("grid")).toBeVisible();
    await scan(page, "schedule calendar", [], '[data-slot="calendar"]');
    const selectedDay = scheduleCalendar.locator('button[data-selected-single="true"]');
    await expect(selectedDay).toBeVisible();
    await selectedDay.focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Enter");
    await expect(scheduleCalendar).toBeHidden();
    await scheduleEditor.getByRole("button", { name: "Close schedule editor" }).click();
    await expect(scheduleEditor).toBeHidden();
  });

  test("manager break plans persist and operators can view placements without edit controls", async ({
    page,
    browser,
  }) => {
    test.setTimeout(120_000);
    await signUp(page);
    await seedBreakSchedule();
    await page.evaluate(() => {
      for (const key of Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))) {
        if (key?.startsWith("run-calc")) localStorage.removeItem(key);
      }
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });

    await page.getByRole("button", { name: "More" }).click();
    await page.getByRole("menuitem", { name: "Schedule", exact: true }).click();
    const scheduledDaysDialog = page.getByRole("dialog", { name: "Scheduled Days" });
    await expect(scheduledDaysDialog).toBeVisible();
    await scheduledDaysDialog
      .getByTestId("schedule-today-card")
      .getByRole("button", { name: "Edit", exact: true })
      .click();

    const scheduleEditor = page.getByRole("dialog", { name: /Plan for/ });
    const breakEditor = scheduleEditor.getByTestId("schedule-breaks");
    await expect(breakEditor).toContainText("Each planned break is fixed at 30 minutes.");
    await expect(breakEditor.getByText("Break 1", { exact: true })).toBeVisible();
    await expect(breakEditor.getByText("Break 2", { exact: true })).toBeVisible();
    await expect(breakEditor.getByText("Break 3", { exact: true })).toBeVisible();
    await expect(
      breakEditor.getByText("The selected run was deleted or is no longer assigned.", {
        exact: true,
      }),
    ).toBeVisible();

    for (const [slot, time] of [[1, "06:30"], [2, "08:00"], [3, "09:30"]] as const) {
      await breakEditor
        .getByRole("combobox", { name: `Break ${slot} placement` })
        .selectOption("at-time");
      await breakEditor.getByLabel(`Break ${slot} time`).fill(time);
    }
    const preview = breakEditor.getByTestId("schedule-break-preview");
    await expect(preview).toContainText("Break 1");
    await expect(preview).toContainText("Break 2");
    await expect(preview).toContainText("Break 3");
    await scan(page, "break schedule editor", [], '[data-testid="schedule-breaks"]');

    const saveResponse = page.waitForResponse(
      (response) =>
        response.url().includes("/api/sync/today") &&
        response.request().method() === "PUT",
    );
    await scheduleEditor.getByRole("button", { name: "Save Schedule", exact: true }).click();
    expect((await saveResponse).ok()).toBe(true);
    await expect(scheduledDaysDialog.getByTestId("schedule-today-card")).toBeVisible();

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
    await page.getByRole("button", { name: "More" }).click();
    await page.getByRole("menuitem", { name: "Schedule", exact: true }).click();
    await page
      .getByRole("dialog", { name: "Scheduled Days" })
      .getByTestId("schedule-today-card")
      .getByRole("button", { name: "Edit", exact: true })
      .click();
    const reloadedEditor = page.getByRole("dialog", { name: /Plan for/ });
    const reloadedBreakEditor = reloadedEditor.getByTestId("schedule-breaks");
    for (const [slot, time] of [[1, "06:30"], [2, "08:00"], [3, "09:30"]] as const) {
      await expect(
        reloadedBreakEditor.getByRole("combobox", { name: `Break ${slot} placement` }),
      ).toHaveValue("at-time");
      await expect(reloadedBreakEditor.getByLabel(`Break ${slot} time`)).toHaveValue(time);
    }
    await expect(reloadedBreakEditor.getByTestId("schedule-break-preview")).toContainText("Break 3");
    await page.locator("#replit-dev-banner").evaluateAll((nodes) => {
      for (const node of nodes) node.remove();
    });
    await reloadedEditor
      .getByRole("button", { name: "Close schedule editor" })
      .click({ force: true });
    await expect(reloadedEditor).toBeHidden();

    await page.getByRole("button", { name: "More" }).click();
    await page.getByRole("menuitem", { name: "Summary", exact: true }).click();
    const managerTimeline = page.getByTestId("day-timeline");
    await expect(managerTimeline).toBeVisible();
    await expect(managerTimeline).toContainText("Break 1 · 30 min");
    await expect(managerTimeline).toContainText("Break 2 · 30 min");
    await expect(managerTimeline).toContainText("Break 3 · 30 min");

    const operatorPage = await browser.newPage();
    const operatorUsername = uniqueTestId("break_operator");
    await signUp(operatorPage, "operator", operatorUsername);
    await operatorPage.reload({ waitUntil: "domcontentloaded" });
    await operatorPage.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
    await operatorPage.getByRole("button", { name: "More" }).click();
    await expect(
      operatorPage.getByRole("menuitem", { name: "Schedule", exact: true }),
    ).toHaveCount(0);
    await operatorPage.getByRole("menuitem", { name: "Summary", exact: true }).click();
    const operatorTimeline = operatorPage.getByTestId("day-timeline");
    await expect(operatorTimeline).toBeVisible();
    await expect(operatorTimeline).toContainText("Break 1 · 30 min");
    await expect(operatorTimeline).toContainText("Break 2 · 30 min");
    await expect(operatorTimeline).toContainText("Break 3 · 30 min");
    await expect(operatorPage.getByTestId("schedule-breaks")).toHaveCount(0);
    await operatorPage.close();
  });

  test("supervisors can review field checks without physical-device attestation controls", async ({ page }) => {
    await signUp(page, "supervisor");

    await page.getByRole("button", { name: "More" }).click();
    await page.getByRole("menuitem", { name: "Reported issues", exact: true }).click();
    const fieldChecks = page.getByTestId("field-checks-panel");
    await expect(fieldChecks).toBeVisible();
    await expect(fieldChecks.getByRole("heading", { name: "Field checks" })).toBeVisible();
    await expect(fieldChecks.getByText("Guided hardware confirmations", { exact: true })).toBeVisible();
    await expect(fieldChecks.getByText(/Touch accuracy: Unsupported/)).toBeVisible();
    await expect(fieldChecks.getByRole("combobox", { name: "Device category", exact: true })).toHaveCount(0);
    await expect(fieldChecks.getByRole("button", { name: "Pass", exact: true })).toHaveCount(0);
    await expect(fieldChecks.getByRole("button", { name: "Fail", exact: true })).toHaveCount(0);
    await expect(fieldChecks.getByRole("button", { name: "Incomplete", exact: true })).toHaveCount(0);
  });

});
