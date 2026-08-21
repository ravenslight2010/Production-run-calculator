---
name: Correcting-import alias cleanup
description: Behavioral rule for bad-alias deletion + reverse-alias learning after a correcting spec re-import
---

Rule: when a spec import overwrites a stored name with a DIFFERENT one, that's a correction — delete the alias that minted the old wrong name and learn the reverse alias (old → new, mirrored to AI corrections).

**Why:** a surviving bad alias re-applies the wrong name on the next import, silently undoing the manager's correction; without the reverse alias, older workbooks that still use the wrong name stop redirecting.

**How to apply:**
- Never delete when the old name is still live anywhere it could legitimately resolve, and treat "pool fetch failed" as live/unknown (fail safe: skip deletion, still learn the reverse alias).
- Delete a correcting-import alias by its complete identity, including an explicitly empty context; never let a correction for one scope erase a sibling scoped alias.
- Reverse aliases must flow through the normal sanitize+save path so poison guards apply.
