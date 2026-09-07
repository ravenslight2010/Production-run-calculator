# Operational report signing-key rotation preflight

Before changing `OPERATIONAL_REPORT_SIGNING_KEYS` in a target environment, run
the fail-closed preflight against that environment:

```sh
DATABASE_URL='postgresql://...' \
OPERATIONAL_REPORT_SIGNING_KEYS='{"activeKeyId":"next","keys":{"next":"<value>","previous":"<value>"}}' \
REPORT_KEY_ROTATION_PREFLIGHT_ENVIRONMENT=production \
pnpm --filter @workspace/scripts run audit:report-key-rotation
```

The command exits successfully only when:

- the keyring parses and contains a valid active key;
- every distinct `proofKeyId` used by retained finalized reports is present in
  the keyring; and
- the bounded audit is complete rather than truncated.

A non-zero exit blocks rotation. Restore the keyring or database access, retain
the missing key IDs, or run a complete audit as directed by the remediation
output. The output and optional evidence file contain key IDs only; key values
are never printed or persisted.

The standard release checker runs this same preflight against its configured
target database before the remaining release gates. Disposable CI supplies a
non-production fixture keyring and an empty database so the gate is exercised
without treating CI as production evidence.