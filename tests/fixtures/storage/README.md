# Frozen storage compatibility fixtures

**Status:** Synthetic compatibility corpus, frozen 2026-11-21.
These files are **not** captured production user data. They are minimal
fixtures derived from the historical parser contracts and existing storage
tests. Do not present them as verified historical samples.

## Files

| File | Contract |
| --- | --- |
| `sessions-v1.json` … `sessions-v7.json` | Session collection schemas 1–7 at `cubelab:sessions:v1`. v7 includes a competition session, ordering and a transfer record. |
| `settings-v1.json` … `settings-v13.json` | Settings schemas 1–13 at `cubelab:settings:v1`. v13 contains the complete current settings object. |
| `training-v1.json` | Current Training schema v1 (`cubelab:training:v1`). |
| `native-backup-v1.json` | Native backup format v1 without a Training section. |
| `sync-v1.json` | Solve synchronization provenance v1 (`cubelab:sync:v1`). |
| `legacy-solves-v1.json` | Legacy single-session solve store (`cubelab:solves:v1`). |
| `replacement-prepared-v1.json`, `replacement-committed-v1.json` | Valid replacement journals at the two durable phases. |
| `*-malformed.json`, `*-truncated.json`, `*-future.json` | Negative fixtures used to prove fail-closed behavior and zero writes. |

## Compatibility contract

- A valid historical fixture must load, migrate in memory, revalidate, serialize
  and reload without losing solve IDs, session IDs, raw milliseconds, penalties,
  scrambles, comments, dates, events, ordering, competition rounds, transfers,
  settings values, Training attempts/calibrations or sync provenance.
- Known older session/settings versions migrate by filling documented defaults.
  Unknown future versions are rejected; they are never rewritten by an older
  build.
- Session and settings parsers intentionally **drop unknown fields** at the
  record and top level. Any future field therefore requires a schema-version
  increase, a migration and a new frozen fixture. Do not add silent additive
  fields to those payloads.
- Training explicitly permits unknown additive JSON fields; the loader clones and
  retains them.
- Native backup v1, Drive snapshot/envelope v1 and Training sync v1 remain wire
  compatible. A changed wire format needs an independently justified migration.
- Negative fixtures must produce a structured failure, preserve exact bytes and
  perform no writes. No default snapshot, tombstone or Drive publication may be
  generated from them.

## Updating

Add a new fixture when a schema version is introduced or a wire format changes.
Keep old fixtures unchanged. `npm run check:data` runs the authoritative
compatibility, migration, recovery and checked-adoption suites.
