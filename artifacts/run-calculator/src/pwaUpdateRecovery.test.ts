import { describe, expect, it, vi } from "vitest";

import { updateAndReload } from "./pwaUpdateRecovery";

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
    expect(activateWaitingWorker).toHaveBeenCalledWith(true);
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

    expect(activateWaitingWorker).toHaveBeenCalledWith(true);
    expect(reload).not.toHaveBeenCalled();
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
});