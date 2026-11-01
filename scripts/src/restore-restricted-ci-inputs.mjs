import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chmodSync, lstatSync, mkdirSync, readFileSync, realpathSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { restoreReviewedBuildInputsFromDirectory } from "./restore-reviewed-build-inputs.mjs";

const repository = "ravenslight2010/Production-run-calculator";
const capabilityHash = "b1675a82fb76e091811eaa336642a70e7695f57a5c7f54d8551084c47b233ed3";
const repairCapabilityHash = "1d9b93feec30fd89b2e1443f82d9062a676fd5305dc1bc08fb542994b1c40e9a";
const installerCapabilityHash = "ed6f54492f6e436bc2c947278c5aa7a217bbd5e654424d718f18faccb5cbe04a";
const mainCapabilityHash = "837ccd959aa818cdb163e6a1763bdc37ede875d56965437f6c3f27110d6aa279";
export const manifest = JSON.parse(readFileSync(new URL("./reviewed-ci-input-manifest.json", import.meta.url), "utf8"));
export const archiveManifest = JSON.parse(readFileSync(new URL("./reviewed-ci-archive-manifest.json", import.meta.url), "utf8"));
const SOURCE_BUDGET = { perFile: 4 * 1024 * 1024, total: 12 * 1024 * 1024 };
const ARCHIVE_BUDGET = { perFile: 140 * 1024 * 1024, total: 290 * 1024 * 1024 };
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const reportDirectory = "attached_assets/source-library/audits";

export function authorize(context, event, approvedHead, capability, expectedCapabilityHash) {
  const policy = event?.number === 142
    ? { number: 142, branch: "feat/windows-lan-self-hosting", hash: capabilityHash }
    : event?.number === 145
      ? { number: 145, branch: "fix/main-green-pr-audit", hash: repairCapabilityHash }
      : event?.number === 146
        ? { number: 146, branch: "feat/windows-server-installer", hash: installerCapabilityHash }
        : undefined;
  if (!policy || context.GITHUB_ACTIONS !== "true" || context.GITHUB_REPOSITORY !== repository ||
      digest(capability ?? "") !== (expectedCapabilityHash ?? policy.hash)) throw new Error("Restricted input authorization missing.");
  const pr = event?.pull_request;
  if (context.GITHUB_EVENT_NAME !== "pull_request" || context.GITHUB_REF !== `refs/pull/${policy.number}/merge` ||
      pr?.head?.repo?.full_name !== repository || pr?.head?.ref !== policy.branch ||
      pr?.base?.ref !== "main" || !/^[a-f0-9]{40}$/.test(approvedHead ?? "") || pr?.head?.sha !== approvedHead) {
    throw new Error("Only the explicitly reviewed same-repository PR revision is authorized.");
  }
}

// This independent capability is available only in the owner-reviewed main-only
// environment. PR authorization above deliberately cannot authorize main.
export function authorizeMain(context, event, capability, expectedCapabilityHash = mainCapabilityHash) {
  if (context.GITHUB_ACTIONS !== "true" || context.GITHUB_REPOSITORY !== repository ||
      context.GITHUB_REF !== "refs/heads/main" ||
      !["push", "workflow_dispatch"].includes(context.GITHUB_EVENT_NAME) ||
      event?.repository?.full_name !== repository ||
      !/^[a-f0-9]{40}$/.test(context.GITHUB_SHA ?? "") ||
      (context.GITHUB_EVENT_NAME === "push" && (event.ref !== "refs/heads/main" || event.after !== context.GITHUB_SHA || event.deleted === true)) ||
      digest(capability ?? "") !== expectedCapabilityHash) {
    throw new Error("Only an owner-reviewed main revision is authorized by the separate main capability.");
  }
}

function checksumEntry() {
  const report = manifest.find((entry) => entry.path.endsWith("/source-library-reconciliation-2026-08-26.json"));
  return { path: report.path.replace(/json$/, "sha256"), sha256: digest(Buffer.from(`${report.sha256}\n`)) };
}

