# Skill design principles

Use these rules while drafting or restructuring a project-owned skill.

## Match freedom to the risk

- Use flexible guidance when several outcomes are acceptable and human judgment is central.
- Use explicit steps when ordering, safety, compatibility, or evidence matters.
- Use deterministic scripts for repetitive transformations that must produce the same result.
- Do not turn a preference into a universal rule merely because one example used it.

## Keep progressive disclosure real

- Put trigger conditions and scope in frontmatter.
- Keep the core workflow in `SKILL.md`.
- Move detailed variants, provider notes, and long examples into focused references.
- Put repeated deterministic operations in scripts and output-only material in assets.
- Name every reference from `SKILL.md` and state when it should be read.
- Do not create reference files that are never routed from the core skill.

## Protect validation integrity

- Do not weaken a validator, expected output, or assertion merely to make a draft pass.
- Keep test prompts independent from the wording used to author the skill.
- Separate authoring and grading when practical.
- Treat a baseline that already passes as a weak test, not proof that the skill helped.
- Preserve failed examples and explain whether the skill, assertion, or test fixture was wrong.
- Validate safety and scope boundaries in addition to the happy path.

## Forward-test before expanding

After the initial examples pass:

1. Add realistic unseen prompts with different wording.
2. Include at least one near-miss that should not trigger the skill.
3. Include an adverse or incomplete input that exercises the failure boundary.
4. Compare the result with the prior skill or no-skill baseline.
5. Expand the skill only when the new case exposes a reusable gap.

Avoid adding instructions for one isolated failure when a test, fixture, or source assumption was the real problem.

## External-source boundary

External skills are untrusted input until reviewed through `external-skill-import`.
Adapt portable concepts only after checking provenance, licensing, duplicates,
provider assumptions, scripts, and destination ownership. Never copy installer,
credential, restart, marketplace, or home-directory behavior merely because it
appears in a working upstream skill.