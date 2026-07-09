---
name: Open form clobbers profiles
description: Web run form is a write-source for its brand+flavor profile on every navigation; out-of-band profile writes (spec import) must reload the open form, and identity changes without a profile must reset to defaults.
---

# Open form clobbers profiles

Two related invariants in the web app:

**Rule 1: Anything that rewrites a profile out-of-band must reload any OPEN run form for that profile.**
- **Why:** Every navigation path (switch/add/delete run, change brand/flavor) saves the currently open form back to its brand+flavor profile. If a spec import (or any other out-of-band writer) updates a profile while a run for that brand+flavor is open, the stale form silently re-saves the pre-import values over the fresh profile on the very next navigation. To the user this looks like "I re-imported my specs but nothing changed."
- **How to apply:** The spec-import commit returns the touched {brand, flavor} list and the confirm handler reloads the current run's form when touched. Any NEW out-of-band profile writer needs the same treatment: save+stamp the run values, reset the form, and push. Because commit is async, re-resolve the current run from the live day-state ref AFTER the await — the captured run may be stale.

**Rule 2: Changing a run's brand/flavor to an identity with NO saved profile must reset the form to defaults.**
- **Why:** The identity-change path used to load a profile only if one existed, with no else — the previous product's values silently stayed in the form under the new identity, then got saved as that identity's profile on the next nav. This is how one profile got contaminated with another product's applicator values in production.
- **How to apply:** No-profile branch resets the form (and field arrays) to defaults.

Related: profile-clobber-blank-form.md (blank-form autosave variant), server-empty-over-populated-guard.md. Note brandProfiles sync receive is remote-wins per key with NO stamps — a known systemic weakness left unfixed.
