# Docker builder Debian snapshot review

The API image builder installs `git`, `python3`, and `build-essential` from a
fixed Debian snapshot in `Dockerfile`. This keeps rebuilds reproducible, but
does not automatically pick up later Debian security updates.

## Review cadence and trigger

- Review the pinned package set quarterly, during the first week of January,
  April, July, and October.
- Review sooner when a Debian Security Advisory affects an installed builder
  package or a security issue in the pinned Node base image requires an update.
- Compare the installed package set with Debian's security advisories and
  determine whether a newer Debian snapshot contains a relevant fix. Record
  the review date and outcome below, including when no refresh is needed.

## Refresh requirements

1. Update the literal Debian snapshot timestamp in `Dockerfile` only in a
   reviewed change. Do not add a build-argument override or silently move the
   snapshot during an unrelated edit.
2. Record the reason for the refresh, the old and new timestamps, relevant
   advisory identifiers, and the exact builder package versions from the
   resulting build in the review record below.
3. Verify the change with a no-cache API image build:

   ```sh
   docker build --no-cache --progress=plain --target api \
     -t runcalc-api:debian-snapshot-review .
   ```

   The builder stage prints the exact versions of `build-essential`, `git`,
   the GCC/G++ compiler and meta-packages, `make`, and Python 3 packages.
   Retain those lines in the reviewed build evidence and copy them into the
   review record.

## Review record

### 2026-10-05 — baseline, no snapshot change

- Snapshot: `20260824T000000Z`
- Base image: `node:24.20.0-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e`
- Reason: establish the initial version record and review cadence; no package
  refresh was approved as part of this change.
- No-cache API image build: passed on 2026-10-05 with
  `docker build --no-cache --progress=plain --target api -t runcalc-api:debian-snapshot-review .`
- Builder package versions (`dpkg-query -W` output; package then version):

  | Package | Version |
  | --- | --- |
  | `build-essential` | `12.9` |
  | `g++` | `4:12.2.0-3` |
  | `g++-12` | `12.2.0-14+deb12u1` |
  | `gcc` | `4:12.2.0-3` |
  | `gcc-12` | `12.2.0-14+deb12u1` |
  | `git` | `1:2.39.5-0+deb12u3` |
  | `make` | `4.3-4.1` |
  | `python3` | `3.11.2-1+b1` |
  | `python3-minimal` | `3.11.2-1+b1` |
  | `python3.11` | `3.11.2-6+deb12u8` |
  | `python3.11-minimal` | `3.11.2-6+deb12u8` |
