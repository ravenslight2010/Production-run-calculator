import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export type FixHistoryFindingCategory =
  | "infrastructure identifier"
  | "deployment image tag"
  | "actionable operational watch detail"
  | "contact detail"
  | "mailing address"
  | "credential value"
  | "private-key material"
  | "URL user-info";

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
const emailAddress =
  /(?<![\w.+-])[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+\b/i;
const phoneNumber =
  /(?<!\w)(?:\+\d{1,3}[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]\d{3}[\s.-]\d{4}(?!\w)|(?<!\w)\d{3}[-.]\d{4}(?!\w)/;
const mailingAddress =
  /\bP(?:ost)?\.?\s*O(?:ffice)?\.?\s+Box\s+\d{1,8}\b|(?<![\w./-])\d{1,6}\s+(?:(?:N|S|E|W|NE|NW|SE|SW)\.?\s+)?[a-z0-9.'’-]+(?:\s+[a-z0-9.'’-]+){0,4}\s+(?:street|st\.?|avenue|ave\.?|road|rd\.?|boulevard|blvd\.?|lane|ln\.?|drive|dr\.?|court|ct\.?|circle|cir\.?|parkway|pkwy\.?|place|pl\.?|terrace|ter\.?|highway|hwy\.?|way)\b/i;
const wrappedStreetAddressLine =
  /^\s*(?:[-*]\s+)?\d{1,6}\s+(?:(?:N|S|E|W|NE|NW|SE|SW)\.?\s+)?[a-z0-9.'’-]+(?:\s+[a-z0-9.'’-]+){0,4}\s+(?:street|st\.?|avenue|ave\.?|road|rd\.?|boulevard|blvd\.?|lane|ln\.?|drive|dr\.?|court|ct\.?|circle|cir\.?|parkway|pkwy\.?|place|pl\.?|terrace|ter\.?|highway|hwy\.?|way)\s*[.,]?\s*$/i;
const wrappedCityPostalLine =
  /^\s*(?:[-*]\s+)?[a-z][a-z.'’-]*(?:\s+[a-z][a-z.'’-]*){0,4},\s*[a-z]{2}\s+\d{5}(?:-\d{4})?\s*[.,]?\s*$/i;
const wrappedStreetUnitLine =
  /^\s*(?:[-*]\s+)?(?:suite|ste\.?|unit|apt\.?|apartment)\s+(?:#\s*)?(?:\d[a-z0-9-]{0,9}|[a-z])\s*[.,]?\s*$/i;
const wrappedCityStateLine =
  /^\s*(?:[-*]\s+)?[a-z][a-z.'’-]*(?:\s+[a-z][a-z.'’-]*){0,4},\s*[a-z]{2}\s*[.,]?\s*$/i;
const wrappedPostalCodeLine =
  /^\s*(?:[-*]\s+)?\d{5}(?:-\d{4})?\s*[.,]?\s*$/;
const privateKeyMarker = /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/i;
const urlUserInfo = /\bhttps?:\/\/([^/@\s]+)@/gi;
const credentialAssignment =
  /\b(?:password|passwd|pwd|token|secret|api[_ -]?key|access[_ -]?key|client[_ -]?secret|authorization)\s*(?:=|:)\s*(?:"([^"]+)"|'([^']+)'|`([^`]+)`|([^\s,;]+))/gi;
const bearerCredential = /\bbearer\s+([a-z0-9._~+/-]{8,})/gi;
const jwtCredential = /\beyJ[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]{8,}\b/g;
const knownTokenFormat =
  /\b(?:ghp_[a-zA-Z0-9]{12,}|github_pat_[a-zA-Z0-9_]{12,}|gho_[a-zA-Z0-9]{12,}|glpat-[a-zA-Z0-9_-]{12,}|xox[baprs]-[a-zA-Z0-9-]{12,}|sk_(?:live|test)_[a-zA-Z0-9]{12,}|ya29\.[a-zA-Z0-9_-]{12,})\b/g;

const harmlessCredentialValues = new Set([
  "bearer",
  "changeme",
  "example",
  "example-value",
  "none",
  "null",
  "pass",
  "password",
  "placeholder",
  "redacted",
  "removed",
  "string",
  "undefined",
  "user",
  "username",
  "your-api-key",
  "your-api-key-here",
  "your_api_key",
  "your-password",
  "your-password-here",
  "your-secret",
  "your-secret-here",
  "your-token",
  "your-token-here",
]);

function normalizedCredentialValue(value: string): string {
  return value
    .trim()
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/[.,;)}\]]+$/g, "")
    .toLowerCase();
}

