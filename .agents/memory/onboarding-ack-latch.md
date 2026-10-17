---
name: Onboarding acknowledgement latch
description: Prevent duplicate first-login acknowledgement requests when a dialog action and controlled close callback fire together.
---

The first-login dialog can invoke its dismissal callback more than once during one user action. The acknowledgement path must latch synchronously before starting the request, while browser coverage must still await and assert the real server response. Also retain the identity whose unseen state opened the dialog: a same-user refresh may flip the flag before dismissal, but the acknowledgement is still owed to that user; clear the pending acknowledgement when the signed-in user changes.

**Why:** The dialog action closes the controlled dialog and its `onOpenChange` callback can immediately close it again before the cached user identity reflects the server update. A same-user cache refresh can also update `onboardingSeen` while the dialog remains open; rechecking only that mutable flag would close the UI without issuing the required POST.

**How to apply:** Keep the latch and user-identity fence at the shared onboarding hook boundary so web and mobile dialogs cannot issue duplicates or acknowledge a newly signed-in user; do not compensate with browser retries or relaxed response assertions.