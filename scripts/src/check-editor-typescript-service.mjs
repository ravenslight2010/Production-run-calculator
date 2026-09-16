import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const settingsPath = join(repositoryRoot, ".vscode/settings.json");
const expectedSdk = "node_modules/typescript/lib";
const expectedVersion = "6.0.3";

const settings = JSON.parse(await readFile(settingsPath, "utf8"));
assert.equal(
  settings["typescript.tsdk"],
  expectedSdk,
  `Editor TypeScript SDK must remain ${expectedSdk}`,
);

const sdkRoot = resolve(repositoryRoot, settings["typescript.tsdk"]);
const tsserverPath = join(sdkRoot, "tsserver.js");
const packageJson = JSON.parse(
  await readFile(join(sdkRoot, "../package.json"), "utf8"),
);
assert.equal(
  packageJson.version,
  expectedVersion,
  `Editor TypeScript SDK must resolve to ${expectedVersion}, got ${packageJson.version}`,
);

async function readLiveEditorProcesses() {
  const processes = new Map();
  for (const entry of await readdir("/proc", { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue;
    try {
      const [cmdline, stat] = await Promise.all([
        readFile(`/proc/${entry.name}/cmdline`, "utf8"),
        readFile(`/proc/${entry.name}/stat`, "utf8"),
      ]);
      const statFields = stat.slice(stat.lastIndexOf(") ") + 2).split(" ");
      processes.set(Number(entry.name), {
        args: cmdline.split("\0").filter(Boolean),
        parentPid: Number(statFields[1]),
      });
    } catch (error) {
      if (error?.code !== "ENOENT" && error?.code !== "EACCES") throw error;
    }
  }
  return processes;
}

const liveProcesses = await readLiveEditorProcesses();
const editorServerPids = new Set(
  [...liveProcesses]
    .filter(([, process]) =>
      process.args.some((argument) =>
        argument.includes("typescript-language-server"),
      ),
    )
    .map(([pid]) => pid),
);
assert(
  editorServerPids.size > 0,
  "No live TypeScript editor language server was found. Run this promotion prerequisite from an open Replit editor session.",
);
const liveEditorServices = [...liveProcesses.values()].filter(
  (process) =>
    editorServerPids.has(process.parentPid) &&
    process.args.some((argument) => resolve(argument) === tsserverPath),
);
assert(
  liveEditorServices.length > 0,
  `The live editor is not using the configured workspace service ${tsserverPath}`,
);

const fixtureRoot = await mkdtemp(join(tmpdir(), "editor-typescript-smoke-"));
const definitionPath = join(fixtureRoot, "definition.ts");
const usagePath = join(fixtureRoot, "usage.ts");

await writeFile(
  join(fixtureRoot, "tsconfig.json"),
  JSON.stringify({
    compilerOptions: {
      module: "esnext",
      moduleResolution: "bundler",
      strict: true,
      target: "es2022",
      noEmit: true,
    },
    include: ["*.ts"],
  }),
);
await writeFile(
  definitionPath,
  "export const editorServiceTarget = 42;\n",
);
await writeFile(
  usagePath,
  [
    'import { editorServiceTarget } from "./definition";',
    "const diagnosticTarget: string = editorServiceTarget;",
    "",
  ].join("\n"),
);

const child = spawn(process.execPath, [tsserverPath], {
  cwd: fixtureRoot,
  stdio: ["pipe", "pipe", "pipe"],
});
let sequence = 0;
let stdout = "";
let stderr = "";
const pending = new Map();

function send(command, args) {
  const requestSeq = ++sequence;
  child.stdin.write(
    `${JSON.stringify({
      seq: requestSeq,
      type: "request",
      command,
      arguments: args,
    })}\n`,
  );
  return requestSeq;
}

function request(command, args) {
  const requestSeq = send(command, args);
  return new Promise((resolveRequest, rejectRequest) => {
    const timeout = setTimeout(() => {
      pending.delete(requestSeq);
      rejectRequest(
        new Error(
          `Timed out waiting for tsserver ${command}. stderr: ${stderr.trim()}`,
        ),
      );
    }, 10_000);
    pending.set(requestSeq, {
      command,
      resolve(value) {
        clearTimeout(timeout);
        resolveRequest(value);
      },
    });
  });
}

function consumeMessages() {
  while (true) {
    const headerEnd = stdout.indexOf("\r\n\r\n");
    if (headerEnd < 0) return;
    const header = stdout.slice(0, headerEnd);
    const match = /Content-Length: (\d+)/i.exec(header);
    assert(match, `Malformed tsserver response header: ${header}`);
    const contentLength = Number(match[1]);
    const bodyStart = headerEnd + 4;
    if (Buffer.byteLength(stdout.slice(bodyStart), "utf8") < contentLength) {
      return;
    }
    const bodyBuffer = Buffer.from(stdout.slice(bodyStart), "utf8");
    const body = bodyBuffer.subarray(0, contentLength).toString("utf8");
    stdout = bodyBuffer.subarray(contentLength).toString("utf8");
    const message = JSON.parse(body);
    if (message.type !== "response") continue;
    const waiting = pending.get(message.request_seq);
    if (!waiting) continue;
    pending.delete(message.request_seq);
    assert.equal(
      message.success,
      true,
      `tsserver ${waiting.command} failed: ${message.message ?? "unknown error"}`,
    );
    waiting.resolve(message.body);
  }
}

child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  stdout += chunk;
  consumeMessages();
});
child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => {
  stderr += chunk;
});

try {
  send("open", {
    file: usagePath,
    projectRootPath: fixtureRoot,
  });

  const diagnostics = await request("semanticDiagnosticsSync", {
    file: usagePath,
    includeLinePosition: true,
  });
  assert(
    diagnostics.some((diagnostic) => diagnostic.code === 2322),
    `Expected diagnostic TS2322, got ${JSON.stringify(diagnostics)}`,
  );

  const definitions = await request("definition", {
    file: usagePath,
    line: 2,
    offset: 36,
  });
  assert(
    definitions.some(
      (definition) =>
        resolve(definition.file) === definitionPath &&
        definition.start.line === 1,
    ),
    `Expected navigation to ${definitionPath}, got ${JSON.stringify(definitions)}`,
  );

  console.log(
    `Editor TypeScript service smoke passed: ${liveEditorServices.length} live workspace service process(es), SDK ${packageJson.version}, diagnostics TS2322, definition navigation.`,
  );
} finally {
  child.stdin.end();
  child.kill();
  await rm(fixtureRoot, { recursive: true, force: true });
}