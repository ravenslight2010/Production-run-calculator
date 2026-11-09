#!/usr/bin/env node
/**
 * Exit 0 (skip) when CI_PUBLIC_SOURCE is set and the reviewed source-library
 * reconciliation assets are not present. Used by routine scripts tests so
 * public/main CI can stay green without private attached_assets.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const publicCi =
  process.env.CI_PUBLIC_SOURCE === "1" || process.env.CI_PUBLIC_SOURCE === "true";
const report = path.join(
  root,
  "attached_assets/source-library/audits/source-library-reconciliation-2026-08-26.json",
);

if (publicCi && !existsSync(report)) {
  console.log(
    "skip: CI_PUBLIC_SOURCE without source-library reconciliation assets",
  );
  process.exit(0);
}
process.exit(1); // signal caller to run the real test
