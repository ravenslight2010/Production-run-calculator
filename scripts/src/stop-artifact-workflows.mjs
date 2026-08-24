import { execFileSync } from "node:child_process";

const managedCommand = /pnpm .*--filter @workspace\/(api-server|run-calculator|mockup-sandbox) run dev/;
const processes = execFileSync("ps", ["-eo", "pid=,pgid=,args="], {
  encoding: "utf8",
})
  .split("\n")
  .map((line) => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
    return match
      ? { pid: Number(match[1]), pgid: Number(match[2]), command: match[3] }
      : null;
  })
  .filter((process) => process && managedCommand.test(process.command));

const groups = new Map();
for (const process of processes) {
  if (!process || process.pid === process.pgid) {
    if (process) groups.set(process.pgid, process);
  } else if (!groups.has(process.pgid)) {
    groups.set(process.pgid, process);
  }
}

if (groups.size === 0) {
  console.log("Post-merge workflow cleanup: no artifact dev processes found.");
  process.exit(0);
}

for (const [pgid, entry] of groups) {
  try {
    globalThis.process.kill(-pgid, "SIGTERM");
    console.log(
      `Post-merge workflow cleanup: stopped artifact dev process group ${pgid} (${entry.command}).`,
    );
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
    console.log(
      `Post-merge workflow cleanup: process group ${pgid} was already stopped.`,
    );
  }
}