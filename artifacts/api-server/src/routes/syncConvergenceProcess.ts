import type { ChildProcess } from "node:child_process";

type StopIsolatedSyncProcessOptions = {
  forceKillTimeoutMs?: number;
};

export async function stopIsolatedSyncProcess(
  child: ChildProcess,
  { forceKillTimeoutMs = 5_000 }: StopIsolatedSyncProcessOptions = {},
): Promise<void> {
  if (child.exitCode != null || child.signalCode != null) return;

  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.off("exit", finish);
      child.off("close", finish);
      resolve();
    };
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
    }, forceKillTimeoutMs);

    child.once("exit", finish);
    child.once("close", finish);
    child.kill("SIGTERM");
  });
}
