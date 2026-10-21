import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { isIP } from "node:net";
import { promisify } from "node:util";
import { relative, resolve } from "node:path";

const execFileAsync = promisify(execFile);

export type AgentMemoryFindingCategory =
  | "infrastructure host"
  | "deployment image reference";

export type AgentMemoryFinding = {
  file: string;
  line: number;
  category: AgentMemoryFindingCategory;
};

const privateHostName =
  /\b(?:[a-z0-9-]+\.)+(?:internal|local|lan|corp|intranet)\b/gi;
const ipv4Candidate = /(?<![\w.])(?:\d{1,3}\.){3}\d{1,3}(?!\d)(?!\.\d)/g;
const ipv6Candidate =
  /(?<![0-9a-f:])(?:[0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4}(?![0-9a-f:])/gi;
const deploymentImageReference =
  /\b(?:FROM|(?:container\s+)?image)\s*(?:=|:)?\s*([a-z0-9][a-z0-9._/-]*(?::[a-z0-9][a-z0-9._-]*|@sha256:[a-f0-9]{64}))/gi;

function isPrivateIpv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => octet < 0 || octet > 255)) {
    return false;
  }

  const [first, second] = octets;
  return (
    (first === 10) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 169 && second === 254)
  );
}

function isPrivateIpv6(address: string): boolean {
  if (isIP(address) !== 6) return false;

  const firstGroup = address.split(":")[0].toLowerCase();
  return (
    firstGroup.startsWith("fc") ||
    firstGroup.startsWith("fd") ||
    /^fe[89ab]/u.test(firstGroup)
  );
}

function containsPrivateHost(line: string): boolean {
  privateHostName.lastIndex = 0;
  if (privateHostName.test(line)) return true;

  ipv4Candidate.lastIndex = 0;
  for (const match of line.matchAll(ipv4Candidate)) {
    if (isPrivateIpv4(match[0])) return true;
  }

  ipv6Candidate.lastIndex = 0;
  for (const match of line.matchAll(ipv6Candidate)) {
    if (isPrivateIpv6(match[0])) return true;
  }

  return false;
}

export function isScannedAgentMemoryPath(file: string): boolean {
  const normalized = file.replaceAll("\\", "/").replace(/^\.\//u, "");
  return (
    normalized.startsWith(".agents/memory/") &&
    normalized.endsWith(".md") &&
    normalized !== ".agents/memory/codex-fixes.md"
  );
}

export function findAgentMemoryInfrastructure(
  file: string,
  content: string,
): AgentMemoryFinding[] {
  if (!isScannedAgentMemoryPath(file)) return [];

  const findings: AgentMemoryFinding[] = [];
  for (const [index, line] of content.split(/\r?\n/u).entries()) {
    if (containsPrivateHost(line)) {
      findings.push({
        file,
        line: index + 1,
        category: "infrastructure host",
      });
    }

    deploymentImageReference.lastIndex = 0;
    if (deploymentImageReference.test(line)) {
      findings.push({
        file,
        line: index + 1,
        category: "deployment image reference",
      });
    }
  }

  return findings;
}

export function formatAgentMemoryFinding(
  finding: AgentMemoryFinding,
  repositoryRoot: string,
): string {
  const file = relative(repositoryRoot, resolve(repositoryRoot, finding.file))
    .replaceAll("\\", "/");
  return `${file}:${finding.line}: ${finding.category}`;
}

export async function scanTrackedAgentMemory(
  repositoryRoot: string,
): Promise<AgentMemoryFinding[]> {
  const { stdout } = await execFileAsync(
    "git",
    ["ls-files", "-z", "--", ".agents/memory"],
    { cwd: repositoryRoot, maxBuffer: 4 * 1024 * 1024 },
  );
  const trackedFiles = stdout
    .split("\0")
    .filter(isScannedAgentMemoryPath);
  const findings: AgentMemoryFinding[] = [];

  for (const file of trackedFiles) {
    const content = await readFile(resolve(repositoryRoot, file), "utf8");
    findings.push(...findAgentMemoryInfrastructure(file, content));
  }

  return findings;
}

export async function main(): Promise<void> {
  const repositoryRoot = resolve(import.meta.dirname, "../..");
  const findings = await scanTrackedAgentMemory(repositoryRoot);

  if (findings.length > 0) {
    console.error(
      "Agent-memory infrastructure check failed (tracked notes only; fix-history note excluded):",
    );
    for (const finding of findings) {
      console.error(formatAgentMemoryFinding(finding, repositoryRoot));
    }
    process.exitCode = 1;
    return;
  }

  console.log(
    "Agent-memory infrastructure check passed (tracked notes only; fix-history note excluded).",
  );
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  main().catch(() => {
    console.error(
      "Agent-memory infrastructure check failed: could not scan tracked notes.",
    );
    process.exitCode = 1;
  });
}
