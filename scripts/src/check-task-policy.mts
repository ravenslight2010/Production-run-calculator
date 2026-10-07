import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

type Requirement = {
  label: string;
  pattern: RegExp;
  remediation: string;
  contradictions?: { label: string; pattern: RegExp }[];
};

// Wording contracts only: these do not read acceptance events or decide eligibility.
const orderingRequirements: Requirement[] = [
  {
    label: "universal future acceptance coverage",
    pattern: /Clicking Accept establishes precedence[\s\S]{0,80}all future[\s\S]{0,80}manually planned[\s\S]{0,120}generated follow-ups of every category[\s\S]{0,200}standalone suggestions[\s\S]{0,80}main-workspace\s+work[\s\S]{0,80}isolated task agents/i,
    remediation: "apply acceptance precedence to every future task origin and execution workspace",
    contradictions: [
      { label: "ordering applies only to generated children", pattern: /(?:ordering|acceptance[- ]order (?:policy|rule)) applies only to generated (?:children|follow-ups)/i },
      { label: "the superseded creation-time generated-child rule is required", pattern: /Each generated child depends on every unfinished accepted task present when it is created|later generated siblings wait behind earlier generated siblings/i },
    ],
  },
  {
    label: "acceptance-first numeric verified ties",
    pattern: /Acceptance order is primary; lower task number[\s\S]{0,50}only a verified acceptance-order tie[\s\S]{0,100}Compare\s+numeric task refs numerically, not lexicographically[\s\S]{0,260}Creation time and task number never override known acceptance order/i,
    remediation: "use acceptance order first and numeric refs only for verified ties",
    contradictions: [
      { label: "creation time determines precedence", pattern: /(?:Creation time|creation order|createdAt) (?:is primary|determines precedence|establishes precedence|takes precedence)/i },
      { label: "task number is primary", pattern: /(?:Task (?:number|ref)|lower task number|numeric task refs?) (?:is primary|determines precedence|takes precedence|always goes first)|(?:Order|sort) (?:all )?tasks by (?:task number|numeric ref) first/i },
      { label: "task number breaks unverified order", pattern: /(?:unknown|missing|unverified) acceptance (?:order|evidence)[^.\n]{0,100}(?:fall back|fallback|use (?:the )?(?:task number|creation time))/i },
    ],
  },
  {
    label: "startup complete evidence and persisted prerequisites",
    pattern: /Before substantive execution,[\s\S]{0,80}complete inventory and reliable acceptance-order evidence[\s\S]{0,160}every unfinished task accepted earlier is a persisted prerequisite[\s\S]{0,100}wait for those prerequisites to finish/i,
    remediation: "require complete inventory, reliable acceptance evidence, persisted earlier prerequisites, and waiting before work",
  },
  {
    label: "explicit advisory blockers",
    pattern: /Missing evidence, missing dependency links, or unfinished prerequisites produce an explicit blocked\/advisory outcome, not a claim of compliant execution/i,
    remediation: "report missing evidence, links, and unfinished prerequisites as blocked/advisory",
  },
  {
    label: "unfinished states and drafts",
    pattern: /Unapproved drafts do not block work; accepted work\s+awaiting merge remains unfinished; merged or archived work does not block/i,
    remediation: "exclude drafts and finished work but include accepted work awaiting merge",
    contradictions: [
      { label: "unapproved drafts block work", pattern: /Unapproved drafts (?:do|should|must) block/i },
      { label: "awaiting merge is finished", pattern: /accepted work awaiting merge (?:is finished|does not block)/i },
    ],
  },
  {
    label: "later acceptance and genuine prerequisites",
    pattern: /Later acceptances are not retroactively added as ordering dependencies[\s\S]{0,100}Preserve genuine prerequisite dependencies rather than erasing them/i,
    remediation: "exclude retroactive ordering edges while preserving genuine prerequisites",
    contradictions: [
      { label: "later acceptance retroactively blocks earlier work", pattern: /Later acceptances (?:are|must be) retroactively added|(?:Erase|remove) (?:all )?genuine prerequisite dependencies/i },
    ],
  },
  {
    label: "unknown acceptance provenance",
    pattern: /Creation\/update timestamps are not acceptance evidence;\s+unknown acceptance order stays unknown/i,
    remediation: "do not invent acceptance evidence from creation/update timestamps",
    contradictions: [
      { label: "acceptance timestamps are invented from task timestamps", pattern: /(?:Use|derive|infer|set) (?:the )?(?:acceptedAt|acceptance timestamp|acceptance time)[^.\n]{0,100}(?:createdAt|updatedAt|creation time|update time)|(?:Creation\/update timestamps|createdAt|updatedAt) (?:are|is) (?:reliable )?acceptance evidence/i },
    ],
  },
  {
    label: "advisory versus scheduler boundary",
    pattern: /An advisory agent\s+check cannot intercept acceptance or pause platform execution[\s\S]{0,100}Documentation or a passing checker does not enforce scheduling/i,
    remediation: "distinguish agent advice and wording checks from unavailable acceptance/scheduling enforcement",
    contradictions: [
      { label: "documentation or checker enforces scheduling", pattern: /(?:Documentation|(?:a )?passing checker|(?:the )?policy checker) (?:enforces|guarantees|controls) (?:scheduling|acceptance order)|(?:An )?advisory agent check (?:pauses|suspends) (?:the )?(?:scheduler|platform execution)/i },
    ],
  },
];

