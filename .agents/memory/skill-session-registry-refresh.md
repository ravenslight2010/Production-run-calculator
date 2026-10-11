---
name: Project skill session refresh
description: Skill visibility after adding or editing a project-local Replit Agent skill.
---

Adding a skill under the project’s `.agents/skills/` directory registers it for the project, but an already-open Agent chat may retain its earlier skill list. Replit documents that the change should appear in a new chat; if it does not, open a new thread or restart the project. Team-wide skills are managed in Workspace Settings → Customization → Skills.

**Why:** A search can find the new project file while the current session’s injected skill list remains stale, so search results alone do not prove that this chat can invoke it.

**How to apply:** After adding or editing a skill, validate the project file and use a new chat to verify session availability before claiming it is loaded.
