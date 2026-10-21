import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

export const RELEASE_PUBLICATION_DOCUMENTS = [
  "replit.md",
  "README.md",
  "docs/release-operations.md",
  "docs/release-evidence-handoff.md",
] as const;

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const DISALLOWED_PROVIDER =
  /\b(?:GitHub(?:\s+Actions|\s+CI)?|GHCR|Render|Docker(?:\s+Compose)?|container(?:\s+image)?s?)\b/i;
const PUBLICATION_ACTION =
  /\b(?:publish(?:es|ed|ing)?|publication|deploy(?:s|ed|ing|ment)?|ship(?:s|ped|ping)?)\b/gi;
const PRODUCTION_TARGET =
  /\b(?:production|prod)\b|\b(?:live|active|current)\s+(?:app|application|service|deployment|build|identity)\b|\b(?:app|application|service|deployment|build|identity)\s+(?:is\s+)?(?:live|active|current|production)\b|\bwhat is live\b/gi;
const LIVE_PROOF =
  /\b(?:prove|proves|proved|proof|establish|establishes|verify|verifies|verified|identify|identifies|identified|identity)\b/gi;

export interface PublicationAuthorityFinding {
  document: string;
  line: number;
  claim: string;
}

interface MarkdownBlock {
  line: number;
  text: string;
  historical: boolean;
  example: boolean;
}

function isHistoricalLabel(value: string): boolean {
  return /\b(?:historical|history|legacy|former|formerly|archived|deprecated|unsupported for current publication)\b/i.test(
    value,
  );
}

function isExampleLabel(value: string): boolean {
  return /^\s*(?:>\s*)?(?:\*\*)?(?:example|for example|e\.g\.)(?:\*\*)?\s*[:—-]/i.test(
    value,
  );
}

function markdownBlocks(markdown: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  const headingHistory: Array<{ level: number; historical: boolean }> = [];
  let paragraph: string[] = [];
  let paragraphLine = 1;
  let inFence = false;
  let fenceMarker = "";

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    const text = paragraph.join("\n").trim();
    const enclosingHistorical = headingHistory.some(
      (heading) => heading.historical,
    );
    blocks.push({
      line: paragraphLine,
      text,
      historical: enclosingHistorical,
      example: isExampleLabel(text),
    });
    paragraph = [];
  };

  const lines = markdown.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const fence = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (fence) {
      flushParagraph();
      if (!inFence) {
        inFence = true;
        fenceMarker = fence[1]![0]!;
      } else if (fence[1]![0] === fenceMarker) {
        inFence = false;
        fenceMarker = "";
      }
      continue;
    }
    if (inFence) continue;

    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      flushParagraph();
      const level = heading[1]!.length;
      while (
        headingHistory.length > 0 &&
        headingHistory[headingHistory.length - 1]!.level >= level
      ) {
        headingHistory.pop();
      }
      headingHistory.push({
        level,
        historical: isHistoricalLabel(heading[2]!),
      });
      continue;
    }

    if (line.trimStart().startsWith("|")) {
      flushParagraph();
      const text = line.trim();
      blocks.push({
        line: index + 1,
        text,
        historical: headingHistory.some((item) => item.historical),
        example: isExampleLabel(text),
      });
      continue;
    }

    if (line.trim() === "") {
      flushParagraph();
      continue;
    }
    if (paragraph.length === 0) paragraphLine = index + 1;
    paragraph.push(line);
  }
  flushParagraph();
  return blocks;
}

function sentences(block: string): string[] {
  return block
    .replace(/\n/g, " ")
    .replace(/`[^`]*`/g, " ")
    .split(/(?<=[.!?;])\s+(?=[A-Z0-9“"'`])/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function negatesAction(text: string, actionIndex: number): boolean {
  const preceding = text.slice(Math.max(0, actionIndex - 55), actionIndex);
  return (
    /\b(?:do|does|did|will|can|could|should|would|must|is|are|was|were)\s+(?:not|never)\s+(?:\w+\s+){0,2}$/i.test(
      preceding,
    ) ||
    /\b(?:not|never|no longer)\s+(?:an?\s+|the\s+)?(?:authorized\s+|current\s+|live\s+|production\s+)?(?:publisher|publication|deployment|proof|evidence)?\s*$/i.test(
      preceding,
    ) ||
    /\bnot\s+an?\s+authorized\s+route\s+for\s*$/i.test(preceding) ||
    /\b(?:do|does|did|will|can|could|should|would|must)\s+not\b[^.!?;]{0,45}\bor\s*$/i.test(
      preceding,
    ) ||
    /\bneither\s*$/i.test(preceding) ||
    /\bneither\b[^.!?;]{0,60}\bnor\s*$/i.test(preceding)
  );
}

