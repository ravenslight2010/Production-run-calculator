---
name: Docker Compose environment-file replacement
description: Safely replacing Compose service env files for disposable runtime tests.
---

When a disposable Compose check must replace a service's existing `env_file`,
use the Compose `!override` tag rather than an ordinary scalar or list overlay.
Require Docker Compose 2.24.4 or newer, supply the replacement file from a
temporary directory, and verify the fully resolved `DATABASE_URL` before
starting any services. Clear ambient database and Compose interpolation
variables so the isolated test file is the only source of those values.

**Why:** An ordinary overlay can remain additive and still make Compose open the
repository's `.env`. That can break clean CI runs or accidentally direct a
schema-mutating migration at a shared database.

**How to apply:** For a Docker runtime rehearsal, point API and migration
services at a mode-600 temporary env file with `env_file: !override`, use a
project-unique Postgres service, and fail before `up` unless the resolved
database URL names that service.
