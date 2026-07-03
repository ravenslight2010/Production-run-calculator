// @vitest-environment node
//
// Guard for the mobile-web pop-up chain: RN Alert.alert is a silent no-op on
// Expo web, so notify.ts routes web dialogs through the WebDialogHost presenter
// registry (utils/webDialog.ts), falling back to window.alert / window.confirm
// only when no host is mounted. A refactor that breaks either link would make
// destructive confirmations (Undo, Delete run, Remove staff) silently do
// nothing in the browser again — this test pins the whole chain.
//
// Both modules sit behind the React Native import graph, so they are loaded
// via the strip-imports -> transpile -> temp-file pipeline documented in
// .agents/memory/web-test-harness.md. webDialog.ts (no imports) is included
// verbatim and notify.ts is stripped, concatenated into ONE module so
// notify's presentWebDialog IS the real registry the test registers into.
// Node env (the temp-file dynamic import doesn't resolve under jsdom); the
// browser globals notify.ts touches (window.alert / window.confirm) are
// stubbed onto globalThis, matching exactly how the code detects them.

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const MOBILE_UTILS = path.resolve(here, "../../run-calculator-mobile/utils");
const WEB_DIALOG_FILE = path.join(MOBILE_UTILS, "webDialog.ts");
const NOTIFY_FILE = path.join(MOBILE_UTILS, "notify.ts");

declare global {
  // eslint-disable-next-line no-var
  var __notifyAlertCalls: unknown[][] | undefined;
}

// Stubs for the symbols notify.ts imports from react-native. Platform.OS is
// "web" (the branch under test); Alert.alert records calls so we can assert
// the native path is never taken on web.
const STUB_PRELUDE = `
const Platform = { OS: "web" };
const Alert = {
  alert: (...args) => {
    (globalThis.__notifyAlertCalls ??= []).push(args);
  },
};
`;

let tempFile: string | null = null;

async function loadNotifyModule(): Promise<any> {
  const ts = (await import("typescript")).default;
  const webDialogRaw = fs.readFileSync(WEB_DIALOG_FILE, "utf8");
  const notifyRaw = fs.readFileSync(NOTIFY_FILE, "utf8");
  const notifyStripped = notifyRaw.replace(
    /import[\s\S]*?from\s*['"][^'"]*['"]\s*;?/g,
    "",
  );
  // webDialog.ts has no imports; keep it verbatim so notify's calls hit the
  // REAL presenter registry (same module scope).
  const source = STUB_PRELUDE + webDialogRaw + "\n" + notifyStripped;
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2020,
      isolatedModules: true,
    },
  });
  const out = path.join(
    os.tmpdir(),
    `mobileNotifyWebDialog.${process.pid}.${Date.now()}.mjs`,
  );
  fs.writeFileSync(out, outputText, "utf8");
  tempFile = out;
  return await import(pathToFileURL(out).href);
}

let mod: any;

beforeAll(async () => {
  mod = await loadNotifyModule();
  // Sanity: the combined module must expose the full chain, or the harness is
  // silently testing the wrong thing.
  expect(typeof mod.showNote).toBe("function");
  expect(typeof mod.showConfirm).toBe("function");
  expect(typeof mod.registerWebDialogPresenter).toBe("function");
  expect(typeof mod.presentWebDialog).toBe("function");
});

afterAll(() => {
  if (tempFile && fs.existsSync(tempFile)) fs.rmSync(tempFile);
});

let alertSpy: ReturnType<typeof vi.fn>;
let confirmSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  globalThis.__notifyAlertCalls = [];
  alertSpy = vi.fn();
  confirmSpy = vi.fn(() => true);
  (globalThis as any).window = { alert: alertSpy, confirm: confirmSpy };
});

afterAll(() => {
  delete (globalThis as any).window;
});

