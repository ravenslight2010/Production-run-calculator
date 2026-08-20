/**
 * Periodically ask the browser whether the registered worker has changed.
 *
 * `registration.update()` only discovers a newer worker. It deliberately does
 * not message a waiting worker or reload the page; those are reserved for the
 * explicit "Reload now" action in AppUpdatePrompt.
 */
export const SERVICE_WORKER_UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1000;

type UpdateableServiceWorkerRegistration = Pick<
  ServiceWorkerRegistration,
  "update"
>;

function isPageVisible() {
  return typeof document === "undefined" || document.visibilityState !== "hidden";
}

export function startServiceWorkerUpdateChecks(
  registration: UpdateableServiceWorkerRegistration,
  intervalMs = SERVICE_WORKER_UPDATE_CHECK_INTERVAL_MS,
) {
  let stopped = false;

  const checkForUpdate = () => {
    if (stopped || !isPageVisible()) return;

    // A failed background check is non-disruptive: the existing worker and
    // staff's current work remain usable, and a later check can try again.
    try {
      void registration.update().catch(() => undefined);
    } catch {
      // Some browser implementations can reject synchronously while shutting
      // down a worker. Treat that exactly like an asynchronous failed check.
    }
  };

  const checkWhenForegrounded = () => {
    checkForUpdate();
  };

  // Check once when the PWA registration is ready, whenever the app returns
  // to the foreground, and while a visible session stays open.
  checkForUpdate();
  document.addEventListener("visibilitychange", checkWhenForegrounded);
  window.addEventListener("focus", checkWhenForegrounded);
  const intervalId = window.setInterval(checkForUpdate, intervalMs);

  return () => {
    stopped = true;
    window.clearInterval(intervalId);
    document.removeEventListener("visibilitychange", checkWhenForegrounded);
    window.removeEventListener("focus", checkWhenForegrounded);
  };
}