function isHarmlessCredentialValue(value: string): boolean {
  const normalized = normalizedCredentialValue(value);
  return (
    normalized.length === 0 ||
    harmlessCredentialValues.has(normalized) ||
    /^<[^<>]+>$/.test(normalized) ||
    /^\[[^\[\]]+\]$/.test(normalized) ||
    /^\*{3,}$/.test(normalized) ||
    /^\$?(?:\{[A-Z][A-Z0-9_]*\}|[A-Z][A-Z0-9_]*)$/.test(value.trim()) ||
    /^(?:process\.env|import\.meta\.env)\.[A-Z][A-Z0-9_]*$/.test(value.trim())
  );
}

function hasCredentialValue(line: string): boolean {
  credentialAssignment.lastIndex = 0;
  for (const match of line.matchAll(credentialAssignment)) {
    const value = match.slice(1).find((part) => part !== undefined);
    if (value && !isHarmlessCredentialValue(value)) return true;
  }

  urlUserInfo.lastIndex = 0;
  for (const match of line.matchAll(urlUserInfo)) {
    const separator = match[1].indexOf(":");
    const username = separator === -1 ? match[1] : match[1].slice(0, separator);
    const password = separator === -1 ? undefined : match[1].slice(separator + 1);
    if (
      (username && !isHarmlessCredentialValue(username)) ||
      (password && !isHarmlessCredentialValue(password))
    ) {
      return true;
    }
  }

  bearerCredential.lastIndex = 0;
  for (const match of line.matchAll(bearerCredential)) {
    if (!isHarmlessCredentialValue(match[1])) return true;
  }

  jwtCredential.lastIndex = 0;
  if (jwtCredential.test(line)) return true;

  knownTokenFormat.lastIndex = 0;
  return knownTokenFormat.test(line);
}

function hasEmailAddress(line: string): boolean {
  const match = emailAddress.exec(line);
  if (!match || match.index === undefined) return false;

  const emailAtIndex = match.index + match[0].indexOf("@");
  urlUserInfo.lastIndex = 0;
  for (const urlMatch of line.matchAll(urlUserInfo)) {
    const urlAtIndex = urlMatch.index + urlMatch[0].lastIndexOf("@");
    if (urlAtIndex === emailAtIndex) return false;
  }
  return true;
}

export function hasMailingAddress(line: string): boolean {
  return mailingAddress.test(line);
}

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
  const lines = content.split(/\r?\n/u);
  const wrappedMailingAddressLines = new Set<number>();

  for (let index = 0; index < lines.length - 1; index += 1) {
    if (
      wrappedStreetAddressLine.test(lines[index]) &&
      wrappedCityPostalLine.test(lines[index + 1])
    ) {
      wrappedMailingAddressLines.add(index);
      wrappedMailingAddressLines.add(index + 1);
    }
  }

  for (let index = 0; index < lines.length - 2; index += 1) {
    if (
      wrappedStreetAddressLine.test(lines[index]) &&
      wrappedStreetUnitLine.test(lines[index + 1]) &&
      wrappedCityPostalLine.test(lines[index + 2])
    ) {
      wrappedMailingAddressLines.add(index);
      wrappedMailingAddressLines.add(index + 1);
      wrappedMailingAddressLines.add(index + 2);
    }

    if (
      wrappedStreetAddressLine.test(lines[index]) &&
      wrappedCityStateLine.test(lines[index + 1]) &&
      wrappedPostalCodeLine.test(lines[index + 2])
    ) {
      wrappedMailingAddressLines.add(index);
      wrappedMailingAddressLines.add(index + 1);
      wrappedMailingAddressLines.add(index + 2);
    }
  }

  for (const [index, line] of lines.entries()) {
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

    if (hasEmailAddress(line) || phoneNumber.test(line)) {
      findings.push({ line: index + 1, category: "contact detail" });
    }

    if (hasMailingAddress(line) || wrappedMailingAddressLines.has(index)) {
      findings.push({ line: index + 1, category: "mailing address" });
    }

    if (privateKeyMarker.test(line)) {
      findings.push({ line: index + 1, category: "private-key material" });
    }

    if (hasCredentialValue(line)) {
      findings.push({ line: index + 1, category: "credential value" });
    }
  }

  return findings;
}

export async function main(): Promise<void> {
  // This deliberately reads one current file. It does not inspect or remove Git history.
  const targetPath = resolve(
    import.meta.dirname,
    "../..",
    ".agents/memory/codex-fixes.md",
  );
  const content = await readFile(targetPath, "utf8");
  const findings = findFixHistoryDetails(content);

  if (findings.length > 0) {
    console.error(
      "Fix-history check failed (current text only; Git history is not inspected or removed):",
    );
    for (const finding of findings) {
      console.error(formatFixHistoryFinding(finding));
    }
    process.exitCode = 1;
    return;
  }

  console.log(
    "Fix-history check passed (current text only; Git history is not inspected or removed).",
  );
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  main().catch(() => {
    console.error(
      "Fix-history check failed: could not read the current fix-history note (current text only; Git history is not inspected or removed).",
    );
    process.exitCode = 1;
  });
}
