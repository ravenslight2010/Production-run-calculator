import { expect, test, type Page } from "@playwright/test";

const calculatorUrl = `http://127.0.0.1:${process.env.REDUCED_MOTION_CALCULATOR_PORT ?? 4185}`;
const mockupUrl = `http://127.0.0.1:${process.env.REDUCED_MOTION_MOCKUP_PORT ?? 4186}`;

const surfaces = [
  {
    name: "calculator",
    url: calculatorUrl,
    preview: false,
  },
  {
    name: "packing preview — current",
    url: `${mockupUrl}/preview/screen-improvements/PackTabCurrent`,
    preview: true,
  },
  {
    name: "packing preview — improved",
    url: `${mockupUrl}/preview/screen-improvements/PackTabImproved`,
    preview: true,
  },
] as const;

const animationUtilities = ["animate-pulse", "animate-spin", "animate-ping"];
const transitionUtilities = ["transition-all", "transition-colors"];

async function keepRequestsLocal(page: Page): Promise<void> {
  await page.route("**/*", async (route) => {
    const requestUrl = new URL(route.request().url());
    if (
      requestUrl.hostname === "127.0.0.1" &&
      requestUrl.pathname.startsWith("/api/")
    ) {
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ error: "Unauthenticated test preview" }),
      });
      return;
    }

    if (
      requestUrl.hostname === "127.0.0.1" &&
      !requestUrl.pathname.startsWith("/api/")
    ) {
      await route.continue();
    } else {
      await route.abort();
    }
  });
}

async function addMotionProbes(page: Page): Promise<void> {
  await page.evaluate(
    ({ animationUtilities, transitionUtilities }) => {
      const style = document.createElement("style");
      style.textContent = `
        @keyframes reduced-motion-probe-pulse { 50% { opacity: .25 } }
        @keyframes reduced-motion-probe-spin { to { transform: rotate(360deg) } }
        @keyframes reduced-motion-probe-ping { 75%, 100% { transform: scale(2); opacity: 0 } }
        [data-motion-animation="animate-pulse"] { animation: reduced-motion-probe-pulse 1s infinite; }
        [data-motion-animation="animate-spin"] { animation: reduced-motion-probe-spin 1s linear infinite; }
        [data-motion-animation="animate-ping"] { animation: reduced-motion-probe-ping 1s cubic-bezier(0, 0, .2, 1) infinite; }
        [data-motion-transition="transition-all"] { transition: opacity 1s linear; }
        [data-motion-transition="transition-colors"] { transition: color 1s linear; }
        [data-testid="motion-indicator"] {
          display: inline-block; width: 8px; height: 8px; border-radius: 50%;
          background: #10b981; animation: reduced-motion-probe-pulse 1s infinite;
        }
      `;
      document.head.append(style);

      const fixture = document.createElement("section");
      fixture.dataset.testid = "reduced-motion-fixture";
      fixture.style.cssText =
        "position:fixed;left:8px;top:8px;z-index:2147483647;background:white;color:black;padding:8px";

      const status = document.createElement("div");
      status.dataset.testid = "motion-status";
      status.setAttribute("role", "status");
      status.textContent = "Motion status ready";
      fixture.append(status);

      const indicator = document.createElement("span");
      indicator.dataset.testid = "motion-indicator";
      indicator.setAttribute("aria-label", "Status indicator");
      fixture.append(indicator);

      for (const utility of animationUtilities) {
        const element = document.createElement("span");
        element.dataset.motionAnimation = utility;
        element.className = utility;
        element.style.cssText = "display:inline-block;width:8px;height:8px";
        fixture.append(element);
      }

      for (const utility of transitionUtilities) {
        const element = document.createElement("span");
        element.dataset.motionTransition = utility;
        element.className = utility;
        element.style.cssText = "display:inline-block;width:8px;height:8px";
        fixture.append(element);
      }

      document.body.append(fixture);
    },
    { animationUtilities, transitionUtilities },
  );
}

async function visitSurface(page: Page, surface: (typeof surfaces)[number]) {
  await page.goto(surface.url, { waitUntil: "domcontentloaded" });
  await expect(page.locator("body")).toBeVisible();
  await addMotionProbes(page);

  if (surface.preview) {
    await expect(page.getByText("Active Skid Building", { exact: true })).toBeVisible();
    await expect(page.locator(".animate-pulse").first()).toBeVisible();
  } else {
    await expect(page.getByTestId("motion-status")).toBeVisible();
    await expect(page.getByTestId("motion-indicator")).toBeVisible();
  }
}

async function readMotionState(page: Page) {
  return page.evaluate(() => {
    const readAnimation = (element: Element) => {
      const style = getComputedStyle(element);
      return {
        name: style.animationName,
        duration: style.animationDuration,
      };
    };
    const readTransition = (element: Element) =>
      getComputedStyle(element).transitionDuration;

    return {
      prefersReducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
      animations: Array.from(
        document.querySelectorAll<HTMLElement>("[data-motion-animation]"),
      ).map(readAnimation),
      transitions: Array.from(
        document.querySelectorAll<HTMLElement>("[data-motion-transition]"),
      ).map(readTransition),
    };
  });
}

test("reduced motion freezes animations and transitions without hiding status (responsive emulation)", async ({
  page,
}) => {
  await keepRequestsLocal(page);

  for (const surface of surfaces) {
    await test.step(surface.name, async () => {
      await visitSurface(page, surface);
      const state = await readMotionState(page);

      expect(state.prefersReducedMotion).toBe(true);
      expect(state.animations).toHaveLength(animationUtilities.length);
      expect(state.animations.map(({ name }) => name)).toEqual(
        animationUtilities.map(() => "none"),
      );
      expect(state.transitions).toHaveLength(transitionUtilities.length);
      expect(state.transitions).toEqual(transitionUtilities.map(() => "0s"));

      await expect(page.getByTestId("motion-status")).toHaveText(
        "Motion status ready",
      );
      await expect(page.getByTestId("motion-indicator")).toBeVisible();

      if (surface.preview) {
        await expect(
          page.getByText("Active Skid Building", { exact: true }),
        ).toBeVisible();
        await expect(page.locator(".animate-pulse").first()).toBeVisible();

        const previewTransitions = await page
          .locator(".transition-all, .transition-colors")
          .evaluateAll((elements) =>
            elements.map((element) => getComputedStyle(element).transitionDuration),
          );
        expect(previewTransitions.length).toBeGreaterThan(0);
        expect(previewTransitions.every((duration) => duration === "0s")).toBe(true);
      }
    });
  }
});

test("normal motion remains enabled when reduced motion is not requested", async ({
  page,
}) => {
  await keepRequestsLocal(page);

  for (const surface of surfaces) {
    await test.step(surface.name, async () => {
      await visitSurface(page, surface);
      await page.emulateMedia({ reducedMotion: "no-preference" });

      const state = await readMotionState(page);
      expect(state.prefersReducedMotion).toBe(false);
      expect(state.animations).toHaveLength(animationUtilities.length);
      expect(
        state.animations.every(
          ({ name, duration }) => name !== "none" && duration !== "0s",
        ),
      ).toBe(true);
      expect(state.transitions).toHaveLength(transitionUtilities.length);
      expect(state.transitions.every((duration) => duration !== "0s")).toBe(true);

      await expect(page.getByTestId("motion-status")).toHaveText(
        "Motion status ready",
      );
      await expect(page.getByTestId("motion-indicator")).toBeVisible();

      if (surface.preview) {
        await expect(
          page.getByText("Active Skid Building", { exact: true }),
        ).toBeVisible();
      }
    });
  }
});
