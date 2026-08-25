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