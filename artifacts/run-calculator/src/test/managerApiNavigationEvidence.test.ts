import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";

it("bounds saved-copy bootstrap cancellation tracking before the first run action", () => {
  const source = readFileSync(
    resolve(process.cwd(), "e2e/home-deferred-panels.spec.ts"),
    "utf8",
  );
  const title = 'test("manager removes saved copies repeatedly without touching pending or active data"';
  const start = source.indexOf(title);
  expect(start).toBeGreaterThanOrEqual(0);
  const next = source.indexOf("\ntest(", start + title.length);
  const scenario = source.slice(start, next < 0 ? source.length : next);
  const opening = scenario.indexOf("markExpectedNavigation(true)");
  const navigation = scenario.indexOf('await page.goto("/",');
  const ready = scenario.indexOf(
    'await expect(page.getByTestId("button-start-run")).toBeEnabled()',
  );
  const closing = scenario.indexOf("markExpectedNavigation(false)");
  const action = scenario.indexOf(
    'await page.getByTestId("button-start-run").click()',
  );

  // Structural coverage of the test fixture, not a browser/removal pass.
  expect(opening).toBeGreaterThanOrEqual(0);
  expect(navigation).toBeGreaterThan(opening);
  expect(ready).toBeGreaterThan(navigation);
  expect(closing).toBeGreaterThan(ready);
  expect(action).toBeGreaterThan(closing);
});
