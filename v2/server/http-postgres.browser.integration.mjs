import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "../../node_modules/.pnpm/node_modules/playwright/index.mjs";
import { startV2Server } from "./main.mjs";

const MANAGER_USERNAME = "V2IntegrationManager";
const MANAGER_PASSWORD = "v2-test-manager-password";

async function main() {
  const databaseUrl = process.env.V2_DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("The disposable V2 PostgreSQL URL is required for browser integration.");
  }

  const errors = [];
  const failedResponses = [];
  let expectedInitialSessionChallenge = false;
  let serverInstance;
  let browser;
  const evidenceDir = join(tmpdir(), `v2-manager-inventory-${randomUUID()}`);
  try {
    await mkdir(evidenceDir, { recursive: true });
    serverInstance = await startV2Server({
      env: {
        ...process.env,
        NODE_ENV: "development",
        PORT: "0",
        V2_DATABASE_URL: databaseUrl,
      },
      logger: (entry) => {
        if (entry?.level === "error") errors.push("server emitted an error");
      },
    });

    const address = serverInstance.server.address();
    assert.ok(address && typeof address !== "string");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const browserPath = process.env.CHROMIUM_PATH
      || execFileSync("which", ["chromium"], { encoding: "utf8" }).trim();
    browser = await chromium.launch({
      headless: true,
      executablePath: browserPath,
      args: ["--no-sandbox"],
    });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() !== "error") return;
      if (expectedInitialSessionChallenge && message.text().includes("Failed to load resource")) {
        expectedInitialSessionChallenge = false;
        return;
      }
      errors.push(message.text());
    });
    page.on("response", (response) => {
      if (response.status() >= 400) {
        const url = new URL(response.url());
        failedResponses.push(`${response.status()} ${url.pathname}`);
        if (response.status() === 401 && url.pathname === "/api/v2/auth/session") {
          expectedInitialSessionChallenge = true;
        }
      }
    });

    await page.goto(baseUrl);
    await page.getByTestId("input-username").fill(MANAGER_USERNAME);
    await page.getByTestId("input-password").fill(MANAGER_PASSWORD);
    await page.getByTestId("button-sign-in").click();
    await page.locator("#authenticated-app:not([hidden])").waitFor();
    await page.locator("#manager-tools:not([hidden])").waitFor();
    await page.locator("#warehouse-select").waitFor({ state: "visible" });
    await page.waitForFunction(() => document.querySelectorAll("#warehouse-select option").length > 0);

    const suffix = randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase();
    const productCode = `UI${suffix}`;
    const productName = `Browser Test Product ${suffix}`;
    const firstWarehouse = `Browser Test Main ${suffix}`;
    const secondWarehouse = `Browser Test Overflow ${suffix}`;

    await page.locator("#import-kind").selectOption("products");
    await page.locator("#import-file").setInputFiles({
      name: "browser-test-products.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(`code,name,unit\n${productCode},${productName},each\n`),
    });
    await page.getByRole("button", { name: "Validate and review" }).click();
    await page.locator("#import-preview").getByText(`Staged · products`).waitFor();
    await page.locator("#import-preview").getByText(productCode, { exact: true }).waitFor();
    await page.getByRole("button", { name: "Apply reviewed import" }).click();
    await page.locator("#import-history").getByText("products · applied").first().waitFor();
    await page.waitForFunction((code) =>
      [...document.querySelectorAll("#movement-product option")].some((option) => option.value === code),
    productCode);

    async function createWarehouse(name) {
      await page.locator("#warehouse-name").fill(name);
      await page.getByRole("button", { name: "Add warehouse" }).click();
      await page.waitForFunction((label) =>
        [...document.querySelectorAll("#warehouse-select option")].some((option) => option.textContent === label),
      name);
      await page.locator("#warehouse-select").selectOption({ label: name });
    }

    async function applyOpeningCount(name, quantity) {
      await page.locator("#opening-warehouse").selectOption({
        label: name,
      });
      const productCodes = await page.locator("#movement-product option").evaluateAll((options) =>
        options.map((option) => option.value).filter(Boolean));
      assert.ok(productCodes.includes(productCode));
      const csv = [
        "product_code,quantity",
        ...productCodes.map((code) => `${code},${code === productCode ? quantity : "0"}`),
        "",
      ].join("\n");
      await page.locator("#opening-count-file").setInputFiles({
        name: "browser-test-physical-count.csv",
        mimeType: "text/csv",
        buffer: Buffer.from(csv),
      });
      await page.getByRole("button", { name: "Review physical count" }).click();
      await page.waitForFunction(() =>
        document.querySelector("#opening-count-preview")?.textContent?.includes("Physical count · staged") === true,
      null, { timeout: 10000 }).catch(async () => {
        throw new Error(JSON.stringify({
          openingCountMessage: await page.locator("#manager-error").textContent(),
          openingPreview: await page.locator("#opening-count-preview").textContent(),
          openingWarehouse: await page.locator("#opening-warehouse").inputValue(),
          selectedWarehouse: await page.locator("#warehouse-select").inputValue(),
          failedResponses,
        }));
      });
      await page.getByRole("button", { name: "Confirm count review" }).click();
      await page.locator("#opening-count-preview").getByText("Physical count · reviewed").waitFor();
      await page.getByRole("button", { name: "Apply opening count" }).click();
      await page.locator("#opening-count-preview").getByText("Physical count · applied").waitFor();
      await page.locator("#opening-count-history").getByText(`${name} · applied`).waitFor();
    }

    await createWarehouse(firstWarehouse);
    await applyOpeningCount(firstWarehouse, "12");
    await createWarehouse(secondWarehouse);
    await applyOpeningCount(secondWarehouse, "0");

    await page.locator("#production-warehouse-select").selectOption({ label: firstWarehouse });
    await page.getByRole("button", { name: "Set production warehouse" }).click();
    await page.locator("#production-warehouse-status")
      .getByText(`Production inventory will be deducted from ${firstWarehouse}.`).waitFor();

    await page.locator("#warehouse-select").selectOption({ label: firstWarehouse });
    await page.locator("#movement-product").selectOption(productCode);
    await page.waitForFunction(() => {
      const submit = document.querySelector("#movement-submit");
      return submit instanceof HTMLButtonElement && !submit.disabled;
    });
    await page.locator("#movement-quantity").fill("4");
    await page.locator("#movement-reason").fill(`Browser receipt ${suffix}`);
    await page.getByRole("button", { name: "Record stock change" }).click();
    await page.locator("#movement-history").getByText(`Browser receipt ${suffix}`).waitFor();
    await page.waitForFunction(() =>
      [...document.querySelectorAll("#stock-rows td")].some((cell) => cell.textContent === "16.000000"),
    null, { timeout: 7000 }).catch(async () => {
      throw new Error(JSON.stringify({
        inventoryMessage: await page.locator("#manager-error").textContent(),
        stock: await page.locator("#stock-rows").innerText(),
        selectedWarehouse: await page.locator("#warehouse-select").inputValue(),
        selectedProduct: await page.locator("#movement-product").inputValue(),
        submitDisabled: await page.locator("#movement-submit").isDisabled(),
        failedResponses,
      }));
    });

    await page.locator("#transfer-from").selectOption({ label: firstWarehouse });
    await page.locator("#transfer-to").selectOption({ label: secondWarehouse });
    await page.locator("#transfer-product").selectOption(productCode);
    await page.locator("#transfer-quantity").fill("2");
    await page.locator("#transfer-reason").fill(`Browser transfer ${suffix}`);
    await page.getByRole("button", { name: "Transfer stock" }).click();
    await page.locator("#movement-history").getByText(`Browser transfer ${suffix}`).waitFor();
    await page.locator("#stock-rows").getByText("14.000000", { exact: true }).waitFor();
    await page.screenshot({ path: join(evidenceDir, "manager-inventory-after-transfer.png"), fullPage: true });

    await page.locator("#warehouse-select").selectOption({ label: secondWarehouse });
    await page.locator("#stock-rows").getByText("2.000000", { exact: true }).waitFor();
    await page.reload();
    await page.locator("#manager-tools:not([hidden])").waitFor();
    await page.locator("#warehouse-select").selectOption({ label: secondWarehouse });
    await page.locator("#stock-rows").getByText("2.000000", { exact: true }).waitFor();
    await page.locator("#opening-count-history").getByText(`${secondWarehouse} · applied`).waitFor();
    await page.screenshot({ path: join(evidenceDir, "manager-inventory-after-reload.png"), fullPage: true });

    assert.deepEqual(errors, [], "manager inventory browser journey should have no browser or server errors");
    assert.deepEqual(failedResponses, ["401 /api/v2/auth/session"],
      "only the expected unauthenticated session challenge should be rejected");
    console.log("V2 authenticated Chromium inventory journey passed: product import, reviewed opening counts, warehouse assignment, receipt, transfer, and reload persistence.");
  } finally {
    if (browser) await browser.close();
    if (serverInstance) await serverInstance.close();
    await rm(evidenceDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(JSON.stringify({
    event: "v2.http_postgres_browser_integration.failed",
    errorName: typeof error?.name === "string" ? error.name : "UnknownError",
    message: error instanceof Error ? error.message : "Browser integration assertion failed.",
  }));
  process.exitCode = 1;
});
