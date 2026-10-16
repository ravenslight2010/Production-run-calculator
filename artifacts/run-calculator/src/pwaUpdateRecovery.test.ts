import { describe, expect, it, vi } from "vitest";

import {
  claimStaleAssetRecoveryAttempt,
  clearStaleAppShellCaches,
  consumeStaleAssetRecoveryAttempt,
  recordStaleAssetRecoveryAttempt,
  STALE_ASSET_RECOVERY_CONFIRMATION_WINDOW_MS,
  WORKER_INSTALL_TIMEOUT_MS,
  updateAndReload,
} from "./pwaUpdateRecovery";

describe("claimStaleAssetRecoveryAttempt", () => {
  it("allows one attempt per build while allowing a new build to recover", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
    };

    expect(claimStaleAssetRecoveryAttempt("old-build", storage)).toBe(true);
    expect(claimStaleAssetRecoveryAttempt("old-build", storage)).toBe(false);
    expect(claimStaleAssetRecoveryAttempt("new-build", storage)).toBe(true);
  });
});

describe("stale-asset recovery evidence", () => {
  it("stores only a bounded fingerprint and confirms only a timely different-build startup", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
      removeItem: (key: string) => void values.delete(key),
    };
    const attemptedAt = 100_000;

    expect(recordStaleAssetRecoveryAttempt("old-build", storage, attemptedAt)).toBe(true);
    const raw = values.get("run-calc:stale-asset-recovery-pending:v1")!;
    expect(raw).not.toContain("old-build");
    expect(JSON.parse(raw)).toEqual({ fromBuild: expect.stringMatching(/^[a-f0-9]{1,8}$/), attemptedAt });
    expect(consumeStaleAssetRecoveryAttempt("old-build", storage, attemptedAt + 1000)).toBe(false);
    expect(values.has("run-calc:stale-asset-recovery-pending:v1")).toBe(false);

    recordStaleAssetRecoveryAttempt("old-build", storage, attemptedAt);
    expect(consumeStaleAssetRecoveryAttempt("new-build", storage, attemptedAt + 1000)).toBe(true);
  });

  it("leaves an expired or unavailable update outcome unconfirmed", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
      removeItem: (key: string) => void values.delete(key),
    };
    recordStaleAssetRecoveryAttempt("old-build", storage, 10_000);
    expect(consumeStaleAssetRecoveryAttempt(
      "new-build", storage, 10_000 + STALE_ASSET_RECOVERY_CONFIRMATION_WINDOW_MS + 1,
    )).toBe(false);
  });

  it("clears an older marker when recording fails and keeps the user-directed reload available", async () => {
    const key = "run-calc:stale-asset-recovery-pending:v1";
    const values = new Map<string, string>();
    const storage = {
      getItem: (storageKey: string) => values.get(storageKey) ?? null,
      setItem: (storageKey: string, value: string) => {
        if (storageKey === key) throw new Error("session storage is unavailable");
        values.set(storageKey, value);
      },
      removeItem: (storageKey: string) => void values.delete(storageKey),
    };
    values.set(key, JSON.stringify({ fromBuild: "1234", attemptedAt: 100_000 }));

    expect(recordStaleAssetRecoveryAttempt("new-build", storage, 101_000)).toBe(false);
    expect(values.has(key)).toBe(false);

    const reload = vi.fn();
    await updateAndReload(undefined, undefined, reload);
    expect(reload).toHaveBeenCalledOnce();
  });

  it("does not confirm a marker when reading or removing it throws", () => {
    const key = "run-calc:stale-asset-recovery-pending:v1";
    const marker = JSON.stringify({ fromBuild: "1234", attemptedAt: 100_000 });
    const unreadableStorage = {
      getItem: () => { throw new Error("session storage is unavailable"); },
      setItem: vi.fn(),
      removeItem: vi.fn(),
    };
    const unremovableStorage = {
      getItem: () => marker,
      setItem: vi.fn(),
      removeItem: () => { throw new Error("session storage is unavailable"); },
    };

    expect(consumeStaleAssetRecoveryAttempt("new-build", unreadableStorage, 101_000)).toBe(false);
    expect(consumeStaleAssetRecoveryAttempt("new-build", unremovableStorage, 101_000)).toBe(false);
    expect(unremovableStorage.getItem(key)).toBe(marker);
  });
});

