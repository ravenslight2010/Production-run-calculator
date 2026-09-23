---
name: Onboarding acknowledgement latch
description: Prevent duplicate first-login acknowledgement requests when a dialog action and controlled close callback fire together.
---

The first-login dialog can invoke its dismissal callback more than once during one user action. The acknowledgement path must latch synchronously before starting the request, while browser coverage must still await and assert the real server response.

**Why:** The dialog action closes the controlled dialog and its `onOpenChange` callback can immediately close it again before the cached user identity reflects the server update.

**How to apply:** Keep the latch at the shared onboarding hook boundary so web and mobile dialogs cannot issue duplicate acknowledgements; do not compensate with browser retries or relaxed response assertions.