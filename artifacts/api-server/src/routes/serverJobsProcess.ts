import type { ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";

export type IsolatedApiProcess = ChildProcessByStdio<null, Readable, Readable>;

interface StartupTimeouts {
  startupTimeoutMs?: number;
  forceKillTimeoutMs?: number;
}

export function waitForIsolatedApiProcess(
  child: IsolatedApiProcess,
  { startupTimeoutMs = 60_000, forceKillTimeoutMs = 5_000 }: StartupTimeouts = {},
): Promise<{ child: IsolatedApiProcess; url: string }> {
  return new Promise((resolve, reject) => {
    let output = "";
    let settled = false;
    let childClosed = false;
    let failure: Error | undefined;
    let startupTimer: NodeJS.Timeout | undefined;
    let forceKillTimer: NodeJS.Timeout | undefined;

    const cleanup = () => {
      if (startupTimer) clearTimeout(startupTimer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      child.removeListener("close", onClose);
      child.removeListener("error", onError);
      child.removeListener("exit", onExit);
      child.stdout.removeListener("data", onStdoutData);
      child.stderr.removeListener("data", onStderrData);
    };

    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      failure = error;
      if (startupTimer) clearTimeout(startupTimer);
      if (childClosed || child.exitCode !== null || child.signalCode !== null) {
        cleanup();
        reject(error);
        return;
      }
      forceKillTimer = setTimeout(() => {
        forceKillTimer = undefined;
        if (!childClosed && child.exitCode === null && child.signalCode === null) {
          child.kill("SIGKILL");
        }
      }, forceKillTimeoutMs);
      child.kill("SIGTERM");
    };

    const onClose = () => {
      childClosed = true;
      if (!settled) {
        fail(new Error("Isolated API process exited before becoming ready"));
        return;
      }
      if (failure) {
        cleanup();
        reject(failure);
      }
    };

    const onError = (error: Error) => fail(error);
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      if (!settled) {
        fail(new Error(`Isolated API process exited before ready (${code ?? signal})`));
      }
    };
    const onStdoutData = (chunk: Buffer | string) => {
      if (settled) return;
      output += chunk.toString();
      for (const line of output.split("\n").slice(0, -1)) {
        try {
          const message = JSON.parse(line) as { port?: number };
          if (Number.isInteger(message.port) && message.port! > 0) {
            settled = true;
            cleanup();
            resolve({ child, url: `http://127.0.0.1:${message.port}` });
            return;
          }
        } catch {
          // Startup diagnostics are allowed; only the JSON ready marker matters.
        }
      }
      output = output.slice(output.lastIndexOf("\n") + 1);
    };
    const onStderrData = () => {};

    child.once("close", onClose);
    child.once("error", onError);
    child.once("exit", onExit);
    child.stdout.on("data", onStdoutData);
    child.stderr.on("data", onStderrData);
    startupTimer = setTimeout(
      () => fail(new Error(
        `Isolated API process did not become ready within ${startupTimeoutMs / 1_000} seconds`,
      )),
      startupTimeoutMs,
    );
  });
}
