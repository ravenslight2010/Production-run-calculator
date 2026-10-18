import type { ChildProcess } from "node:child_process";

type StopIsolatedSyncProcessOptions = {
  forceKillTimeoutMs?: number;
  postKillTimeoutMs?: number;
};

function signalFailure(
  signal: NodeJS.Signals,
  detail: string,
  cause?: unknown,
): Error {
  return new Error(
    `Failed to send ${signal} to isolated sync process during teardown: ${detail}. `
      + "Check that the test runner owns the child process and has permission to signal it.",
    cause === undefined ? undefined : { cause },
  );
}

function summarizeFailures(failures: unknown[], message: string): unknown {
  if (failures.length === 1) return failures[0];
  return new AggregateError(failures, message, { cause: failures[0] });
}

export async function stopIsolatedSyncProcess(
  child: ChildProcess,
  {
    forceKillTimeoutMs = 5_000,
    postKillTimeoutMs = 5_000,
  }: StopIsolatedSyncProcessOptions = {},
): Promise<void> {
  if (child.exitCode != null || child.signalCode != null) return;

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let lastSignal: NodeJS.Signals | null = null;
    const failures = new Map<NodeJS.Signals, Error>();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let postKillTimeout: ReturnType<typeof setTimeout> | undefined;
    let postKillTimeoutFailure: Error | undefined;
    let forceKillAttempted = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      if (timeout !== undefined) clearTimeout(timeout);
      if (postKillTimeout !== undefined) clearTimeout(postKillTimeout);
      child.off("exit", finish);
      child.off("close", finish);
      child.off("error", onError);
      if (postKillTimeoutFailure !== undefined) {
        const allFailures = [...failures.values(), postKillTimeoutFailure];
        reject(summarizeFailures(
          allFailures,
          "One or more errors occurred while stopping an isolated sync process",
        ));
      } else if (failures.size > 0) {
        reject(summarizeFailures(
          [...failures.values()],
          "One or more signals failed while stopping an isolated sync process",
        ));
      } else {
        resolve();
      }
    };
    const escalateAfterTermFailure = () => {
      if (forceKillAttempted || settled) return;
      forceKillAttempted = true;
      sendSignal("SIGKILL");
      finish();
    };
    const onError = (error: Error) => {
      const signal = lastSignal;
      if (signal === null) {
        failures.set("SIGTERM", signalFailure("SIGTERM", error.message, error));
        finish();
        return;
      }
      if (!failures.has(signal)) {
        failures.set(signal, signalFailure(signal, error.message, error));
      }
      if (signal === "SIGTERM") escalateAfterTermFailure();
      else finish();
    };
    const sendSignal = (signal: NodeJS.Signals) => {
      lastSignal = signal;
      try {
        if (!child.kill(signal) && !failures.has(signal)) {
          failures.set(signal, signalFailure(signal, "the child process rejected the kill attempt"));
        }
      } catch (error) {
        if (!failures.has(signal)) {
          failures.set(
            signal,
            signalFailure(
              signal,
              error instanceof Error ? error.message : String(error),
              error,
            ),
          );
        }
      }
      if (signal === "SIGTERM" && failures.has(signal)) {
        escalateAfterTermFailure();
      } else if (signal === "SIGKILL" && failures.has(signal)) {
        finish();
      }
      if (signal === "SIGKILL" && !failures.has(signal) && !settled) {
        postKillTimeout = setTimeout(() => {
          postKillTimeoutFailure = new Error(
            `Sent SIGKILL to isolated sync process during teardown, but it did not emit `
              + `an exit or close event within ${postKillTimeoutMs}ms. `
              + "Check for a stuck child process or a test-runner process-management issue.",
          );
          finish();
        }, postKillTimeoutMs);
      }
    };

    child.once("exit", finish);
    child.once("close", finish);
    child.on("error", onError);
    timeout = setTimeout(() => sendSignal("SIGKILL"), forceKillTimeoutMs);
    sendSignal("SIGTERM");
  });
}

export async function stopIsolatedSyncProcesses(
  children: readonly (ChildProcess | null | undefined)[],
): Promise<void> {
  const results = await Promise.allSettled(
    children.filter((child): child is ChildProcess => child != null)
      .map((child) => stopIsolatedSyncProcess(child)),
  );
  const failures = results
    .filter((result): result is PromiseRejectedResult => result.status === "rejected")
    .map((result) => result.reason);

  if (failures.length > 0) {
    throw summarizeFailures(
      failures,
      "Failed to stop one or more isolated sync processes",
    );
  }
}
