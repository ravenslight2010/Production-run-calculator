import AxeBuilder from "@axe-core/playwright";
import { test, expect, type Locator, type Page, type Request } from "@playwright/test";
import { Client } from "pg";
import { cancelledDocumentMessage, cancelledJourneyRead } from "./breakPlanningEvidence";
import {
  cleanupTestUsers,
  requireIsolatedTestDatabase,
  uniqueTestId,
  AuthorizedBrowserFixtures,
} from "./isolation";
import {
  dismissOnboardingIfPresent,
  signUpAndHandleOnboarding,
} from "./onboarding";

const testUsernames = new Set<string>();
const canonicalSeedDates = new Set<string>();
let authorizedFixtures: AuthorizedBrowserFixtures;
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
  scheduleAccess = false,
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
        } else if (role === "supervisor") {
          await db.query(
            "UPDATE roles SET capabilities = $1::jsonb WHERE name = 'supervisor'",
            [JSON.stringify(["review-incidents", "edit-production-rules", ...(scheduleAccess ? ["manage-factory-settings"] : [])])],
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
  await authorizedFixtures?.cleanup({ syncDates: [...canonicalSeedDates] });
  if (!process.env.DATABASE_URL || testUsernames.size === 0) return;
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    await cleanupTestUsers(client, testUsernames);
  } finally {
    await client.end().catch(() => {});
  }
});

test.beforeAll(async ({ playwright }) => {
  await requireIsolatedTestDatabase("accessibility smoke browser check");
  authorizedFixtures = await AuthorizedBrowserFixtures.create(
    playwright,
    process.env.PLAYWRIGHT_API_BASE_URL ?? process.env.PLAYWRIGHT_BASE_URL
      ?? `https://${process.env.REPLIT_DEV_DOMAIN}`,
    process.env.STAFF_SIGNUP_CODE ?? "",
  );
});

