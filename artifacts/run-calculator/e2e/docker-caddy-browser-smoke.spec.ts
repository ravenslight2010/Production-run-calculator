import { expect, test } from "@playwright/test";

test.describe("saved calculator routes", () => {
  // Exercise Caddy, not a previously installed PWA's offline fallback.
  test.use({ serviceWorkers: "block" });

  test("serves a saved sign-in link directly and after refresh", async ({ page }) => {
    // No root visit or client-side navigation: Caddy must resolve the saved route.
    const navigation = await page.goto("/sign-in", { waitUntil: "domcontentloaded" });
    expect(navigation?.status(), "Caddy should serve the saved route document").toBe(200);
    expect(navigation?.headers()["content-type"]).toContain("text/html");
    await expect(page).toHaveURL(/\/sign-in$/);
    await expect(page).toHaveTitle("Production Run Calculator");
    const heading = page.getByRole("heading", {
      name: "Sign in to Run Calculator",
      exact: true,
    });
    await expect(heading).toBeVisible();

    const refresh = await page.reload({ waitUntil: "domcontentloaded" });
    expect(refresh?.status(), "Caddy should serve the saved route on refresh").toBe(200);
    expect(refresh?.headers()["content-type"]).toContain("text/html");
    await expect(page).toHaveURL(/\/sign-in$/);
    await expect(page).toHaveTitle("Production Run Calculator");
    await expect(heading).toBeVisible();
  });
});

test("serves and mounts the calculator and reaches the same-origin API", async ({
  page,
}, testInfo) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  const navigation = await page.goto("/", { waitUntil: "domcontentloaded" });
  expect(navigation?.status(), "Caddy should serve the calculator document").toBe(200);
  await expect(page).toHaveTitle("Production Run Calculator");

  const root = page.locator("#root");
  await expect(root).toBeVisible();
  await expect
    .poll(() => root.evaluate((element) => element.childElementCount), {
      message: "The React calculator should mount inside #root",
    })
    .toBeGreaterThan(0);

  const pageOrigin = new URL(page.url()).origin;
  const apiResult = await page.evaluate(async () => {
    const response = await fetch("/api/readyz", { cache: "no-store" });
    return {
      url: response.url,
      status: response.status,
      contentType: response.headers.get("content-type"),
      body: await response.json() as {
        status?: string;
        checks?: {
          process?: string;
          database?: string;
          dependencies?: string;
        };
      },
    };
  });

  expect(new URL(apiResult.url).origin, "The API call should stay same-origin").toBe(
    pageOrigin,
  );
  expect(apiResult.status, "Caddy should proxy the API health request").toBe(200);
  expect(apiResult.contentType).toContain("application/json");
  expect(apiResult.body.status).toBe("ok");
  expect(apiResult.body.checks).toMatchObject({
    process: "ok",
    database: "ok",
    dependencies: "ok",
  });
  expect(pageErrors, "The calculator should not throw while mounting").toEqual([]);

  await testInfo.attach("docker-caddy-browser-context", {
    body: JSON.stringify(
      {
        browser: testInfo.project.name,
        viewport: page.viewportSize(),
        pageOrigin,
        apiStatus: apiResult.status,
      },
      null,
      2,
    ),
    contentType: "application/json",
  });
});
