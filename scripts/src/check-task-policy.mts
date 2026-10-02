import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

type Requirement = {
  label: string;
  pattern: RegExp;
  remediation: string;
  contradictions?: { label: string; pattern: RegExp }[];
};

const requirements: Requirement[] = [
  {
    label: "follow-up priority gate",
    pattern:
      /High- and medium-priority independent outcomes may be submitted as child tasks[\s\S]{0,220}Low-priority outcomes may be submitted only when the plan states a concrete benefit and bounded scope/i,
    remediation:
      "allow high/medium independent outcomes and gate low-priority work on concrete benefit and bounded scope",
    contradictions: [
      {
        label: "low-priority outcomes may be submitted without a concrete benefit and bounded scope",
        pattern:
          /Low-priority[^.\n]{0,160}(?:without (?:a )?concrete benefit|regardless of (?:the )?benefit|without bounded scope)/i,
      },
    ],
  },
  {
    label: "optional-work category gate",
    pattern: /Optional work is not categorically excluded/i,
    remediation: "do not categorically exclude optional work",
    contradictions: [
      {
        label: "optional work is categorically excluded",
        pattern: /Optional work is categorically excluded/i,
      },
    ],
  },
  {
    label: "physical-device-only exclusion",
    pattern: /physical-device-only work is excluded/i,
    remediation: "exclude physical-device-only work",
    contradictions: [
      {
        label: "physical-device-only work is allowed",
        pattern: /Physical-device-only work is (?:allowed|eligible|not excluded)/i,
      },
    ],
  },
  {
    label: "follow-up child-plan evidence requirement",
    pattern:
      /Every eligible child plan must state its parent, evidence, explicit priority and rationale, separate acceptance criteria, why it cannot remain in the owning task, and the result of checking current work for overlap/i,
    remediation:
      "require every eligible child plan to document its parent, evidence, priority and rationale, independent criteria, why it cannot remain with the owner, and an overlap check",
  },
  {
    label: "follow-up dependency rule",
    pattern:
      /Each generated child depends on every unfinished accepted task present when it is created, and later generated siblings wait behind earlier generated siblings[\s\S]{0,150}Unapproved drafts do not block it; tasks added later are not retroactively added as dependencies/i,
    remediation:
      "snapshot dependencies on unfinished accepted work, sequence generated siblings, exclude unapproved drafts, and do not add later tasks retroactively",
    contradictions: [
      {
        label: "unapproved drafts block generated children",
        pattern: /Unapproved drafts (?:do|should|must) block/i,
      },
      {
        label: "tasks added later are retroactively added as dependencies",
        pattern: /Tasks added later are retroactively added as dependencies/i,
      },
      {
        label: "generated siblings do not wait behind earlier generated siblings",
        pattern:
          /(?:later|subsequent) generated siblings (?:do not|need not|must not) wait behind earlier generated siblings/i,
      },
    ],
  },
  {
    label: "task-platform and checker limitation",
    pattern:
      /Platform settings determine whether a submitted task immediately becomes Active or remains a Draft[\s\S]{0,150}Priority is recorded in the plan, not enforced as native task metadata[\s\S]{0,150}repository checker validates policy wording, not runtime task creation/i,
    remediation:
      "state that platform settings control Draft/Active status, priority is plan text rather than native metadata, and the checker validates wording only",
    contradictions: [
      {
        label: "priority is enforced as native task metadata",
        pattern: /Priority is enforced as native task metadata/i,
      },
      {
        label: "the repository checker enforces runtime task creation",
        pattern: /repository checker (?:enforces|controls|guards) runtime task creation/i,
      },
      {
        label: "repository policy determines task acceptance state",
        pattern:
          /(?:repository policy|this policy) (?:determines|sets|controls) whether (?:a submitted )?task (?:immediately becomes|remains) (?:Active|a Draft)/i,
      },
    ],
  },
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
      /Before creating another task[\s\S]{0,1000}document why the work cannot remain in the owning task/i,
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
    for (const contradiction of requirement.contradictions ?? []) {
      if (contradiction.pattern.test(content)) {
        failures.push(
          `${relativePath}: contradicts ${requirement.label}; remove conflicting rule that ${contradiction.label}`,
        );
      }
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
