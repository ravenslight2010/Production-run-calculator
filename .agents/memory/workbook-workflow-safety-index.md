---
name: Workbook workflow safety index
description: Pointers to multi-file preparation, reload, shipping and generation-guard decisions.
---

- [Multi-file reads](multi-file-ai-import.md): sequential reads, safe merge and review before commit.
- [Premix](premix-import.md): deterministic parsing and review.
- [Form reloads](web-form-button-submit-reload.md): diagnose accidental form submission.
- [Cold starts](cold-start-import-hang.md): distinguish lazy loading from stalled preparation.
- [Shipping](shipping-guide-import.md): omit unknown mappings rather than guessing.
- [Generation guards](import-gen-guard.md): old async preparation must not replace a newer review.