describe("clearStaleAppShellCaches", () => {
  it("resolves safely when CacheStorage is unavailable", async () => {
    await expect(clearStaleAppShellCaches(undefined)).resolves.toBeUndefined();
  });

  it("removes precached app shells without deleting unrelated runtime caches", async () => {
    const remove = vi.fn().mockResolvedValue(true);
    await clearStaleAppShellCaches({
      keys: vi.fn().mockResolvedValue([
        "workbox-precache-v2-http://app.test/",
        "google-fonts-cache",
      ]),
      delete: remove,
    });

    expect(remove).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledWith("workbox-precache-v2-http://app.test/");
  });

  it("resolves safely when cache-key reads are rejected", async () => {
    const remove = vi.fn();

    await expect(clearStaleAppShellCaches({
      keys: vi.fn().mockRejectedValue(new Error("cache keys unavailable")),
      delete: remove,
    })).resolves.toBeUndefined();

    expect(remove).not.toHaveBeenCalled();
  });

  it("resolves safely when deleting app-shell caches is rejected without touching runtime caches", async () => {
    const remove = vi.fn().mockRejectedValue(new Error("cache deletion unavailable"));

    await expect(clearStaleAppShellCaches({
      keys: vi.fn().mockResolvedValue([
        "workbox-precache-v2-http://app.test/",
        "google-fonts-cache",
      ]),
      delete: remove,
    })).resolves.toBeUndefined();

    expect(remove).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledWith("workbox-precache-v2-http://app.test/");
    expect(remove).not.toHaveBeenCalledWith("google-fonts-cache");
  });
});

