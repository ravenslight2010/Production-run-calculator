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
export const STALE_ASSET_RELOAD_FALLBACK_MS = WORKER_INSTALL_TIMEOUT_MS + 1_000;
const STALE_ASSET_RECOVERY_PREFIX = "run-calc:stale-asset-recovery:";
const STALE_ASSET_RECOVERY_PENDING_KEY = "run-calc:stale-asset-recovery-pending:v1";
export const STALE_ASSET_RECOVERY_CONFIRMATION_WINDOW_MS = 30 * 60 * 1000;

type SessionStorageLike = Pick<Storage, "getItem" | "setItem"> & Partial<Pick<Storage, "removeItem">>;

function buildFingerprint(buildId: string): string {
  let hash = 2166136261;
  for (const char of buildId.slice(0, 100)) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0).toString(16);
}

function removePendingAttempt(storage: SessionStorageLike): void {
  if (storage.removeItem) storage.removeItem(STALE_ASSET_RECOVERY_PENDING_KEY);
  else storage.setItem(STALE_ASSET_RECOVERY_PENDING_KEY, "");
}

/**
 * Stores only a build fingerprint and timestamp so a later authenticated
 * startup can confirm whether this recovery actually entered a different build.
 */
export function recordStaleAssetRecoveryAttempt(
  buildId: string,
  storage: SessionStorageLike | undefined =
    typeof sessionStorage === "undefined" ? undefined : sessionStorage,
  now = Date.now(),
): boolean {
  if (!storage || !buildId.trim() || !Number.isSafeInteger(now)) return false;
  try {
    // Do not let a failed write leave an older recovery attempt eligible for
    // confirmation on the next startup.
    removePendingAttempt(storage);
    storage.setItem(STALE_ASSET_RECOVERY_PENDING_KEY, JSON.stringify({
      fromBuild: buildFingerprint(buildId),
      attemptedAt: now,
    }));
    return true;
  } catch {
    return false;
  }
}

/**
 * Consumes the one pending marker on the next authenticated startup. A same
 * build or expired marker is left unconfirmed rather than reported as failure.
 */
export function consumeStaleAssetRecoveryAttempt(
  buildId: string,
  storage: SessionStorageLike | undefined =
    typeof sessionStorage === "undefined" ? undefined : sessionStorage,
  now = Date.now(),
): boolean {
  if (!storage) return false;
  try {
    const raw = storage.getItem(STALE_ASSET_RECOVERY_PENDING_KEY);
    if (!raw) return false;
    removePendingAttempt(storage);
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
    const marker = parsed as { fromBuild?: unknown; attemptedAt?: unknown };
    if (Object.keys(marker).sort().join(",") !== "attemptedAt,fromBuild" ||
        typeof marker.fromBuild !== "string" || !/^[a-f0-9]{1,8}$/.test(marker.fromBuild) ||
        typeof marker.attemptedAt !== "number" ||
        !Number.isSafeInteger(marker.attemptedAt)) return false;
    const age = now - marker.attemptedAt;
    return age >= 0 && age <= STALE_ASSET_RECOVERY_CONFIRMATION_WINDOW_MS &&
      marker.fromBuild !== buildFingerprint(buildId);
  } catch {
    return false;
  }
}

/**
 * Allows one service-worker recovery attempt per failing build in a tab.
 * A second crash from the same bundle must leave recovery under the user's
 * control instead of automatically entering another update/reload cycle.
 */
export function claimStaleAssetRecoveryAttempt(
  buildId: string,
  storage: SessionStorageLike | undefined =
    typeof sessionStorage === "undefined" ? undefined : sessionStorage,
): boolean {
  if (!storage) return true;
  const key = `${STALE_ASSET_RECOVERY_PREFIX}${buildId}`;
  try {
    if (storage.getItem(key) === "1") return false;
    storage.setItem(key, "1");
    return true;
  } catch {
    // Storage may be unavailable in privacy modes. The user-click-only update
    // flow remains safer than refusing recovery altogether.
    return true;
  }
}

export async function clearStaleAppShellCaches(
  cacheStorage: Pick<CacheStorage, "keys" | "delete"> | undefined =
    typeof caches === "undefined" ? undefined : caches,
): Promise<void> {
  if (!cacheStorage) return;
  try {
    const keys = await cacheStorage.keys();
    await Promise.all(
      keys
        .filter((key) => key.startsWith("workbox-precache"))
        .map((key) => cacheStorage.delete(key)),
    );
  } catch {
    // Cache cleanup is best-effort; the worker update and network reload still
    // provide a recovery path when browser cache APIs are unavailable.
  }
}

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