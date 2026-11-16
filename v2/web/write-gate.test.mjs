import assert from "node:assert/strict";
import test from "node:test";
import { canWriteRunState } from "./write-gate.mjs";

test("run-state writes require authentication, connectivity, and a fresh server confirmation", () => {
  assert.equal(canWriteRunState({ authenticated: false, online: true, serverStateConfirmed: true }), false);
  assert.equal(canWriteRunState({ authenticated: true, online: false, serverStateConfirmed: true }), false);
  assert.equal(canWriteRunState({ authenticated: true, online: true, serverStateConfirmed: false }), false);
  assert.equal(canWriteRunState({ authenticated: true, online: true, serverStateConfirmed: true }), true);
});
