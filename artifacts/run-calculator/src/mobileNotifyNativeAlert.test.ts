// @vitest-environment node
//
// Guard for the NATIVE phone branch of the mobile pop-up helpers: on iOS and
// Android, showNote/showConfirm route through React Native's Alert.alert with
// a two-button layout (Cancel first, action second, red when destructive).
// The mobile-web chain is pinned by mobileNotifyWebDialog.test.ts, but a
// refactor could swap the native button wiring so "Delete" silently cancels
// (or vice versa) without any web test noticing — this test pins the native
// call shape.
//
// notify.ts sits behind the React Native import graph, so it is loaded via
// the strip-imports -> transpile -> temp-file pipeline documented in
// .agents/memory/web-test-harness.md (same pattern as
// mobileNotifyWebDialog.test.ts). Platform.OS is stubbed to "ios" so the
// native branch runs; presentWebDialog is stubbed to a recorder so we can
// assert the web presenter registry is never touched on native.

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const MOBILE_UTILS = path.resolve(here, "../../run-calculator-mobile/utils");
const NOTIFY_FILE = path.join(MOBILE_UTILS, "notify.ts");

declare global {
  // eslint-disable-next-line no-var
  var __nativeAlertCalls: unknown[][] | undefined;
  // eslint-disable-next-line no-var
  var __nativePresentCalls: unknown[][] | undefined;
}

// Stubs for the symbols notify.ts imports. Platform.OS is "ios" (the native
// branch under test); Alert.alert records every call so the test can assert
// the exact title/message/buttons shape; presentWebDialog records calls and
// returns false so any accidental web-branch entry is visible.
const STUB_PRELUDE = `
const Platform = { OS: "ios" };
const Alert = {
  alert: (...args) => {
    (globalThis.__nativeAlertCalls ??= []).push(args);
  },
};
const presentWebDialog = (...args) => {
  (globalThis.__nativePresentCalls ??= []).push(args);
  return false;
};
`;

let tempFile: string | null = null;

async function loadNotifyModule(): Promise<any> {
  const ts = (await import("typescript")).default;
  const notifyRaw = fs.readFileSync(NOTIFY_FILE, "utf8");
  const notifyStripped = notifyRaw.replace(
    /import[\s\S]*?from\s*['"][^'"]*['"]\s*;?/g,
    "",
  );
  const source = STUB_PRELUDE + notifyStripped;
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2020,
      isolatedModules: true,
    },
  });
  const out = path.join(
    os.tmpdir(),
    `mobileNotifyNativeAlert.${process.pid}.${Date.now()}.mjs`,
  );
  fs.writeFileSync(out, outputText, "utf8");
  tempFile = out;
  return await import(pathToFileURL(out).href);
}

let mod: any;

beforeAll(async () => {
  mod = await loadNotifyModule();
  // Sanity: the harness must expose the real helpers, or the assertions below
  // are silently testing the wrong thing.
  expect(typeof mod.showNote).toBe("function");
  expect(typeof mod.showConfirm).toBe("function");
});

afterAll(() => {
  if (tempFile && fs.existsSync(tempFile)) fs.rmSync(tempFile);
});

beforeEach(() => {
  globalThis.__nativeAlertCalls = [];
  globalThis.__nativePresentCalls = [];
});

function lastAlertCall(): any[] {
  const calls = globalThis.__nativeAlertCalls ?? [];
  expect(calls).toHaveLength(1);
  return calls[0] as any[];
}

describe("native showNote", () => {
  it("calls Alert.alert(title, message) and never touches the web dialog chain", () => {
    mod.showNote("Import finished", "3 runs added");
    const call = lastAlertCall();
    expect(call[0]).toBe("Import finished");
    expect(call[1]).toBe("3 runs added");
    // No button array on a plain note.
    expect(call.length).toBeLessThanOrEqual(2);
    expect(globalThis.__nativePresentCalls).toHaveLength(0);
  });

  it("passes an undefined message through untouched", () => {
    mod.showNote("Only title");
    const call = lastAlertCall();
    expect(call[0]).toBe("Only title");
    expect(call[1]).toBeUndefined();
  });
});

describe("native showConfirm", () => {
  it("builds a two-button Alert: cancel first (style cancel, fires onCancel), action second (fires onConfirm)", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    mod.showConfirm({
      title: "Delete run?",
      message: "This cannot be undone.",
      confirmText: "Delete",
      cancelText: "Keep it",
      destructive: true,
      onConfirm,
      onCancel,
    });
    const [title, message, buttons] = lastAlertCall();
    expect(title).toBe("Delete run?");
    expect(message).toBe("This cannot be undone.");
    expect(Array.isArray(buttons)).toBe(true);
    expect(buttons).toHaveLength(2);

    const [cancelBtn, actionBtn] = buttons;
    expect(cancelBtn.text).toBe("Keep it");
    expect(cancelBtn.style).toBe("cancel");
    expect(actionBtn.text).toBe("Delete");
    expect(actionBtn.style).toBe("destructive");

    // The wiring is the whole point: pressing the action button must fire
    // onConfirm (not onCancel) and vice versa.
    actionBtn.onPress();
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
    cancelBtn.onPress();
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledTimes(1);

    expect(globalThis.__nativePresentCalls).toHaveLength(0);
  });

  it('defaults the cancel button text to "Cancel" and tolerates a missing onCancel', () => {
    const onConfirm = vi.fn();
    mod.showConfirm({
      title: "Undo change?",
      confirmText: "Undo",
      onConfirm,
    });
    const [, , buttons] = lastAlertCall();
    const [cancelBtn, actionBtn] = buttons;
    expect(cancelBtn.text).toBe("Cancel");
    expect(cancelBtn.style).toBe("cancel");
    // Pressing cancel with no onCancel must not throw (Alert passes onPress
    // straight through, so undefined is acceptable; calling it if defined
    // must be safe).
    expect(() => cancelBtn.onPress?.()).not.toThrow();
    expect(actionBtn.text).toBe("Undo");
    actionBtn.onPress();
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('uses style "default" (not destructive) when destructive is not set', () => {
    mod.showConfirm({
      title: "Save profile?",
      confirmText: "Save",
      onConfirm: () => {},
    });
    const [, , buttons] = lastAlertCall();
    expect(buttons[1].style).toBe("default");
  });

  it("keeps destructive:false non-red", () => {
    mod.showConfirm({
      title: "Archive?",
      confirmText: "Archive",
      destructive: false,
      onConfirm: () => {},
    });
    const [, , buttons] = lastAlertCall();
    expect(buttons[1].style).toBe("default");
  });
});