function safePath(root, relative, create, maximumBytes = SOURCE_BUDGET.perFile) {
  if (!/^attached_assets\/(?:source-library\/)?(?:[A-Za-z0-9_' ,.()-]+\/)*[A-Za-z0-9_' ,.()-]+\.(?:xlsx|json|sha256|md|zip)$/.test(relative) ||
      relative.split("/").some((part) => part === "." || part === "..")) throw new Error("Invalid reviewed input path.");
  let current = realpathSync(root);
  const components = relative.split("/");
  for (const part of components.slice(0, -1)) {
    current = path.join(current, part);
    let stat;
    try { stat = lstatSync(current); } catch (error) {
      if (error.code !== "ENOENT") throw error;
      if (!create) return null;
      mkdirSync(current, { mode: 0o700 }); stat = lstatSync(current);
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Unsafe input directory.");
  }
  const file = path.join(current, components.at(-1));
  try {
    const stat = lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > maximumBytes) throw new Error("Unsafe input file.");
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  return file;
}

// Explicit entries/reader seams are for synthetic tests only. CLI always uses the fixed manifest.
export function materialize(root, entries, readBlob, budget = SOURCE_BUDGET) {
  const files = [];
  let total = 0;
  for (const entry of entries) {
    const bytes = readBlob(entry);
    total += bytes.length;
    if (bytes.length > budget.perFile || total > budget.total || (entry.bytes !== undefined && bytes.length !== entry.bytes) || digest(bytes) !== entry.sha256) throw new Error("Reviewed bytes mismatch or budget exceeded.");
    const file = safePath(root, entry.path, true, budget.perFile);
    try { if (!readFileSync(file).equals(bytes)) throw new Error("Existing input differs."); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    files.push([file, bytes]);
  }
  for (const [file, bytes] of files) {
    try { writeFileSync(file, bytes, { mode: 0o600, flag: "wx" }); }
    catch (error) { if (error.code !== "EEXIST") throw error; }
    chmodSync(file, 0o600);
  }
}

export function verifyArchivePointer(blob, entry) {
  const pointer = `version https://git-lfs.github.com/spec/v1\noid sha256:${entry.sha256}\nsize ${entry.bytes}\n`;
  if (!Number.isSafeInteger(entry.bytes) || entry.bytes < 1 || entry.bytes > ARCHIVE_BUDGET.perFile ||
      !/^[a-f0-9]{64}$/.test(entry.sha256) || blob.toString("utf8") !== pointer) throw new Error("Unapproved LFS pointer.");
}

export function cleanup(root, entries = [...manifest, checksumEntry()]) {
  const files = [];
  for (const entry of entries) {
    const file = safePath(root, entry.path, false, entry.bytes ?? SOURCE_BUDGET.perFile);
    if (!file) continue;
    try {
      if (digest(readFileSync(file)) !== entry.sha256) throw new Error("Changed input cannot be cleaned.");
      files.push(file);
    } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  // Validate everything before deleting anything. Never recursively delete the asset directory.
  for (const file of files) unlinkSync(file);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const capability = process.env.CI_REVIEWED_INPUT_AUTHORIZATION;
  const mainCapability = process.env.CI_MAIN_INPUT_AUTHORIZATION;
  const token = process.env.CI_REVIEWED_GITHUB_TOKEN;
  delete process.env.CI_REVIEWED_INPUT_AUTHORIZATION;
  delete process.env.CI_REVIEWED_GITHUB_TOKEN;
  delete process.env.CI_MAIN_INPUT_AUTHORIZATION;
  try {
    if (process.argv[2] === "--cleanup" && process.argv.length === 3) cleanup(process.cwd(), [...manifest, checksumEntry(), ...archiveManifest]);
    else if (process.argv[2] === "--copy-report" && process.argv.length === 4) {
      // Rollback's disposable worktrees consume the same canonical pair as the outer build.
      restoreReviewedBuildInputsFromDirectory(process.argv[3], path.join(process.cwd(), reportDirectory));
    } else if (process.argv.length === 2 || (process.argv.length === 3 && ["--with-archives", "--main"].includes(process.argv[2])) ||
               (process.argv.length === 4 && process.argv[2] === "--main" && process.argv[3] === "--with-archives")) {
      const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
      if (process.argv[2] === "--main") {
        authorizeMain(process.env, event, mainCapability);
        const actualHead = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
        if (actualHead !== process.env.GITHUB_SHA) throw new Error("Main checkout differs from the authorized run revision.");
      } else authorize(process.env, event, process.env.REVIEWED_PR_HEAD_SHA, capability);
      const gitEnv = { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "/bin/false" };
      if (!token) throw new Error("Read-only repository transport unavailable.");
      const header = `Authorization: Basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`;
      Object.assign(gitEnv, { GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader", GIT_CONFIG_VALUE_0: header });
      const withArchives = process.argv.slice(2).includes("--with-archives");
      const selected = withArchives ? [...manifest, ...archiveManifest] : manifest;
      for (const revision of new Set(selected.map((entry) => entry.revision))) {
        execFileSync("git", ["-c", "credential.helper=", "fetch", "--no-tags", "--depth=1", `https://github.com/${repository}.git`, revision], { env: gitEnv, stdio: "ignore", timeout: 120_000 });
      }
      materialize(process.cwd(), manifest, (entry) => execFileSync("git", ["show", `${entry.revision}:${entry.path}`], { maxBuffer: 4 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"], timeout: 30_000 }));
      if (withArchives) {
        // Exact reviewed ZIPs are opaque fixtures: never extract or execute a member.
        materialize(process.cwd(), archiveManifest, (entry) => {
          const blob = execFileSync("git", ["show", `${entry.revision}:${entry.path}`], { maxBuffer: SOURCE_BUDGET.perFile, stdio: ["ignore", "pipe", "ignore"], timeout: 30_000 });
          if (!entry.lfs) return blob;
          verifyArchivePointer(blob, entry);
          return execFileSync("git", ["lfs", "smudge", "--", entry.path], {
            env: { ...gitEnv, GIT_LFS_SKIP_SMUDGE: "0" }, input: blob,
            maxBuffer: entry.bytes + 1, stdio: ["pipe", "pipe", "ignore"], timeout: 180_000,
          });
        }, ARCHIVE_BUDGET);
      }
      // Synthesize only the checksum of the exact canonical report, never audit/workbook content.
      const report = manifest.find((entry) => entry.path.endsWith("/source-library-reconciliation-2026-08-26.json"));
      const checksum = { path: report.path.replace(/json$/, "sha256"), sha256: digest(Buffer.from(`${report.sha256}\n`)) };
      materialize(process.cwd(), [checksum], () => Buffer.from(`${report.sha256}\n`));
    } else throw new Error("Invalid restricted input command.");
    console.log("Restricted CI inputs verified; no input contents logged.");
  } catch {
    console.error("Restricted CI input delivery failed closed; verify approved revision, environment and exact-byte inputs.");
    process.exitCode = 1;
  }
}