const requirements: Requirement[] = [
  ...orderingRequirements,
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

const taskAgentStartupRequirements: Requirement[] = [
  {
    label: "task startup rules and applicable skills",
    pattern:
      /Before substantive work in either the main workspace or an isolated task copy:[\s\S]{0,260}Read the current task record, scope, and dependencies[\s\S]{0,220}applicable project skills in `\.agents\/skills\/`[\s\S]{0,240}Complete the acceptance\/dependency preflight/i,
    remediation:
      "require task agents to refresh task context, read applicable skills, and complete the existing acceptance/dependency preflight",
  },
  {
    label: "evidence-first access before asking the user",
    pattern:
      /Before asking the user for evidence, first retrieve it through available authorized workspace, Replit, deployment, or connected-service access[\s\S]{0,240}Ask only for a decision, permission, or access grant the user controls/i,
    remediation:
      "retrieve available evidence through authorized workspace and connected-service access before asking the user",
  },
  {
    label: "owning-task investigation and verification",
    pattern:
      /Keep all in-scope investigation through final verification in the owning task[\s\S]{0,240}Apply the separate-task exceptions[\s\S]{0,200}do not split symptoms, failures, or validation into child tasks/i,
    remediation:
      "keep same-objective investigation and validation with the owning task and use only documented follow-up exceptions",
  },
  {
    label: "supported instruction delivery and stale-session boundary",
    pattern:
      /Replit documents \[?`replit\.md`[\s\S]{0,240}project skills in `\.agents\/skills\/`[\s\S]{0,260}isolated project copy[\s\S]{0,240}do not receive real-time updates[\s\S]{0,360}AGENTS\.md`?[\s\S]{0,80}automatic task-agent entry point/i,
    remediation:
      "document the supported Replit entry points, task snapshot behavior, and explicit AGENTS.md read requirement",
  },
];

const agentEntryRequirements: Requirement[] = [
  {
    label: "Replit task-agent startup pointer",
    pattern:
      /For Replit main-workspace and isolated task agents, follow the \[task-agent startup and evidence-access instructions\]\(replit\.md#task-agent-startup-and-evidence-access\) before substantive work/i,
    remediation:
      "point Replit main-workspace and isolated task agents to the supported startup entry point",
  },
];

const root = resolve(
  process.env.TASK_POLICY_ROOT ?? resolve(import.meta.dirname, "../.."),
);
const failures: string[] = [];

const procedureRequirements: Requirement[] = [
  ...orderingRequirements,
  {
    label: "complete state inventory procedure",
    pattern: /PENDING[\s\S]{0,80}IN_PROGRESS[\s\S]{0,80}IMPLEMENTED[\s\S]{0,80}MERGING[\s\S]{0,80}QUEUED[\s\S]{0,300}truncated: false[\s\S]{0,100}totalCount[\s\S]{0,200}incomplete, stop/i,
    remediation: "check all unfinished accepted states and stop on incomplete reads",
  },
  {
    label: "acceptance provenance procedure",
    pattern: /owner-attested sequential\/batch acceptance receipts[\s\S]{0,600}Missing acceptance evidence produces[\s\S]{0,80}acceptance order unknown/i,
    remediation: "require reliable provenance and report unknown acceptance order explicitly",
  },
  {
    label: "manual recording and race boundary",
    pattern: /read\/create race[\s\S]*?dependsOn[\s\S]*?updateProjectTask[\s\S]{0,120}replaces[\s\S]{0,120}full list[\s\S]{0,180}genuine existing prerequisites/i,
    remediation: "document non-atomic manual recording and full-list prerequisite preservation",
  },
  {
    label: "bounded receipt procedure",
    pattern: /Record a bounded outcome[\s\S]{0,1000}Capture time is not acceptance time; do not fabricate times/i,
    remediation: "retain bounded provenance outcomes without fabricated acceptance times",
  },
  {
    label: "future-only current record exclusion",
    pattern: /user handles existing tasks[\s\S]{0,180}Do not change[\s\S]{0,180}current task record, dependency, scope, acceptance, assignment, or automation/i,
    remediation: "leave existing task records and settings to the user",
  },
  {
    label: "sequential acceptance limitations",
    pattern: /User-coordinated sequential acceptance[\s\S]{0,1000}automatically[\s\S]{0,60}accept\/start work[\s\S]{0,100}unavailable/i,
    remediation: "document sequential acceptance as a bounded alternative unavailable with automatic intake",
  },
];

for (const [relativePath, documentRequirements] of [
  ["AGENTS.md", requirements],
  ["replit.md", requirements],
  ["docs/follow-up-dependency-submission.md", procedureRequirements],
] as const) {
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

  const additionalRequirements =
    relativePath === "replit.md"
      ? taskAgentStartupRequirements
      : relativePath === "AGENTS.md"
        ? agentEntryRequirements
        : [];

  for (const requirement of [...documentRequirements, ...additionalRequirements]) {
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
