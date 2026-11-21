# Skill maintenance

When improving an existing skill, preserve its directory and frontmatter name,
snapshot the old version, identify the trigger and outcome being improved, and
keep the body concise. Prefer a small eval set and objective assertions over a
large benchmark; do not run the full viewer loop unless the user requests it
or trigger performance is genuinely uncertain. Never edit platform-managed
skills in place.

Do not put secrets, credentials, personal data, or destructive commands in a
skill or its evals. For high-risk skills, require explicit stop conditions and
an output contract. Before reporting completion, validate frontmatter,
references, line length, eval assertions, and the audit record.

For externally sourced guidance, require the `external-skill-import` review
first. Keep a provenance and license note in the maintenance audit, distinguish
portable principles from provider-specific mechanics, and do not copy
marketplace metadata, credential behavior, home-directory conventions, restart
instructions, or unsupported tool calls. Preserve the repository's existing
maintenance, evaluation, and packaging process instead of replacing it with
the source workflow.

Keep revisions proportionate: concise core instructions, references for detail,
scripts only for repeated deterministic work, and assets only for output
material. Choose flexible guidance where judgment is useful and exact steps
where safety or validation depends on order. Remove examples and resources that
cannot be validated.