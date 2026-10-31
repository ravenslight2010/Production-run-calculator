import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const managedCommand =
  /pnpm .*--filter @workspace\/(api-server|run-calculator|mockup-sandbox) run dev/;

export function parseManagedProcessLine(line) {
  const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
  if (!match) return null;
  const managed = match[3].match(managedCommand);
  if (!managed) return null;
  return {
    pid: Number(match[1]),
    pgid: Number(match[2]),
    artifact: managed[1],
  };
}

export function groupManagedProcesses(processLines) {
  const processes = processLines.map(parseManagedProcessLine).filter(Boolean);
  const groups = new Map();
  for (const process of processes) {
    if (process.pid === process.pgid) {
      groups.set(process.pgid, process);
    } else if (!groups.has(process.pgid)) {
      groups.set(process.pgid, process);
    }
  }
  return groups;
}

function stopArtifactWorkflows() {
  const processLines = execFileSync("ps", ["-eo", "pid=,pgid=,args="], {
    encoding: "utf8",
  })
  .split("\n")
    .filter(Boolean);
  const groups = groupManagedProcesses(processLines);

  if (groups.size === 0) {
    console.log("Post-merge workflow cleanup: no artifact dev processes found.");
    return;
  }

  for (const [pgid, entry] of groups) {
    try {
      globalThis.process.kill(-pgid, "SIGTERM");
      console.log(
        `Post-merge workflow cleanup: stopped artifact=${entry.artifact} process_group=${pgid}.`,
      );
    } catch (error) {
      if (error?.code !== "ESRCH") throw error;
      console.log(
        `Post-merge workflow cleanup: artifact=${entry.artifact} process_group=${pgid} was already stopped.`,
      );
    }
  }
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  stopArtifactWorkflows();
}