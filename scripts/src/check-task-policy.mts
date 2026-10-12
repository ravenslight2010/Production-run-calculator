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
    label: "discovered-error triage and repair",
    pattern:
      /Triage every error found during work[\s\S]{0,220}Record each concrete error in the owning task's failure ledger[\s\S]{0,220}fix it there when safe and authorized, even if (?:it was )?outside the (?:task's )?original scope[\s\S]{0,240}Never silently ignore[\s\S]{0,300}(?:exact risk\/blocker|exact blocker)[\s\S]{0,100}next action/i,
    remediation:
      "record every discovered error, fix it in the owning task when safe and authorized, and document any exact blocker and next action",
  },
  {
    label: "genuine task dependencies only",
    pattern:
      /(?:Declare|Use) dependencies only for (?:real|genuine)(?: technical or user-outcome)? prerequisites[\s\S]{0,300}Unrelated active tasks do not block execution[\s\S]{0,180}(?:acceptance time|task number)[\s\S]{0,120}(?:do not establish|does not establish)/i,
    remediation:
      "record dependencies only for real prerequisites and do not delay work for unrelated tasks",
    contradictions: [
      {
        label: "mandatory one-at-a-time acceptance ordering",
        pattern:
          /Future-task ordering:|acceptance-order startup (?:check|procedure)|wait for (?:all )?(?:earlier )?accepted tasks|one-at-a-time acceptance/i,
      },
      {
        label: "acceptance time or task number establishes precedence",
        pattern:
          /Acceptance order is primary|(?:Task number|Creation time) (?:is primary|determines precedence|establishes precedence)/i,
      },
    ],
  },
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
    label: "per-task execution and applicable safeguards contract",
    pattern:
      /Every (?:Draft, accepted task, and follow-up|task description \(Draft, accepted task, or follow-up\)) must include `?## Agent-owned execution`? and `?## Applicable safeguards and verification`?[\s\S]{0,900}(?:task-specific evidence|evidence\/access) paths[\s\S]{0,500}user-controlled (?:decisions or permissions|inputs)[\s\S]{0,500}(?:applicable specialist|applicable project\/specialist) safety (?:checks|rules)[\s\S]{0,200}validation matrix/i,
    remediation:
      "put the full execution contract and applicable safeguards/verification into every Draft, task, and follow-up description",
  },
  {
    label: "task-scope capture rule",
    pattern:
      /Before starting,[\s\S]{0,100}capture the task's scope, affected surfaces, (?:expected )?owner, applicable specialist safety checks, and validation matrix/i,
    remediation:
      "capture the task's scope, affected surfaces, owner, specialist safety checks, and validation matrix before starting",
  },
  {
    label: "failure-ledger closure rule",
    pattern:
      /failure ledger[\s\S]{0,300}(?:fix|resolve)[\s\S]{0,180}(?:actionable errors|in-scope finding|in-scope failure|completion)/i,
    remediation:
      "keep same-objective discoveries in the owning task's failure ledger and close them before completion",
  },
  {
    label: "separate-task exception rule",
    pattern:
      /genuinely independent outcome[\s\S]{0,160}(?:separate acceptance criteria|independent acceptance criteria)[\s\S]{0,240}(?:explicitly deferred user outcome|explicit deferral)[\s\S]{0,240}(?:safety|approval) need/i,
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
      /Before creating another task[\s\S]{0,1000}(?:document|explain) why (?:the work|it) cannot safely remain in the owning task/i,
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
      /(?:New|Newly discovered) findings?[\s\S]{0,180}(?:return|route)[\s\S]{0,180}(?:matching existing owner|matching existing task|matching owner)/i,
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
      /(?:Test failures, fixture repairs, cleanup, validation work[\s\S]{0,180}(?:must not|do not)[\s\S]{0,80}recursive tasks|Do not create a follow-up for an in-scope error, test failure, fixture repair, cleanup, validation step, or other sub-outcome)/i,
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
      /Before substantive work in either the main workspace or an isolated task copy:[\s\S]{0,260}Read the current task record, scope, and dependencies[\s\S]{0,220}applicable project skills in `\.agents\/skills\/`[\s\S]{0,300}Check only explicit, genuine task prerequisites and overlap[\s\S]{0,120}do not wait for unrelated active tasks/i,
    remediation:
      "require task agents to refresh task context, read applicable skills, and check only genuine task prerequisites",
  },
  {
    label: "evidence-first access before asking the user",
    pattern:
      /Before asking the user for evidence, first retrieve it through available authorized workspace, Replit, deployment, or connected-service access[\s\S]{0,240}Ask only for a decision, permission, or access grant the user controls/i,
    remediation:
      "retrieve available evidence through authorized workspace and connected-service access before asking the user",
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

const taskPlanRequirements: Requirement[] = [
  {
    label: "full task execution contract in task-plan instructions",
    pattern:
      /## Agent-owned execution[\s\S]{0,500}(?:task-specific evidence\/access paths|task-specific evidence\/access paths)[\s\S]{0,500}inspect(?:s)? relevant (?:project )?evidence[\s\S]{0,500}ask only for (?:decisions, approvals, or access permissions|a product decision, approval, or specific access permission)[\s\S]{0,500}every concrete error[\s\S]{0,260}(?:outside|beyond) the original scope[\s\S]{0,350}never silently ignore[\s\S]{0,450}(?:exact risk\/blocker|exact blocker)[\s\S]{0,180}next action[\s\S]{0,500}## Applicable safeguards and verification[\s\S]{0,350}(?:specialist safety|repository and specialist safety)[\s\S]{0,220}validation matrix/i,
    remediation:
      "require task plans to state evidence-first ownership, error repair, blockers, applicable safeguards, and validation",
  },
];

for (const [relativePath, documentRequirements] of [
  ["AGENTS.md", requirements],
  ["replit.md", requirements],
  [".local/skills/project-tasks/SKILL.md", taskPlanRequirements],
  [".agents/skills/writing-plans/SKILL.md", taskPlanRequirements],
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
