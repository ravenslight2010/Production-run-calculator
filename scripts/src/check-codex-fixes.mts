import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export type FixHistoryFindingCategory =
  | "infrastructure identifier"
  | "deployment image tag"
  | "actionable operational watch detail";

export type FixHistoryFinding = {
  line: number;
  category: FixHistoryFindingCategory;
};

export function formatFixHistoryFinding(finding: FixHistoryFinding): string {
  return `.agents/memory/codex-fixes.md:${finding.line}: ${finding.category}`;
}

const privateOrLocalHost =
  /\b(?:localhost|[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:internal|local|lan|corp|intranet))\b/gi;
const ipv4Candidate = /(?<![\w.])(?:\d{1,3}\.){3}\d{1,3}(?!\d)(?!\.\d)/g;
const deploymentImageReference =
  /\b(?:FROM|(?:container\s+)?image)\s*(?:=|:)?\s*([a-z0-9][a-z0-9._/-]*:[a-z0-9][a-z0-9._-]*)/gi;
const actionableWatchDetail =
  /\b(?:monitor(?:ing)?|watch(?:dog|er|ing)?|alert(?:ing)?|pager)\b.{0,180}\b(?:\d+\s*(?:ms|s|sec(?:ond)?s?|min(?:ute)?s?|h(?:our)?s?)|threshold|cutoff|limit|trigger|table|row|scope|queue|metric)\b/i;

function isPrivateOrLocalIpv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => octet < 0 || octet > 255)) {
    return false;
  }

  const [first, second] = octets;
  return (
    first === 10 ||
    first === 127 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 169 && second === 254)
  );
}

function hasInfrastructureIdentifier(line: string): boolean {
  privateOrLocalHost.lastIndex = 0;
  if (privateOrLocalHost.test(line)) return true;

  ipv4Candidate.lastIndex = 0;
  for (const match of line.matchAll(ipv4Candidate)) {
    if (isPrivateOrLocalIpv4(match[0])) return true;
  }
  return false;
}

export function findFixHistoryDetails(content: string): FixHistoryFinding[] {
  const findings: FixHistoryFinding[] = [];

  for (const [index, line] of content.split(/\r?\n/u).entries()) {
    if (hasInfrastructureIdentifier(line)) {
      findings.push({ line: index + 1, category: "infrastructure identifier" });
    }

    deploymentImageReference.lastIndex = 0;
    if (deploymentImageReference.test(line)) {
      findings.push({ line: index + 1, category: "deployment image tag" });
    }

    if (actionableWatchDetail.test(line)) {
      findings.push({
        line: index + 1,
        category: "actionable operational watch detail",
      });
    }
  }

  return findings;
}

export async function main(): Promise<void> {
  // This deliberately reads one current file. It does not inspect Git history.
  const targetPath = resolve(
    import.meta.dirname,
    "../..",
    ".agents/memory/codex-fixes.md",
  );
  const content = await readFile(targetPath, "utf8");
  const findings = findFixHistoryDetails(content);

  if (findings.length > 0) {
    console.error(
      "Fix-history check failed (current text only; Git history is not scanned):",
    );
    for (const finding of findings) {
      console.error(formatFixHistoryFinding(finding));
    }
    process.exitCode = 1;
    return;
  }

  console.log(
    "Fix-history check passed (current text only; Git history is not scanned).",
  );
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  main().catch(() => {
    console.error(
      "Fix-history check failed: could not read the current fix-history note.",
    );
    process.exitCode = 1;
  });
}
