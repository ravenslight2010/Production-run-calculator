import type { ChildProcess } from "node:child_process";

type StopIsolatedSyncProcessOptions = {
  forceKillTimeoutMs?: number;
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
  { forceKillTimeoutMs = 5_000 }: StopIsolatedSyncProcessOptions = {},
): Promise<void> {
  if (child.exitCode != null || child.signalCode != null) return;

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let lastSignal: NodeJS.Signals | null = null;
    const failures = new Map<NodeJS.Signals, Error>();
    let timeout: ReturnType<typeof setTimeout>;
    let forceKillAttempted = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.off("exit", finish);
      child.off("close", finish);
      child.off("error", onError);
      if (failures.size > 0) {
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
