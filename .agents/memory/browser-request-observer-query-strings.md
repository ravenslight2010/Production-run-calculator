---
name: Browser request observers and query strings
description: Playwright route patterns and request observers behave differently when production endpoints append query parameters.
---

When browser coverage only observes an outgoing request, prefer a page request
listener that checks the method and parsed URL pathname. A route interception
glob can fail to observe a production request once the endpoint adds query
parameters, even though the request still reaches the server.

**Why:** A wake-claim browser check appeared to record no claims while the API
logs showed both production claims were accepted; the observer pattern did not
match the query-bearing URL.

**How to apply:** Use `page.on("request", ...)` for passive evidence and remove
the listener after assertions. Reserve `page.route(...)` for cases that need to
hold, modify, or fulfill a request, and include the query suffix in its match
when doing so.