function hasCurrentConflictingClaim(sentence: string): boolean {
  const providerMatches = [
    ...sentence.matchAll(new RegExp(DISALLOWED_PROVIDER.source, "gi")),
  ];
  if (providerMatches.length === 0) return false;
  const targetMatches = [...sentence.matchAll(PRODUCTION_TARGET)];
  const actionMatches = [...sentence.matchAll(PUBLICATION_ACTION)];
  const proofMatches = [...sentence.matchAll(LIVE_PROOF)];

  for (const match of [...actionMatches, ...proofMatches]) {
    const actionIndex = match.index ?? 0;
    if (negatesAction(sentence, actionIndex)) continue;
    for (const provider of providerMatches) {
      const providerIndex = provider.index ?? 0;
      for (const target of targetMatches) {
        const targetIndex = target.index ?? 0;
        const targetEnd = targetIndex + target[0].length;
        const providerBeforeAction =
          providerIndex < actionIndex &&
          actionIndex - providerIndex <= 140 &&
          targetIndex > actionIndex &&
          targetIndex - actionIndex <= 100;
        const actionRoutesToProvider =
          actionIndex < providerIndex &&
          providerIndex - actionIndex <= 140 &&
          targetIndex > providerIndex &&
          targetIndex - providerIndex <= 100;
        const passiveProvider =
          targetEnd <= actionIndex &&
          actionIndex - targetEnd <= 100 &&
          actionIndex < providerIndex &&
          providerIndex - actionIndex <= 100;

        if (providerBeforeAction || actionRoutesToProvider || passiveProvider) {
          return true;
        }
      }
    }
  }
  return false;
}

function hasReplitPublisherAuthority(markdown: string): boolean {
  const normalized = markdown.replace(/`[^`]*`/g, " ").replace(/\s+/g, " ");
  return (
    /\bReplit\b.{0,180}\b(?:only|current|authorized)\b.{0,120}\b(?:publisher|publish(?:es|ed|ing)?)\b.{0,120}\b(?:active|current|production)\b.{0,80}\bapp\b/i.test(
      normalized,
    ) ||
    /\b(?:active|current|production)\b.{0,80}\bapp\b.{0,120}\b(?:only|current|authorized)\b.{0,120}\b(?:publisher|publish(?:es|ed|ing)?)\b.{0,120}\bReplit\b/i.test(
      normalized,
    )
  );
}

export function checkReleasePublicationAuthority(
  documents: ReadonlyMap<string, string>,
): PublicationAuthorityFinding[] {
  const findings: PublicationAuthorityFinding[] = [];

  for (const document of RELEASE_PUBLICATION_DOCUMENTS) {
    const markdown = documents.get(document);
    if (markdown === undefined) {
      findings.push({
        document,
        line: 1,
        claim: "required public release document is missing",
      });
      continue;
    }

    if (!hasReplitPublisherAuthority(markdown)) {
      findings.push({
        document,
        line: 1,
        claim:
          "does not identify Replit as the current publisher of the active production app",
      });
    }

    for (const block of markdownBlocks(markdown)) {
      if (block.historical || block.example) continue;
      for (const sentence of sentences(block.text)) {
        if (isHistoricalLabel(sentence)) continue;
        if (hasCurrentConflictingClaim(sentence)) {
          findings.push({
            document,
            line: block.line,
            claim: sentence.replace(/\s+/g, " ").slice(0, 240),
          });
        }
      }
    }
  }
  return findings;
}

export function formatReleasePublicationAuthorityFindings(
  findings: readonly PublicationAuthorityFinding[],
): string {
  return findings
    .map(
      ({ document, line, claim }) =>
        `${document}:${line}: conflicting publication claim: ${claim}`,
    )
    .join("\n");
}

async function main(): Promise<void> {
  const documents = new Map<string, string>();
  for (const document of RELEASE_PUBLICATION_DOCUMENTS) {
    documents.set(
      document,
      await readFile(resolve(REPOSITORY_ROOT, document), "utf8"),
    );
  }

  const findings = checkReleasePublicationAuthority(documents);
  if (findings.length > 0) {
    console.error(formatReleasePublicationAuthorityFindings(findings));
    process.exitCode = 1;
    return;
  }
  console.log(
    `PASS release publication authority: ${RELEASE_PUBLICATION_DOCUMENTS.join(", ")}`,
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main();
}
