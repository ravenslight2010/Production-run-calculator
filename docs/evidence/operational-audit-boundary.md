# Operational audit boundary for recipe changes

Cheese recipe creates, meaningful updates, and deletions write one append-only
audit record per affected recipe in the same database transaction as the recipe
mutation. A failed audit insert rolls back the recipe change.

Each record contains the authenticated actor ID, the recipe identifier, the
action, the database timestamp, the server-generated request correlation ID,
and only the changed recipe field names. Creates and deletions list all recipe
fields; updates list only fields whose persisted values changed. Recipe values,
request bodies, ingredient names, notes, and network metadata are not copied
into these audit events.

Audit records are readable only through the existing live-scope manager-only
audit endpoints. The JSON read is cursor-paginated at no more than 200 rows per
page; CSV and PDF exports are capped at 5,000 rows. Callers cannot select or
override the audit scope.

This evidence is forward-looking: it attributes recipe writes made after the
audit event is installed and does not reconstruct earlier changes.
