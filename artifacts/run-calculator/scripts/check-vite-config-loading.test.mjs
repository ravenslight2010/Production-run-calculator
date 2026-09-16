import assert from "node:assert/strict";
import test from "node:test";
import { findExtensionlessLocalImports } from "./check-vite-config-loading.mjs";

test("accepts explicit extensions on static, exported, and dynamic local imports", () => {
  const source = `
    import helper from "./helper.ts";
    export { plugin } from "../plugin.mjs";
    const lazy = import("./lazy.js");
  `;

  assert.deepEqual(findExtensionlessLocalImports(source), []);
});

test("rejects extensionless static, exported, and dynamic local imports", () => {
  const source = `
    import helper from "./helper";
    export { plugin } from "../plugin";
    const lazy = import("./lazy");
  `;

  assert.deepEqual(findExtensionlessLocalImports(source), [
    "./helper",
    "../plugin",
    "./lazy",
  ]);
});

test("ignores package imports", () => {
  const source = `
    import { defineConfig } from "vite";
    import react from "@vitejs/plugin-react";
  `;

  assert.deepEqual(findExtensionlessLocalImports(source), []);
});