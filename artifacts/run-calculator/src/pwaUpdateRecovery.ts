type WaitingServiceWorkerRegistration = Pick<
  ServiceWorkerRegistration,
  "update" | "waiting"
> & {
  installing?: ServiceWorker | null;
  addEventListener?: ServiceWorkerRegistration["addEventListener"];
  removeEventListener?: ServiceWorkerRegistration["removeEventListener"];
};

type CanReload = () => boolean;
type ActivateWaitingWorker = (
  reloadPage?: boolean,
  canReload?: CanReload,
) => Promise<void> | void;

export const WORKER_INSTALL_TIMEOUT_MS = 5_000;

function waitForInstalledWorker(
  registration: WaitingServiceWorkerRegistration,
  updatePromise: Promise<unknown>,
): Promise<boolean> {
  return new Promise((resolve) => {
    let updateFinished = false;
    let settled = false;
    let observedWorker: ServiceWorker | null = null;
    let onWorkerStateChange: (() => void) | undefined;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const cleanup = () => {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      if (onWorkerStateChange && observedWorker) {
        observedWorker.removeEventListener("statechange", onWorkerStateChange);
      }
      registration.removeEventListener?.("updatefound", onUpdateFound);
    };

    const finish = (canActivate: boolean) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(canActivate);
    };

    const inspect = () => {
      if (registration.waiting) {
        finish(true);
        return;
      }

      const installing = registration.installing;
      if (installing && installing !== observedWorker) {
        if (onWorkerStateChange && observedWorker) {
          observedWorker.removeEventListener("statechange", onWorkerStateChange);
        }
        observedWorker = installing;
        onWorkerStateChange = inspect;
        installing.addEventListener("statechange", onWorkerStateChange);
      }

      if (installing?.state === "installed") {
        finish(true);
      } else if (updateFinished) {
        if (!installing || installing.state === "redundant") {
          finish(false);
        } else if (timeoutId === undefined) {
          // An install that never settles must not strand staff on the error
          // screen. The timeout only starts after the update check is done.
          timeoutId = setTimeout(
            () => finish(Boolean(registration.waiting)),
            WORKER_INSTALL_TIMEOUT_MS,
          );
        }
      }
    };

    const onUpdateFound = () => inspect();
    registration.addEventListener?.("updatefound", onUpdateFound);

    void updatePromise.then(
      () => {
        updateFinished = true;
        inspect();
      },
      () => {
        updateFinished = true;
        inspect();
      },
    );
    inspect();
  });
}

/**
 * Try to hand the page over to a newly installed worker, falling back to a
 * regular reload when this browser has no usable PWA update mechanism.
 *
 * This function is intentionally action-driven: callers invoke it only from a
 * user click. `registration.update()` discovers and installs an update but
 * does not itself activate a worker or reload the page.
 */
export async function updateAndReload(
  registration: WaitingServiceWorkerRegistration | undefined,
  activateWaitingWorker: ActivateWaitingWorker | undefined,
  reload: () => void,
  canReload: CanReload = () => true,
): Promise<void> {
  if (!registration) {
    if (canReload()) reload();
    return;
  }

  const updatePromise = Promise.resolve().then(() => registration.update());
  const canActivateWaitingWorker = await waitForInstalledWorker(
    registration,
    updatePromise,
  );

  if (
    canReload()
    && canActivateWaitingWorker
    && registration.waiting
    && activateWaitingWorker
  ) {
    try {
      // The PWA registration owns the eventual "controlling" event. Give that
      // event the live guard so it, rather than update detection, owns the only
      // reload and can cancel if work becomes unsafe during activation.
      await activateWaitingWorker(false, canReload);
      return;
    } catch {
      // If activation fails, give the user the browser's normal reload path.
    }
  }

  if (canReload()) reload();
}