async function seedPendingRun(page: Page): Promise<string> {
  const runId = uniqueTestId("a11y_run");
  const { date, now } = await page.evaluate(() => {
    const current = new Date();
    return {
      date: [
        current.getFullYear(),
        String(current.getMonth() + 1).padStart(2, "0"),
        String(current.getDate()).padStart(2, "0"),
      ].join("-"),
      now: current.getTime(),
    };
  });
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
  const token = (await page.context().cookies(page.url()))
    .find((cookie) => cookie.name === "rc_auth")?.value;
  if (!token) throw new Error("Accessibility fixture requires an authenticated browser.");
  // Stop the app before privileged, disposable-database initialization.
  // Stoppage history is command-owned and must not be forged by a normal PUT.
  await page.goto("about:blank");
  await authorizedFixtures.seedCanonicalTodaySnapshot({
    token,
    senderId: `a11y-${runId}`,
    date,
    payload,
  });
  canonicalSeedDates.add(date);
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
  await page.goto("/", { waitUntil: "domcontentloaded" });
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

async function seedBreakSchedule(completeInputs = false): Promise<{
  runIds: [string, string];
  deletedRunId: string;
}> {
  await requireIsolatedTestDatabase("break scheduling browser seed");
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL must be configured for break scheduling browser tests.");
  }
  const nowDate = new Date();
  const date = `${nowDate.getFullYear()}-${String(nowDate.getMonth() + 1).padStart(2, "0")}-${String(nowDate.getDate()).padStart(2, "0")}`;
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
              { id: runIds[0], brand: "Break E2E One", flavor: "Morning", casesNeeded: 0, ...(completeInputs ? { subTab: "crusts" } : {}) },
              { id: runIds[1], brand: "Break E2E Two", flavor: "Afternoon", casesNeeded: 0, ...(completeInputs ? { subTab: "crusts" } : {}) },
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
            [runIds[0]]: { casesNeeded: completeInputs ? 100 : 0, pizzasPerCase: 12, approxLineSpeed: completeInputs ? 40 : 10, ...(completeInputs ? { freezerTime: 15 } : {}) },
            [runIds[1]]: { casesNeeded: completeInputs ? 100 : 0, pizzasPerCase: 12, approxLineSpeed: completeInputs ? 40 : 10, ...(completeInputs ? { freezerTime: 15 } : {}) },
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
  // Wait for the dropdown to fully unmount before returning. Radix keeps the
  // menu in the DOM through its close fade-out; an axe scan that lands during
  // the fade computes opacity-blended colors and reports phantom dark-on-dark
  // contrast violations (plus a region violation for the popper wrapper).
  await expect(page.getByRole("menu")).toHaveCount(0);
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
      const root = document.createElement("div");
      root.id = "operational-contrast-audit";
      root.innerHTML = fixtures
        .map(
          (fixture) =>
            `<section id="${fixture.theme}-${fixture.id}" data-theme="${fixture.theme}" class="${fixture.wrapperClass}" style="padding: 12px; margin: 4px"><span class="${fixture.textClass}">${fixture.text}</span></section>`,
        )
        .join("");
      document.body.append(root);
    }, OPERATIONAL_CONTRAST_FIXTURES);

    for (const fixture of OPERATIONAL_CONTRAST_FIXTURES) {
      const label = page.locator(`#${fixture.theme}-${fixture.id} > span`);
      await expect(
        label,
        `${fixture.theme} ${fixture.id} contrast label should be rendered`,
      ).toHaveCount(1);
      await expect(
        label,
        `${fixture.theme} ${fixture.id} contrast label should retain its text`,
      ).toHaveText(fixture.text);
    }

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
    const originalDarkTheme = await page.evaluate(() =>
      document.documentElement.classList.contains("dark"),
    );
    for (const theme of ["dark", "light"] as const) {
      await page.evaluate((activeTheme) => {
        document.documentElement.classList.toggle("dark", activeTheme === "dark");
      }, theme);
      const stoppageContrast = await new AxeBuilder({ page })
        .include('[data-testid="stoppage-log"]')
        .withRules(["color-contrast"])
        .analyze();
      expect(
        stoppageContrast.violations,
        `Rendered stoppage log color contrast audit (${theme} theme)`,
      ).toEqual([]);
    }
    await page.evaluate((darkTheme) => {
      document.documentElement.classList.toggle("dark", darkTheme);
    }, originalDarkTheme);
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
    await expect(fieldChecks.getByText("Recorded when the authenticated field-check observer starts; home-bundle timing is a separate performance observation.", { exact: true })).toBeVisible();
    await expect(fieldChecks.getByText("Guided hardware confirmations", { exact: true })).toBeVisible();
    await expect(fieldChecks.getByText(/Touch accuracy: Health Unsupported/)).toBeVisible();
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
    await scheduledDaysDialog
      .getByRole("button", { name: "Schedule New Day", exact: true })
      .click();
    const scheduleEditor = page.getByRole("dialog", { name: /Plan for/ });
    await assertDialogContract(page, scheduleEditor, "schedule editor");
    const scheduleDateTrigger = scheduleEditor.getByRole("button", {
      name: "Choose production date",
    });
    await expect(scheduleDateTrigger).toBeVisible();
    const initialDate = await scheduleDateTrigger.getAttribute("data-date-value");
    await scheduleDateTrigger.focus();
    await page.keyboard.press("Enter");
    const scheduleCalendar = page.locator('[data-slot="calendar"]');
    await expect(scheduleCalendar.getByRole("grid")).toBeVisible();
    await scan(page, "schedule calendar", [], '[data-slot="calendar"]');
    const selectedDay = scheduleCalendar.locator('button[data-selected-single="true"]');
    await expect(selectedDay).toBeVisible();
    const selectedDate = await selectedDay.getAttribute("data-day");
    expect(selectedDate).toBeTruthy();
    await selectedDay.focus();
    await page.keyboard.press("ArrowRight");
    // React Day Picker moves focus asynchronously. Enter before the new day
    // receives focus can activate the old day (or no day) and leave the
    // calendar open while the test appears to have exercised its keyboard path.
    await expect.poll(() => page.evaluate((previousDate) => {
      const focused = document.activeElement;
      return focused instanceof HTMLButtonElement
        && focused.matches('button[data-day]:not([disabled])')
        && focused.getAttribute("data-day") !== previousDate;
    }, selectedDate)).toBe(true);
    await page.keyboard.press("Enter");
    await expect(scheduleDateTrigger).not.toHaveAttribute(
      "data-date-value",
      initialDate ?? "",
    );
    await expect(scheduleEditor).toBeVisible();
    await expect(scheduleCalendar).toBeHidden();
    await page.locator("#replit-dev-banner").evaluateAll((nodes) => {
      for (const node of nodes) node.remove();
    });
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
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });

    await page.getByRole("button", { name: "More" }).click();
    const scheduleMenuItem = page.getByRole("menuitem", { name: "Schedule", exact: true });
    await expect(scheduleMenuItem).toBeVisible();
    await scheduleMenuItem.click();
    const scheduledDaysDialog = page.getByRole("dialog", { name: "Scheduled Days" });
    await scheduledDaysDialog
      .getByTestId("schedule-today-card")
      .getByRole("button", { name: "Edit", exact: true })
      .click();
    const scheduleEditor = page.getByRole("dialog", { name: /Plan for/ });
    const breakEditor = scheduleEditor.getByTestId("schedule-breaks");
    await expect(breakEditor).toContainText("Each planned break is fixed at 30 minutes.");
    const breakToggle = breakEditor.getByTestId("schedule-break-toggle");
    if (await breakToggle.isVisible()) {
      await expect(breakToggle).toHaveText("Add breaks");
      await breakToggle.click();
      await expect(breakToggle).toHaveText("Hide breaks");
    }
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
    await expect(reloadedBreakEditor).toContainText("Each planned break is fixed at 30 minutes.");
    const reloadedBreakToggle = reloadedBreakEditor.getByTestId("schedule-break-toggle");
    if (await reloadedBreakToggle.isVisible()) {
      await reloadedBreakToggle.click();
      await expect(reloadedBreakToggle).toHaveText("Hide breaks");
    }
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

  test("touch break planning opens above Schedule and retains the saved draft", async ({ page }) => {
    const errors: string[] = [];
    const failedResponses: string[] = [];
    const knownManagerDiagnostics404: string[] = [];
    const knownManagerDiagnosticsConsole: string[] = [];
    const unexpectedRequestFailures: string[] = [];
    const expectedNavigationAborts: string[] = [];
    const cancelledReadsToVerify = new Map<string, string>();
    const expectedWebKitNavigationMessages: string[] = [];
    const inFlight = new Set<Request>();
    const navigationRequests = new WeakSet<Request>();
    const navigationPaths = new Set<string>();
    const successfulOrigins = new Set<string>();
    let requestPhase = "post-auth journey";
    // Track requests from the first document, including those started before
    // auth hydration; otherwise a later reload cannot identify their aborts.
    page.on("request", request => inFlight.add(request));
    page.on("requestfinished", request => inFlight.delete(request));
    page.on("response", response => {
      if (response.ok()) successfulOrigins.add(new URL(response.url()).origin);
    });
    await signUp(page);
    await seedBreakSchedule(true);
    await page.clock.setFixedTime(new Date());
    await page.evaluate(() => {
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith("run-calc")) localStorage.removeItem(key);
      }
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
    // Start diagnostics after signup/bootstrap and the fixture-backed reload so
    // expected pre-auth 401s are not misclassified as failures in this journey.
    const markNavigation = () => {
      for (const request of inFlight) {
        navigationRequests.add(request);
        navigationPaths.add(new URL(request.url()).pathname);
      }
    };
    page.on("pageerror", error => {
      const cancelledPath = cancelledDocumentMessage({
        webkit: test.info().project.name.endsWith("webkit"),
        text: error.message,
        successfulOrigins,
        navigationPaths,
        duringReload: requestPhase === "persistence reload",
      });
      if (cancelledPath) {
        expectedWebKitNavigationMessages.push(`cancelled page error: ${cancelledPath}`);
      } else {
        errors.push(error.message);
      }
    });
    page.on("console", message => {
      if (message.type() === "error") {
        const source = message.location().url;
        const pathname = source ? new URL(source).pathname : "";
        const text = message.text();
        const cancelledPath = cancelledDocumentMessage({
          webkit: test.info().project.name.endsWith("webkit"),
          text, successfulOrigins, navigationPaths,
          duringReload: requestPhase === "persistence reload",
        });
        if (
          pathname === "/api/background-operations/diagnostics"
          && text.includes("404 (Not Found)")
        ) {
          knownManagerDiagnosticsConsole.push(`${text} [${pathname}]`);
        } else if (cancelledPath) {
          expectedWebKitNavigationMessages.push(`cancelled document: ${cancelledPath}`);
        } else {
          errors.push(`${text}${pathname ? ` [${pathname}]` : ""}`);
        }
      }
    });
    page.on("response", response => {
      const pathname = new URL(response.url()).pathname;
      const record = `${response.status()} ${response.request().method()} ${pathname}`;
      if (
        response.status() === 404
        && response.request().method() === "GET"
        && pathname === "/api/background-operations/diagnostics"
      ) {
        // Confirmed pre-existing manager diagnostics route is not mounted.
        // Retain it as a separate finding; it is not a Schedule test success.
        knownManagerDiagnostics404.push(record);
      } else if (response.status() >= 400) {
        failedResponses.push(record);
      }
    });
    page.on("requestfailed", request => {
      const pathname = new URL(request.url()).pathname;
      const code = request.failure()?.errorText ?? "unknown";
      const record = `${request.method()} ${pathname} ${code}`;
      const expectedAbort =
        ["net::ERR_ABORTED", "Load request cancelled"].includes(code)
        && (
          ((requestPhase === "persistence reload" || navigationRequests.has(request)) && (
            (request.method() === "GET" && pathname === "/api/sync/events")
            || (pathname === "/api/factory-data" && ["GET", "PUT"].includes(request.method()))
            || (request.method() === "GET" && pathname === "/api/incidents/actionable-count")
          ))
          || (requestPhase === "summary navigation"
            && request.method() === "GET"
            && pathname === "/api/sync/events")
        );
      const cancelledRead = cancelledJourneyRead({
        method: request.method(), pathname, code,
        knownOrigin: successfulOrigins.has(new URL(request.url()).origin),
        duringNavigation: navigationRequests.has(request) || ["persistence reload", "summary navigation"].includes(requestPhase),
      });
      if (cancelledRead) cancelledReadsToVerify.set(request.url(), pathname);
      if (expectedAbort || cancelledRead) {
        expectedNavigationAborts.push(`${requestPhase}: ${record}`);
      } else {
        unexpectedRequestFailures.push(`${requestPhase}: ${record}`);
      }
      inFlight.delete(request);
    });
    const openEditor = async () => {
      await page.getByRole("button", { name: "More" }).click();
      await page.getByRole("menuitem", { name: "Schedule", exact: true }).click();
      await expect(page.getByRole("menu")).toHaveCount(0);
      await page.getByTestId("schedule-today-card").getByRole("button", { name: "Edit", exact: true }).click();
      const editor = page.getByRole("dialog", { name: /Plan for/ });
      const toggle = editor.getByTestId("schedule-break-toggle");
      if (await toggle.isVisible()) await toggle.click();
      return editor;
    };
    const editor = await openEditor();
    const scheduleLayer = await editor.evaluate(node => getComputedStyle(node.parentElement!).zIndex);
    const choose = async (slot: number, value: string, label: string) => {
      const control = editor.getByLabel(`Break ${slot} placement`, { exact: true });
      if (await control.evaluate(node => node.tagName === "SELECT")) {
        await control.selectOption(value);
      } else {
        await control.click();
        await page.getByRole("dialog", { name: `Break ${slot} placement`, exact: true }).getByRole("option", { name: label, exact: true }).click();
      }
    };
    for (const slot of [1, 2, 3]) {
      const trigger = editor.getByLabel(`Break ${slot} placement`, { exact: true });
      const touch = await trigger.evaluate(node => node.tagName === "BUTTON");
      if (touch) {
        await trigger.click();
        const picker = page.getByRole("dialog", { name: `Break ${slot} placement`, exact: true });
        const option = picker.getByRole("option", { name: "After a run", exact: true });
        await expect(option).toBeVisible();
        if (
          slot === 1
          && process.env.BREAK_REPRODUCE_ORIGINAL_LAYER === "1"
          && test.info().project.name === "android-touch"
        ) {
          // Controlled reproduction of the original z-50 portal against the
          // real z-70 Schedule, not a claim about a customer's physical phone.
          await picker.evaluate(node => {
            (node as HTMLElement).setAttribute("data-break-layer-probe", "break-1-picker");
            const overlay = node.previousElementSibling as HTMLElement | null;
            if (overlay) overlay.setAttribute("data-break-layer-probe", "break-1-overlay");
          });
          const layerSheet = await page.addStyleTag({ content: `
            [role="dialog"][aria-labelledby][data-state="open"][data-break-layer-probe="break-1-picker"] {
              z-index: 50 !important; transition: none !important;
            }
            [data-state="open"][data-break-layer-probe="break-1-overlay"] {
              z-index: 50 !important; transition: none !important;
            }
          ` });
          expect(await picker.evaluate(node => getComputedStyle(node).zIndex)).toBe("50");
          expect(scheduleLayer).toBe("70");
          await page.screenshot({ path: "../../.local/evidence/break-planning/original-layer-emulation.png" });
          await layerSheet.evaluate(style => {
            style.textContent = `
              [role="dialog"][aria-labelledby][data-state="open"][data-break-layer-probe="break-1-picker"] {
                z-index: 80 !important; transition: none !important;
              }
              [data-state="open"][data-break-layer-probe="break-1-overlay"] {
                z-index: 80 !important; transition: none !important;
              }
            `;
          });
          await expect.poll(() => picker.evaluate(node => getComputedStyle(node).zIndex)).toBe("80");
          await page.screenshot({ path: "../../.local/evidence/break-planning/repaired-layer-emulation.png" });
        }
        await expect.poll(() => option.evaluate((node) => {
          const box = node.getBoundingClientRect();
          return node.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
        })).toBe(true);
        await option.click();
        await expect(picker).toBeHidden();
        await editor.getByRole("button", { name: `Break ${slot} run`, exact: true }).click();
        await page.getByRole("dialog", { name: `Break ${slot} run`, exact: true })
          .getByRole("option", { name: /Run 1 —/ }).click();
        await trigger.click();
        await page.keyboard.press("Escape");
        await expect(trigger).toBeFocused();
        await expect(trigger).toHaveText(/After a run/);
        await trigger.click();
        await page.getByRole("dialog", { name: `Break ${slot} placement`, exact: true })
          .getByRole("button", { name: "Cancel", exact: true }).click();
      } else {
        await trigger.selectOption("after-run");
        await editor.getByLabel(`Break ${slot} run`, { exact: true }).selectOption({ index: 1 });
      }
      await choose(slot, "at-time", "At a clock time");
      await editor.getByLabel(`Break ${slot} time`).fill("23:00");
      await choose(slot, "off", "Not scheduled");
      await expect(editor.getByLabel(`Break ${slot} time`)).toBeDisabled();
      await choose(slot, "after-run", "After a run");
    }
    await choose(2, "at-time", "At a clock time");
    await choose(3, "off", "Not scheduled");
    const preview = await editor.getByTestId("schedule-break-preview").innerText();
    const projectedFinish = preview.match(/day finish ([^\n]+)/)?.[1];
    expect(projectedFinish).toBeTruthy();
    const saved = page.waitForResponse((response) => response.url().includes("/api/sync/today") && response.request().method() === "PUT");
    await editor.getByRole("button", { name: "Save Schedule", exact: true }).click();
    expect((await saved).ok()).toBe(true);
    requestPhase = "persistence reload";
    markNavigation();
    await page.reload({ waitUntil: "load" });
    await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
    requestPhase = "post-auth journey";
    const reopened = await openEditor();
    const touch = await reopened.getByLabel("Break 1 placement", { exact: true }).evaluate(node => node.tagName === "BUTTON");
    if (touch) {
      await expect(reopened.getByLabel("Break 1 placement", { exact: true })).toHaveText(/After a run/);
      await expect(reopened.getByLabel("Break 1 run", { exact: true })).toHaveText(/Run 1/);
      await expect(reopened.getByLabel("Break 2 placement", { exact: true })).toHaveText(/At a clock time/);
      await expect(reopened.getByLabel("Break 3 placement", { exact: true })).toHaveText(/Not scheduled/);
    } else {
      await expect(reopened.getByLabel("Break 1 placement", { exact: true })).toHaveValue("after-run");
      await expect(reopened.getByLabel("Break 2 placement", { exact: true })).toHaveValue("at-time");
      await expect(reopened.getByLabel("Break 3 placement", { exact: true })).toHaveValue("off");
    }
    await expect(reopened.getByLabel("Break 2 time")).toHaveValue("23:00");
    await expect.poll(() => reopened.getByTestId("schedule-break-preview").innerText()).toBe(preview);
    await choose(1, "off", "Not scheduled");
    await reopened.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.getByRole("dialog", { name: "Scheduled Days", exact: true }).getByRole("button", { name: /Close/ }).click();
    const cancelled = await openEditor();
    if (touch) await expect(cancelled.getByLabel("Break 1 placement", { exact: true })).toHaveText(/After a run/);
    else await expect(cancelled.getByLabel("Break 1 placement", { exact: true })).toHaveValue("after-run");
    await cancelled.getByRole("button", { name: "Close schedule editor", exact: true }).click();
    requestPhase = "summary navigation";
    markNavigation();
    await page.getByRole("button", { name: "More" }).click();
    await page.getByRole("menuitem", { name: "Summary", exact: true }).click();
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(page.getByTestId("day-timeline")).toContainText(projectedFinish!);
    requestPhase = "post-auth journey";
    if (test.info().project.name === "android-touch") {
      await page.getByTestId("day-timeline").screenshot({ path: "../../.local/evidence/break-planning/break-summary.png" });
    }

    // Cancellation is not a success receipt. Require fresh authenticated reads
    // of every exact cancelled URL after reload/navigation; actual HTTP errors
    // still fail, except the separately retained known unmounted diagnostic.
    for (const [url, pathname] of cancelledReadsToVerify) {
      const recovery = await page.request.get(url);
      if (pathname === "/api/background-operations/diagnostics") {
        expect(recovery.status()).toBe(404);
        knownManagerDiagnostics404.push("404 GET /api/background-operations/diagnostics");
      } else expect(recovery.ok(), `fresh read after navigation: ${pathname}`).toBe(true);
    }

    console.log("known out-of-scope manager diagnostics 404s:", {
      responses: knownManagerDiagnostics404,
      console: knownManagerDiagnosticsConsole,
      expectedNavigationAborts,
      expectedWebKitNavigationMessages,
    });
    expect(knownManagerDiagnostics404.every(value => value === "404 GET /api/background-operations/diagnostics")).toBe(true);
    expect({ errors, failedResponses, unexpectedRequestFailures }).toEqual({
      errors: [],
      failedResponses: [],
      unexpectedRequestFailures: [],
    });
  });

  test("break planning enlarged-text keyboard controls", async ({ page }) => {
    await signUp(page);
    await seedBreakSchedule();
    await page.evaluate(() => {
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith("run-calc")) localStorage.removeItem(key);
      }
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
    await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe("32px");

    await page.getByRole("button", { name: "More" }).click();
    await page.getByRole("menuitem", { name: "Schedule", exact: true }).click();
    await expect(page.getByRole("menu")).toHaveCount(0);
    await page.getByTestId("schedule-today-card").getByRole("button", { name: "Edit", exact: true }).click();
    const editor = page.getByRole("dialog", { name: /Plan for/ });
    const toggle = editor.getByTestId("schedule-break-toggle");
    if (await toggle.isVisible()) await toggle.click();
    const trigger = editor.getByLabel("Break 1 placement", { exact: true });
    await expect(trigger).toBeVisible();

    if (await trigger.evaluate(node => node.tagName === "BUTTON")) {
      await trigger.press("Enter");
      console.log("enlarged keyboard modal state after Enter:", await page.evaluate(() => ({
        activeTag: document.activeElement?.tagName,
        activeLabel: document.activeElement?.getAttribute("aria-label"),
        url: location.pathname,
        dialogs: [...document.querySelectorAll('[role="dialog"]')].map(node => ({
          state: node.getAttribute("data-state"),
          hidden: node.getAttribute("aria-hidden"),
          label: node.getAttribute("aria-label"),
          labelledBy: node.getAttribute("aria-labelledby"),
        })),
      })));
      await expect(page.getByRole("dialog", { name: "Break 1 placement", exact: true })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(trigger).toBeFocused();
    } else {
      const next = editor.getByLabel("Break 1 run", { exact: true });
      await trigger.press("Tab");
      console.log("enlarged keyboard focus after Tab:", await page.evaluate(() => ({
        activeTag: document.activeElement?.tagName,
        activeLabel: document.activeElement?.getAttribute("aria-label"),
        url: location.pathname,
        dialogs: [...document.querySelectorAll('[role="dialog"]')].map(node => ({
          state: node.getAttribute("data-state"),
          hidden: node.getAttribute("aria-hidden"),
          label: node.getAttribute("aria-label"),
          labelledBy: node.getAttribute("aria-labelledby"),
        })),
      })));
      await expect(next).toBeFocused();
    }
    await editor.getByRole("button", { name: "Cancel", exact: true }).click();
  });

  test("Android-sized PWA schedule editor exposes the break planner and preserves placements", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 412, height: 915 });
    await signUp(page);
    await seedBreakSchedule();
    await page.evaluate(() => {
      for (const key of Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))) {
        if (key?.startsWith("run-calc")) localStorage.removeItem(key);
      }
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });

    const openScheduleEditor = async (): Promise<Locator> => {
      await page.getByRole("button", { name: "More" }).click();
      const scheduleMenuItem = page.getByRole("menuitem", { name: "Schedule", exact: true });
      await expect(scheduleMenuItem).toBeVisible();
      await scheduleMenuItem.click();
      const scheduledDaysDialog = page.getByRole("dialog", { name: "Scheduled Days" });
      await scheduledDaysDialog
        .getByTestId("schedule-today-card")
        .getByRole("button", { name: "Edit", exact: true })
        .click();
      return page.getByRole("dialog", { name: /Plan for/ });
    };

    const scheduleEditor = await openScheduleEditor();
    const breakEditor = scheduleEditor.getByTestId("schedule-breaks");
    const breakToggle = breakEditor.getByTestId("schedule-break-toggle");
    if (await breakToggle.isVisible()) {
      await expect(breakToggle).toHaveText("Add breaks");
      await breakToggle.click();
      await expect(breakToggle).toHaveText("Hide breaks");
    } else {
      await expect(
        breakEditor.getByRole("combobox", { name: "Break 1 placement" }),
      ).toBeVisible();
    }
    for (const [slot, time] of [[1, "07:00"], [2, "09:00"], [3, "11:00"]] as const) {
      await breakEditor
        .getByRole("combobox", { name: `Break ${slot} placement` })
        .selectOption("at-time");
      await breakEditor.getByLabel(`Break ${slot} time`).fill(time);
    }
    await scan(page, "Android schedule break planner", [], '[data-testid="schedule-breaks"]');

    const saveResponse = page.waitForResponse(
      (response) =>
        response.url().includes("/api/sync/today") &&
        response.request().method() === "PUT",
    );
    await scheduleEditor.getByRole("button", { name: "Save Schedule", exact: true }).click();
    expect((await saveResponse).ok()).toBe(true);

    // Closing the document and opening a new page models an installed PWA
    // relaunch while retaining the authenticated cookie and persisted plan.
    const context = page.context();
    await page.close();
    const reopened = await context.newPage();
    await reopened.setViewportSize({ width: 412, height: 915 });
    await reopened.goto("/", { waitUntil: "domcontentloaded" });
    await reopened.getByTestId("tab-run").waitFor({ state: "attached", timeout: 30_000 });
    await reopened.getByRole("button", { name: "More" }).click();
    await reopened.getByRole("menuitem", { name: "Schedule", exact: true }).click();
    const reopenedScheduledDays = reopened.getByRole("dialog", { name: "Scheduled Days" });
    await reopenedScheduledDays
      .getByTestId("schedule-today-card")
      .getByRole("button", { name: "Edit", exact: true })
      .click();

    const reopenedEditor = reopened.getByRole("dialog", { name: /Plan for/ });
    const reopenedBreakEditor = reopenedEditor.getByTestId("schedule-breaks");
    await expect(reopenedBreakEditor.getByTestId("schedule-break-toggle")).toHaveText("Add breaks");
    await expect(reopenedBreakEditor.getByTestId("schedule-break-summary")).toContainText(
      "Break 1 · 07:00 · Break 2 · 09:00 · Break 3 · 11:00",
    );
    await reopenedBreakEditor.getByTestId("schedule-break-toggle").click();
    for (const [slot, time] of [[1, "07:00"], [2, "09:00"], [3, "11:00"]] as const) {
      await expect(
        reopenedBreakEditor.getByRole("combobox", { name: `Break ${slot} placement` }),
      ).toHaveValue("at-time");
      await expect(reopenedBreakEditor.getByLabel(`Break ${slot} time`)).toHaveValue(time);
    }
    await reopened.close();
  });

  test("supervisors without scheduling capability cannot open Schedule", async ({ page }) => {
    await signUp(page, "supervisor");
    await page.getByRole("button", { name: "More" }).click();
    await expect(page.getByRole("menuitem", { name: "Schedule", exact: true })).toHaveCount(0);
    await expect(page.getByRole("menuitem", { name: "Staff roster", exact: true })).toHaveCount(0);
  });

  test("authorized supervisors can save all break slots without manager-only controls", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    // This test's explicitly authorized supervisor is granted only scheduling
    // access in the disposable fixture, not manager/staff administration.
    await signUp(page, "supervisor", uniqueTestId("a11y_schedule_supervisor"), true);
    await seedBreakSchedule();
    await page.evaluate(() => {
      for (const key of Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))) {
        if (key?.startsWith("run-calc")) localStorage.removeItem(key);
      }
    });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });

    await page.getByRole("button", { name: "More" }).click();
    await expect(page.getByRole("menuitem", { name: "Schedule", exact: true })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Staff roster", exact: true })).toHaveCount(0);
    await expect(page.getByRole("menuitem", { name: "Manager action queue", exact: true })).toHaveCount(0);
    await page.getByRole("menuitem", { name: "Schedule", exact: true }).click();

    const scheduledDaysDialog = page.getByRole("dialog", { name: "Scheduled Days" });
    await scheduledDaysDialog
      .getByTestId("schedule-today-card")
      .getByRole("button", { name: "Edit", exact: true })
      .click();
    const scheduleEditor = page.getByRole("dialog", { name: /Plan for/ });
    const breakEditor = scheduleEditor.getByTestId("schedule-breaks");
    await expect(breakEditor).toContainText("Each planned break is fixed at 30 minutes.");
    const breakToggle = breakEditor.getByTestId("schedule-break-toggle");
    if (await breakToggle.isVisible()) {
      await expect(breakToggle).toHaveText("Add breaks");
      await breakToggle.click();
      await expect(breakToggle).toHaveText("Hide breaks");
    } else {
      await expect(
        breakEditor.getByRole("combobox", { name: "Break 1 placement" }),
      ).toBeVisible();
    }
    for (const [slot, time] of [[1, "07:00"], [2, "09:00"], [3, "11:00"]] as const) {
      await breakEditor
        .getByRole("combobox", { name: `Break ${slot} placement` })
        .selectOption("at-time");
      await breakEditor.getByLabel(`Break ${slot} time`).fill(time);
    }

    const saveResponse = page.waitForResponse(
      (response) =>
        response.url().includes("/api/sync/today") &&
        response.request().method() === "PUT",
    );
    await scheduleEditor.getByRole("button", { name: "Save Schedule", exact: true }).click();
    expect((await saveResponse).ok()).toBe(true);
    await expect(scheduledDaysDialog.getByTestId("schedule-today-card")).toBeVisible();

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.getByTestId("tab-run").waitFor({ state: "attached", timeout: 25_000 });
    await page.getByRole("button", { name: "More" }).click();
    await expect(page.getByRole("menuitem", { name: "Staff roster", exact: true })).toHaveCount(0);
    await expect(page.getByRole("menuitem", { name: "Manager action queue", exact: true })).toHaveCount(0);
    await page.getByRole("menuitem", { name: "Summary", exact: true }).click();
    const timeline = page.getByTestId("day-timeline");
    await expect(timeline).toBeVisible();
    await expect(timeline).toContainText("Break 1 · 30 min");
    await expect(timeline).toContainText("Break 2 · 30 min");
    await expect(timeline).toContainText("Break 3 · 30 min");
  });

  test("supervisors can review field checks without physical-device attestation controls", async ({ page }) => {
    await signUp(page, "supervisor");

    await page.getByRole("button", { name: "More" }).click();
    await page.getByRole("menuitem", { name: "Reported issues", exact: true }).click();
    const fieldChecks = page.getByTestId("field-checks-panel");
    await expect(fieldChecks).toBeVisible();
    await expect(fieldChecks.getByRole("heading", { name: "Field checks" })).toBeVisible();
    await expect(fieldChecks.getByText("Guided hardware confirmations", { exact: true })).toBeVisible();
    await expect(fieldChecks.getByText(/Touch accuracy: Health Unsupported/)).toBeVisible();
    await expect(fieldChecks.getByRole("combobox", { name: "Device category", exact: true })).toHaveCount(0);
    await expect(fieldChecks.getByRole("button", { name: "Pass", exact: true })).toHaveCount(0);
    await expect(fieldChecks.getByRole("button", { name: "Fail", exact: true })).toHaveCount(0);
    await expect(fieldChecks.getByRole("button", { name: "Incomplete", exact: true })).toHaveCount(0);
  });

});