describe("updateAndReload", () => {
  it("checks, activates, and reloads only after the recovery action is chosen", async () => {
    const activateWaitingWorker = vi.fn().mockResolvedValue(undefined);
    const reload = vi.fn();
    const registration = {
      waiting: undefined as ServiceWorker | undefined,
      update: vi.fn(async () => {
        registration.waiting = {} as ServiceWorker;
      }),
    };

    await updateAndReload(registration, activateWaitingWorker, reload);

    expect(registration.update).toHaveBeenCalledOnce();
    expect(activateWaitingWorker).toHaveBeenCalledWith(false, expect.any(Function));
    expect(reload).not.toHaveBeenCalled();
  });

  it("waits for an installing worker to reach installed before activating it", async () => {
    const activateWaitingWorker = vi.fn().mockResolvedValue(undefined);
    const reload = vi.fn();
    const stateListeners = new Set<() => void>();
    const worker = {
      state: "installing" as ServiceWorkerState,
      addEventListener: (_type: "statechange", listener: () => void) => {
        stateListeners.add(listener);
      },
      removeEventListener: (_type: "statechange", listener: () => void) => {
        stateListeners.delete(listener);
      },
    };
    const registration = {
      waiting: undefined as ServiceWorker | undefined,
      installing: worker as unknown as ServiceWorker,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      update: vi.fn().mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
        worker.state = "installed";
        registration.waiting = worker as unknown as ServiceWorker;
        for (const listener of stateListeners) listener();
      }),
    };

    const recovery = updateAndReload(registration, activateWaitingWorker, reload);
    expect(activateWaitingWorker).not.toHaveBeenCalled();
    await recovery;

    expect(activateWaitingWorker).toHaveBeenCalledWith(false, expect.any(Function));
    expect(reload).not.toHaveBeenCalled();
  });

  it("falls back to reload when an installing worker never settles", async () => {
    vi.useFakeTimers();
    try {
      const reload = vi.fn();
      const activateWaitingWorker = vi.fn();
      const stateListeners = new Set<() => void>();
      const worker = {
        state: "installing" as ServiceWorkerState,
        addEventListener: (_type: "statechange", listener: () => void) => {
          stateListeners.add(listener);
        },
        removeEventListener: (_type: "statechange", listener: () => void) => {
          stateListeners.delete(listener);
        },
      };
      const registration = {
        waiting: undefined as ServiceWorker | undefined,
        installing: worker as unknown as ServiceWorker,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        update: vi.fn().mockResolvedValue(undefined),
      };

      const recovery = updateAndReload(registration, activateWaitingWorker, reload);
      await vi.advanceTimersByTimeAsync(0);

      expect(vi.getTimerCount()).toBe(1);
      expect(reload).not.toHaveBeenCalled();
      expect(stateListeners.size).toBe(1);

      await vi.advanceTimersByTimeAsync(WORKER_INSTALL_TIMEOUT_MS);
      await recovery;

      expect(activateWaitingWorker).not.toHaveBeenCalled();
      expect(reload).toHaveBeenCalledOnce();
      expect(stateListeners.size).toBe(0);
      expect(registration.removeEventListener).toHaveBeenCalledOnce();
      expect(registration.removeEventListener).toHaveBeenCalledWith("updatefound", expect.any(Function));
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("falls back to reload when an installing worker fails and becomes redundant", async () => {
    const reload = vi.fn();
    const stateListeners = new Set<() => void>();
    const worker = {
      state: "installing" as ServiceWorkerState,
      addEventListener: (_type: "statechange", listener: () => void) => {
        stateListeners.add(listener);
      },
      removeEventListener: (_type: "statechange", listener: () => void) => {
        stateListeners.delete(listener);
      },
    };
    const registration = {
      waiting: undefined as ServiceWorker | undefined,
      installing: worker as unknown as ServiceWorker,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      update: vi.fn().mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
        worker.state = "redundant";
        for (const listener of stateListeners) listener();
      }),
    };
    const activateWaitingWorker = vi.fn();

    await updateAndReload(registration, activateWaitingWorker, reload);

    expect(activateWaitingWorker).not.toHaveBeenCalled();
    expect(reload).toHaveBeenCalledOnce();
  });

  it("uses a normal reload when there is no registration or waiting update", async () => {
    const activateWaitingWorker = vi.fn();
    const reloadWithoutRegistration = vi.fn();
    const reloadWithoutWaitingWorker = vi.fn();

    await updateAndReload(undefined, activateWaitingWorker, reloadWithoutRegistration);
    await updateAndReload(
      { update: vi.fn().mockResolvedValue(undefined), waiting: undefined },
      activateWaitingWorker,
      reloadWithoutWaitingWorker,
    );

    expect(activateWaitingWorker).not.toHaveBeenCalled();
    expect(reloadWithoutRegistration).toHaveBeenCalledOnce();
    expect(reloadWithoutWaitingWorker).toHaveBeenCalledOnce();
  });

  it("falls back to a normal reload if checking or activating an update fails", async () => {
    const reload = vi.fn();
    const registration = {
      waiting: {} as ServiceWorker,
      update: vi.fn().mockRejectedValue(new Error("worker unavailable")),
    };

    await updateAndReload(registration, vi.fn().mockRejectedValue(new Error("activation failed")), reload);

    expect(reload).toHaveBeenCalledOnce();
  });

  it("cancels an automatic handoff if the calculator becomes unsafe during the update check", async () => {
    let finishUpdate: (() => void) | undefined;
    let safe = true;
    const reload = vi.fn();
    const activateWaitingWorker = vi.fn();
    const registration = {
      waiting: undefined as ServiceWorker | undefined,
      update: vi.fn(() => new Promise<void>((resolve) => {
        finishUpdate = () => {
          registration.waiting = {} as ServiceWorker;
          resolve();
        };
      })),
    };

    const recovery = updateAndReload(
      registration,
      activateWaitingWorker,
      reload,
      () => safe,
    );
    await Promise.resolve();
    safe = false;
    finishUpdate?.();
    await recovery;

    expect(activateWaitingWorker).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it("keeps the safety guard live while a waiting worker activates", async () => {
    let activationGuard: (() => boolean) | undefined;
    let safe = true;
    const reload = vi.fn();
    const activateWaitingWorker = vi.fn(
      (_reloadPage: boolean, canReload: () => boolean) => {
        activationGuard = canReload;
      },
    );

    await updateAndReload(
      {
        waiting: {} as ServiceWorker,
        update: vi.fn().mockResolvedValue(undefined),
      },
      activateWaitingWorker,
      reload,
      () => safe,
    );
    safe = false;

    expect(activationGuard?.()).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });
});
