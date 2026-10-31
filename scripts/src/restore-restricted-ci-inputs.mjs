import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chmodSync, lstatSync, mkdirSync, readFileSync, realpathSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { restoreReviewedBuildInputsFromDirectory } from "./restore-reviewed-build-inputs.mjs";

const repository = "ravenslight2010/Production-run-calculator";
const capabilityHash = "b1675a82fb76e091811eaa336642a70e7695f57a5c7f54d8551084c47b233ed3";
export const manifest = JSON.parse(readFileSync(new URL("./reviewed-ci-input-manifest.json", import.meta.url), "utf8"));
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const reportDirectory = "attached_assets/source-library/audits";

export function authorize(context, event, approvedHead, capability, expectedCapabilityHash = capabilityHash) {
  if (context.GITHUB_ACTIONS !== "true" || context.GITHUB_REPOSITORY !== repository ||
      digest(capability ?? "") !== expectedCapabilityHash) throw new Error("Restricted input authorization missing.");
  const pr = event?.pull_request;
  if (context.GITHUB_EVENT_NAME !== "pull_request" || context.GITHUB_REF !== "refs/pull/142/merge" ||
      event.number !== 142 || pr?.head?.repo?.full_name !== repository || pr?.head?.ref !== "feat/windows-lan-self-hosting" ||
      pr?.base?.ref !== "main" || !/^[a-f0-9]{40}$/.test(approvedHead ?? "") || pr?.head?.sha !== approvedHead) {
    throw new Error("Only the explicitly reviewed same-repository PR revision is authorized.");
  }
}

function checksumEntry() {
  const report = manifest.find((entry) => entry.path.endsWith("/source-library-reconciliation-2026-08-26.json"));
  return { path: report.path.replace(/json$/, "sha256"), sha256: digest(Buffer.from(`${report.sha256}\n`)) };
}

function safePath(root, relative, create) {
  if (!/^attached_assets\/(?:source-library\/)?(?:[A-Za-z0-9_' ,.()-]+\/)*[A-Za-z0-9_' ,.()-]+\.(?:xlsx|json|sha256|md)$/.test(relative) ||
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
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 4 * 1024 * 1024) throw new Error("Unsafe input file.");
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  return file;
}

// Explicit entries/reader seams are for synthetic tests only. CLI always uses the fixed manifest.
export function materialize(root, entries, readBlob) {
  const files = [];
  let total = 0;
  for (const entry of entries) {
    const bytes = readBlob(entry);
    total += bytes.length;
    if (bytes.length > 4 * 1024 * 1024 || total > 12 * 1024 * 1024 || digest(bytes) !== entry.sha256) throw new Error("Reviewed bytes mismatch or budget exceeded.");
    const file = safePath(root, entry.path, true);
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

export function cleanup(root, entries = [...manifest, checksumEntry()]) {
  const files = [];
  for (const entry of entries) {
    const file = safePath(root, entry.path, false);
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
  const token = process.env.CI_REVIEWED_GITHUB_TOKEN;
  delete process.env.CI_REVIEWED_INPUT_AUTHORIZATION;
  delete process.env.CI_REVIEWED_GITHUB_TOKEN;
  try {
    if (process.argv[2] === "--cleanup" && process.argv.length === 3) cleanup(process.cwd());
    else if (process.argv[2] === "--copy-report" && process.argv.length === 4) {
      // Rollback's disposable worktrees consume the same canonical pair as the outer build.
      restoreReviewedBuildInputsFromDirectory(process.argv[3], path.join(process.cwd(), reportDirectory));
    } else if (process.argv.length === 2) {
      authorize(process.env, JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8")), process.env.REVIEWED_PR_HEAD_SHA, capability);
      const gitEnv = { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "/bin/false" };
      if (!token) throw new Error("Read-only repository transport unavailable.");
      const header = `Authorization: Basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`;
      Object.assign(gitEnv, { GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader", GIT_CONFIG_VALUE_0: header });
      for (const revision of new Set(manifest.map((entry) => entry.revision))) {
        execFileSync("git", ["-c", "credential.helper=", "fetch", "--no-tags", "--depth=1", `https://github.com/${repository}.git`, revision], { env: gitEnv, stdio: "ignore", timeout: 120_000 });
      }
      materialize(process.cwd(), manifest, (entry) => execFileSync("git", ["show", `${entry.revision}:${entry.path}`], { maxBuffer: 4 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"], timeout: 30_000 }));
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
