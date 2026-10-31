---
name: Workflow configuration side effects
description: Check aggregate workflows after updating an individual workflow through the Replit workflow interface.
---

After configuring one workflow, inspect the aggregate `Project` workflow as well as the individual command. The configuration interface may add the updated workflow as a parallel Project task, changing startup behavior beyond the named workflow.

**Why:** An individual validation-workflow update also changed the Project workflow's task list, which can make a long test suite run alongside release checks.

**How to apply:** Review the resulting workflow list and project configuration after every workflow update; account for any automatically added aggregate task before verifying the change.
