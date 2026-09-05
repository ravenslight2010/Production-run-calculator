---
name: Inline skill path references
description: How the skill catalog distinguishes inline local resource paths from commands, examples, and external links.
---

Inline code in skill guides is a reference only when it is a whitespace-free, file-like path with a recognized local-resource or repository prefix. Ignore commands, URLs, globs, placeholders, directory labels, and fenced examples.

**Why:** Skill guides commonly use backticks for commands and illustrative values. Treating every code span as a file path creates false failures, while unrestricted path inference can resolve a project file from the wrong skill directory.

**How to apply:** Keep skill-local resource prefixes and explicit repository-root prefixes separate. Preserve the existing Markdown-link resolver; repository-root fallback is for inline paths only.