describe("with a WebDialogHost presenter registered", () => {
  it("showNote delivers the request to the presenter and never uses window.alert", () => {
    const seen: any[] = [];
    const unregister = mod.registerWebDialogPresenter((req: any) => seen.push(req));
    try {
      mod.showNote("Import finished", "3 runs added");
      expect(seen).toHaveLength(1);
      expect(seen[0]).toMatchObject({
        kind: "note",
        title: "Import finished",
        message: "3 runs added",
      });
      expect(alertSpy).not.toHaveBeenCalled();
      expect(confirmSpy).not.toHaveBeenCalled();
      expect(globalThis.__notifyAlertCalls).toHaveLength(0);
    } finally {
      unregister();
    }
  });

  it("showConfirm delivers the full request (title/message/confirmText/cancelText/destructive) and never uses window.confirm", () => {
    const seen: any[] = [];
    const unregister = mod.registerWebDialogPresenter((req: any) => seen.push(req));
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    try {
      mod.showConfirm({
        title: "Delete run?",
        message: "This cannot be undone.",
        confirmText: "Delete",
        cancelText: "Keep it",
        destructive: true,
        onConfirm,
        onCancel,
      });
      expect(seen).toHaveLength(1);
      const req = seen[0];
      expect(req).toMatchObject({
        kind: "confirm",
        title: "Delete run?",
        message: "This cannot be undone.",
        confirmText: "Delete",
        cancelText: "Keep it",
        destructive: true,
      });
      expect(confirmSpy).not.toHaveBeenCalled();
      expect(alertSpy).not.toHaveBeenCalled();
      // Neither callback fires until the host resolves the dialog...
      expect(onConfirm).not.toHaveBeenCalled();
      expect(onCancel).not.toHaveBeenCalled();
      // ...and the request carries the real callbacks for the host to invoke.
      req.onConfirm();
      expect(onConfirm).toHaveBeenCalledTimes(1);
      req.onCancel();
      expect(onCancel).toHaveBeenCalledTimes(1);
    } finally {
      unregister();
    }
  });

  it("unregistering the presenter restores the browser fallback (no silent drop)", () => {
    const presenter = vi.fn();
    const unregister = mod.registerWebDialogPresenter(presenter);
    unregister();
    mod.showNote("After unmount", "still visible");
    expect(presenter).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(alertSpy).toHaveBeenCalledWith("After unmount\n\nstill visible");
  });

  it("unregister only clears its own presenter, not a newer one", () => {
    const first = vi.fn();
    const second = vi.fn();
    const unregisterFirst = mod.registerWebDialogPresenter(first);
    const unregisterSecond = mod.registerWebDialogPresenter(second);
    // Stale unregister (e.g. old host unmounting late) must not kill the live host.
    unregisterFirst();
    mod.showNote("Note", "for the live host");
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
    expect(alertSpy).not.toHaveBeenCalled();
    unregisterSecond();
  });
});

describe("with no presenter registered (fallback path)", () => {
  it("showNote falls back to window.alert with title and message combined", () => {
    mod.showNote("Heads up", "Something happened");
    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(alertSpy).toHaveBeenCalledWith("Heads up\n\nSomething happened");
  });

  it("showNote without a message alerts just the title", () => {
    mod.showNote("Only title");
    expect(alertSpy).toHaveBeenCalledWith("Only title");
  });

  it("showConfirm falls back to window.confirm and fires onConfirm when accepted", () => {
    confirmSpy.mockReturnValue(true);
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    mod.showConfirm({
      title: "Remove staff member?",
      message: "They will lose access.",
      confirmText: "Remove",
      destructive: true,
      onConfirm,
      onCancel,
    });
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(confirmSpy).toHaveBeenCalledWith(
      "Remove staff member?\n\nThey will lose access.",
    );
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("showConfirm fires onCancel when the browser confirm is dismissed", () => {
    confirmSpy.mockReturnValue(false);
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    mod.showConfirm({
      title: "Undo change?",
      confirmText: "Undo",
      onConfirm,
      onCancel,
    });
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("never routes web pop-ups through native Alert.alert", () => {
    mod.showNote("A", "B");
    mod.showConfirm({ title: "C", confirmText: "OK", onConfirm: () => {} });
    expect(globalThis.__notifyAlertCalls).toHaveLength(0);
  });
});
