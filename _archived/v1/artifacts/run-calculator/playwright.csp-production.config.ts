import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { defineConfig, devices } from "@playwright/test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { resolveChromiumExecutable } from "./e2e/chromium";
import { webkitLaunchOptions } from "./e2e/webkit-runtime";

const apiPort = process.env.RELEASE_BROWSER_API_PORT ?? "18083";
const tlsPort = process.env.RELEASE_BROWSER_WEB_PORT ?? "18084";
const baseURL = `https://127.0.0.1:${tlsPort}`;
const inheritedTlsAssetsDirectory = process.env.CSP_TLS_ASSET_DIRECTORY;
const ownsTlsAssets = !inheritedTlsAssetsDirectory;
const tlsAssetsDirectory =
  inheritedTlsAssetsDirectory ??
  mkdtempSync(path.join(tmpdir(), "csp-production-browser-ca-"));
const caKeyPath = path.join(tlsAssetsDirectory, "test-ca.key");
const caCertificatePath = path.join(tlsAssetsDirectory, "test-ca.crt");
const leafKeyPath = path.join(tlsAssetsDirectory, "localhost.key");
const leafRequestPath = path.join(tlsAssetsDirectory, "localhost.csr");
const leafExtensionsPath = path.join(tlsAssetsDirectory, "localhost.ext");
const leafCertificatePath = path.join(tlsAssetsDirectory, "localhost.crt");
const trustedBundlePath = path.join(tlsAssetsDirectory, "trusted-ca-bundle.pem");
let chromiumCertificatePin = process.env.CSP_TLS_EXPECTED_SPKI ?? "";
const systemCaPath = [
  process.env.SSL_CERT_FILE,
  process.env.NIX_SSL_CERT_FILE,
  "/etc/ssl/certs/ca-certificates.crt",
  "/etc/pki/tls/certs/ca-bundle.crt",
].find((candidate) => candidate && existsSync(candidate));

if (!systemCaPath) {
  throw new Error("A system CA bundle is required for the disposable CSP browser harness.");
}

try {
  if (ownsTlsAssets) {
    execFileSync(
      "openssl",
      [
        "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-sha256", "-days", "1",
        "-keyout", caKeyPath, "-out", caCertificatePath,
        "-subj", `/CN=CSP browser test CA ${process.pid}`,
        "-addext", "basicConstraints=critical,CA:TRUE",
        "-addext", "keyUsage=critical,keyCertSign,cRLSign",
      ],
      { stdio: "ignore" },
    );
    execFileSync(
      "openssl",
      [
        "req", "-new", "-newkey", "rsa:2048", "-nodes", "-sha256",
        "-keyout", leafKeyPath, "-out", leafRequestPath, "-subj", "/CN=localhost",
      ],
      { stdio: "ignore" },
    );
    writeFileSync(
      leafExtensionsPath,
      [
        "basicConstraints=critical,CA:FALSE",
        "keyUsage=critical,digitalSignature,keyEncipherment",
        "extendedKeyUsage=serverAuth",
        "subjectAltName=DNS:localhost,IP:127.0.0.1",
        "",
      ].join("\n"),
      { mode: 0o600 },
    );
    execFileSync(
      "openssl",
      [
        "x509", "-req", "-in", leafRequestPath, "-CA", caCertificatePath,
        "-CAkey", caKeyPath, "-CAcreateserial", "-out", leafCertificatePath,
        "-days", "1", "-sha256", "-extfile", leafExtensionsPath,
      ],
      { stdio: "ignore" },
    );
    chmodSync(caKeyPath, 0o600);
    chmodSync(leafKeyPath, 0o600);

    writeFileSync(
      trustedBundlePath,
      `${readFileSync(systemCaPath, "utf8").trim()}\n${readFileSync(caCertificatePath, "utf8")}`,
      { mode: 0o600 },
    );
    process.env.CSP_TLS_ASSET_DIRECTORY = tlsAssetsDirectory;
    process.env.CSP_TLS_CERT_PATH = leafCertificatePath;
    process.env.CSP_TLS_KEY_PATH = leafKeyPath;
    process.env.SSL_CERT_FILE = trustedBundlePath;
    process.env.NIX_SSL_CERT_FILE = trustedBundlePath;
    process.env.G_TLS_CA_FILE = trustedBundlePath;

    const publicKey = execFileSync(
      "openssl",
      ["x509", "-in", leafCertificatePath, "-pubkey", "-noout"],
      { encoding: "utf8" },
    );
    const publicKeyDer = execFileSync(
      "openssl",
      ["pkey", "-pubin", "-outform", "DER"],
      { input: publicKey },
    );
    chromiumCertificatePin = createHash("sha256")
      .update(publicKeyDer)
      .digest("base64");
    process.env.CSP_TLS_EXPECTED_SPKI = chromiumCertificatePin;
  } else if (
    !chromiumCertificatePin ||
    !existsSync(leafCertificatePath) ||
    !existsSync(leafKeyPath) ||
    !existsSync(trustedBundlePath)
  ) {
    throw new Error("The inherited CSP browser TLS assets are incomplete.");
  }
} catch (error) {
  if (ownsTlsAssets) rmSync(tlsAssetsDirectory, { recursive: true, force: true });
  throw error;
}

const cleanupTlsAssets = () => {
  if (ownsTlsAssets) rmSync(tlsAssetsDirectory, { recursive: true, force: true });
};
process.once("exit", cleanupTlsAssets);
const cspProductionServer =
  `cd ../../ && BUILD_IDENTITY_MODE=development ` +
  "pnpm --filter @workspace/run-calculator run build && " +
  "NODE_ENV=development pnpm --filter @workspace/api-server run build && " +
  `NODE_ENV=production PORT=${apiPort} CSP_TLS_PORT=${tlsPort} DATABASE_POOL_MAX=24 ` +
  "DISABLE_BACKGROUND_AUXILIARY_SCHEDULERS=1 " +
  "exec node artifacts/run-calculator/e2e/csp-production-server.mjs";
const apiHealthUrl = `http://127.0.0.1:${apiPort}/api/readyz`;

const viewports = {
  desktop: { width: 1440, height: 1000 },
  phone: { width: 390, height: 844 },
  "tablet-portrait": { width: 768, height: 1024 },
  "tablet-landscape": { width: 1024, height: 768 },
} as const;

export default defineConfig({
  testDir: "./e2e",
  testMatch: "csp-production.spec.ts",
  timeout: 120_000,
  globalTimeout: 30 * 60_000,
  retries: 0,
  workers: 1,
  fullyParallel: false,
  outputDir: "test-results/csp-production",
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report/csp-production", open: "never" }],
  ],
  use: {
    baseURL,
    headless: true,
    ignoreHTTPSErrors: false,
    trace: "retain-on-failure",
    screenshot: "off",
    video: "off",
  },
  webServer: {
    command: cspProductionServer,
    url: apiHealthUrl,
    reuseExistingServer: false,
    timeout: 300_000,
  },
  projects: [
    ...Object.entries(viewports).map(([name, viewport]) => ({
      name: `${name}-chromium`,
      use: {
        ...devices["Desktop Chrome"],
        viewport,
        launchOptions: {
          executablePath: resolveChromiumExecutable(),
          args: [`--ignore-certificate-errors-spki-list=${chromiumCertificatePin}`],
        },
      },
    })),
    ...Object.entries(viewports).map(([name, viewport]) => ({
      name: `${name}-webkit`,
      use: {
        ...devices["Desktop Safari"],
        viewport,
        launchOptions: webkitLaunchOptions(),
      },
    })),
  ],
});
