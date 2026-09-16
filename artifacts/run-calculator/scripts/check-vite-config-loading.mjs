import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "@workspace/typescript-api-v6";
import { loadConfigFromFile } from "vite";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(scriptDir, "../../..");

const CONFIG_FILES = [
  "artifacts/run-calculator/vite.config.ts",
  "artifacts/run-calculator/vitest.config.ts",
  "artifacts/mockup-sandbox/vite.config.ts",
];

const VITE_CONFIG_FILES = [
  "artifacts/run-calculator/vite.config.ts",
  "artifacts/mockup-sandbox/vite.config.ts",
];

const CONFIG_LOADERS = ["bundle", "runner", "native"];

export function findExtensionlessLocalImports(source) {
  return ts
    .preProcessFile(source, true, true)
    .importedFiles.map(({ fileName }) => fileName)
    .filter((specifier) => specifier.startsWith("."))
    .filter((specifier) => {
      const withoutQueryOrHash = specifier.split(/[?#]/, 1)[0];
      return path.posix.extname(withoutQueryOrHash) === "";
    });
}

export function checkExplicitLocalImportExtensions(configFiles = CONFIG_FILES) {
  const failures = [];

  for (const relativePath of configFiles) {
    const absolutePath = path.resolve(workspaceRoot, relativePath);
    const source = fs.readFileSync(absolutePath, "utf8");
    for (const specifier of findExtensionlessLocalImports(source)) {
      failures.push(`${relativePath}: "${specifier}"`);
    }
  }

  if (failures.length > 0) {
    throw new Error(
      [
        "Vite config files must use explicit extensions for local imports:",
        ...failures.map((failure) => `- ${failure}`),
      ].join("\n"),
    );
  }
}

async function checkConfigLoaders() {
  const previousEnvironment = {
    BASE_PATH: process.env.BASE_PATH,
    NODE_ENV: process.env.NODE_ENV,
    PORT: process.env.PORT,
  };

  process.env.BASE_PATH = "/";
  process.env.NODE_ENV = "production";
  process.env.PORT = "41799";

  try {
    for (const relativePath of VITE_CONFIG_FILES) {
      const absolutePath = path.resolve(workspaceRoot, relativePath);
      const configRoot = path.dirname(absolutePath);

      for (const loader of CONFIG_LOADERS) {
        const loaded = await loadConfigFromFile(
          {
            command: "build",
            mode: "production",
            isSsrBuild: false,
            isPreview: false,
          },
          absolutePath,
          configRoot,
          "silent",
          undefined,
          loader,
        );

        if (!loaded) {
          throw new Error(`${relativePath} did not load with Vite's ${loader} config loader.`);
        }
      }
    }
  } finally {
    for (const [key, value] of Object.entries(previousEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function runCli() {
  checkExplicitLocalImportExtensions();
  await checkConfigLoaders();
  console.log(
    `Vite config loading OK: ${CONFIG_FILES.length} config files checked for explicit local import extensions; ${VITE_CONFIG_FILES.length} Vite configs loaded with ${CONFIG_LOADERS.join(", ")}.`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await runCli();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}