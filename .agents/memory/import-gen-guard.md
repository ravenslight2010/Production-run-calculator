---
name: Import generation guards + no post-import hijack
description: Why slow import prepares need per-kind generation refs and why the post-import merge scan must not force navigation.
---

# Import generation guards

Rule: every slow async "prepare" flow behind an import dialog (spec/premix/cheese/shipping) must capture a per-kind generation ref at start and guard ALL state writes (prepared, error, progress callback, and the `finally` loading reset) on the generation still being current. Dialog `onClose` bumps the generation and clears loading/progress.

**Why:** AI-backed parses take 1–2 minutes. Users importing files back-to-back close the dialog and pick the next file while the old parse is still in flight; the old promise then resolves late and clobbers the new import's state — stale file info, wrong step, spinners flipping off early. This was the reported "importing acts up between each one" bug.

**How to apply:** any NEW import kind (or any other dialog-scoped slow async prepare) must follow the same pattern — see the existing `*ImportGenRef` handlers in the web home page.

# No backdrop-click close on import dialogs

Rule: the import dialogs (spec/premix/cheese/excel) must NOT close on a click of the dim backdrop — close is explicit only (X / Cancel buttons). If the user explicitly closes while a parse is still in flight, show an "Import canceled" toast.

**Why:** the AI parse runs 30–60s. A stray tap on the backdrop mid-parse closed the dialog, bumped the generation, and silently discarded the finished parse — to the user "I picked the file and nothing happened" (production logs showed the parse + match both returning 200 with no result ever displayed). The review step also holds unsaved edits a stray tap would wipe.

**How to apply:** any new import-style dialog gets no `onClick={onClose}` on the overlay, and its `onClose` handler in the page toasts when the loading flag was still true.

# No post-import navigation hijack

Rule: the post-import duplicate-ingredient merge scan runs in the BACKGROUND; if it finds groups, a toast with a "Review" action offers navigation to Setup→Merge — it never force-navigates.

**Why:** force-navigating to the Merge screen after every import made sequential imports feel broken ("import buttons stopped responding" = user was yanked to a different screen). The auto-scan itself is a user-requested feature and stays.
