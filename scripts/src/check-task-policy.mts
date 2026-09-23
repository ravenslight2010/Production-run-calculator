import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

type Requirement = {
  label: string;
  pattern: RegExp;
  remediation: string;
};

const requirements: Requirement[] = [
  {
    label: "one-task-per-objective rule",
    pattern: /one durable task per (?:work )?objective/i,
    remediation: "state that one durable task owns each objective",
  },
  {
    label: "task-scope capture rule",
    pattern:
      /Before starting, capture the task's scope, affected surfaces, (?:expected )?owner, applicable specialist safety checks, and validation matrix/i,
    remediation:
      "capture the task's scope, affected surfaces, owner, specialist safety checks, and validation matrix before starting",
  },
  {
    label: "failure-ledger closure rule",
    pattern:
      /failure ledger[\s\S]{0,180}(?:Fix every in-scope finding before completion|close them before completion)/i,
    remediation:
      "keep same-objective discoveries in the owning task's failure ledger and close them before completion",
  },
  {
    label: "separate-task exception rule",
    pattern:
      /genuinely independent outcome with separate acceptance criteria, an explicitly deferred user outcome, or an out-of-scope safety, security, data-integrity, or release blocker/i,
    remediation:
      "allow a separate task only for an independent outcome, explicitly deferred outcome, or out-of-scope safety, security, data-integrity, or release blocker",
  },
  {
    label: "follow-up owner requirement",
    pattern:
      /Before creating another task[\s\S]{0,500}(?:parent or owning task|owning task)/i,
    remediation:
      "require every proposed follow-up to name its parent or owning task",
  },
  {
    label: "follow-up de-duplication requirement",
    pattern:
      /Before creating another task[\s\S]{0,700}(?:search|de-duplicate)[\s\S]{0,160}(?:active and draft|draft and active|current draft and active|existing matching task)/i,
    remediation:
      "require an overlap search across current work before creating a follow-up",
  },
  {
    label: "follow-up acceptance criteria requirement",
    pattern:
      /Before creating another task[\s\S]{0,800}independent acceptance criteria/i,
    remediation:
      "require independent acceptance criteria for a separate follow-up",
  },
  {
    label: "follow-up justification requirement",
    pattern:
      /Before creating another task[\s\S]{0,1000}(?:why|reason)[\s\S]{0,100}(?:cannot|can't) remain in the owning task/i,
    remediation:
      "document why proposed work cannot remain in its owning task",
  },
  {
    label: "current-task preservation rule",
    pattern:
      /current (?:draft and active|draft or active|drafts and active|drafts or active|work)[\s\S]{0,500}(?:must not|does not|do not)[\s\S]{0,180}(?:merge|cancel)[\s\S]{0,180}(?:re-scope|scope and lifecycle)/i,
    remediation:
      "preserve every current draft and active task without merging, cancelling, or re-scoping it",
  },
  {
    label: "existing-owner routing rule",
    pattern:
      /new (?:in-scope )?findings?[\s\S]{0,180}(?:return|route)[\s\S]{0,180}(?:matching existing owner|matching existing task|matching owner)/i,
    remediation:
      "route new in-scope findings back to the matching existing owning task",
  },
  {
    label: "completion ledger resolution rule",
    pattern:
      /Completion review[\s\S]{0,220}(?:retain|preserve)[\s\S]{0,120}(?:failure ledger)[\s\S]{0,220}(?:resolve|close)[\s\S]{0,180}(?:FAIL|in-scope)/i,
    remediation:
      "require completion review to retain and resolve the owning task's failure ledger",
  },
  {
    label: "recursive sub-outcome prohibition",
    pattern:
      /Test failures, fixture repairs, cleanup, validation work[\s\S]{0,180}(?:must not|do not)[\s\S]{0,80}recursive tasks/i,
    remediation:
      "keep test failures, fixture repairs, cleanup, validation, and other in-scope sub-outcomes in the owning task",
  },
  {
    label: "web compatibility applicability matrix",
    pattern:
      /web-facing tasks?[\s\S]{0,300}compatibility applicability matrix/i,
    remediation:
      "require a compatibility applicability matrix for every web-facing task",
  },
  {
    label: "compatibility matrix dimensions",
    pattern:
      /desktop, phone, tablet portrait\/landscape, Chromium\/Chrome, and WebKit\/Safari/i,
    remediation:
      "cover desktop, phone, tablet portrait/landscape, Chromium/Chrome, and WebKit/Safari",
  },
  {
    label: "compatibility exception reasons",
    pattern:
      /not applicable[\s\S]{0,180}blocked[\s\S]{0,180}not run/i,
    remediation:
      "require explicit not applicable, blocked, or not run reasons",
  },
  {
    label: "physical-device evidence distinction",
    pattern:
      /responsive browser emulation[\s\S]{0,240}physical Android Chrome[\s\S]{0,240}iOS Safari\/PWA/i,
    remediation:
      "distinguish responsive emulation from physical Android Chrome and iOS Safari/PWA evidence",
  },
  {
    label: "web-only native boundary",
    pattern:
      /web-only[\s\S]{0,180}native-mobile requirement/i,
    remediation:
      "preserve the web-only boundary without creating a native-mobile requirement",
  },
];

const root = resolve(
  process.env.TASK_POLICY_ROOT ?? resolve(import.meta.dirname, "../.."),
);
const failures: string[] = [];

for (const relativePath of ["AGENTS.md", "replit.md"]) {
  const path = resolve(root, relativePath);
  let content: string;

  try {
    content = await readFile(path, "utf8");
  } catch {
    failures.push(
      `${relativePath}: could not read the required task policy document`,
    );
    continue;
  }

  for (const requirement of requirements) {
    if (!requirement.pattern.test(content)) {
      failures.push(
        `${relativePath}: missing ${requirement.label}; ${requirement.remediation}`,
      );
    }
  }
}

if (failures.length > 0) {
  console.error("Task policy check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log("Task policy check passed.");
}
