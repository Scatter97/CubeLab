# CubeLab data-safety hardening

**Status:** In progress (pre-release hardening, branch `fix/data-integrity-hardening`).
**Started:** 2026-11-21
**Owners:** `src/lib/storage.ts`, `src/bootstrap.tsx`, `src/hooks/useSettings.ts`,
`src/hooks/useSessions.ts`, `src/hooks/useSync.ts`, `src/lib/replacement.ts`,
`src/lib/training/storage.ts`, `src/lib/syncStorage.ts`.

This document records the data-safety model, the implementation phases and the
verification evidence. It does not replace `AGENTS.md`, the synchronization
contracts in `.opencode/skills/cubelab-sync-safety/references/sync-contracts.md`
or `docs/development/INCREMENTAL_STORAGE_DESIGN.md` (still design-only).

## Phase 0 baseline — 2026-11-21

**Branch:** `fix/data-integrity-hardening` from `master` at
`3dd5aea85b73db247b20ae94366ce90b87405184`, equal to `origin/master`.
The worktree was clean before this branch was created.

**Baseline verification:**

```bash
npm run typecheck   # passed
npm test            # 119 files, 1551 tests passed
```

No pre-existing unit-test failures were observed. Browser E2E was not run for
the baseline; this task adds focused E2E coverage later.

### Current architecture

- `src/main.tsx` mounts `SingleTabGate`, which acquires the lifetime
  `cubelab-active-tab` Web Lock before `Bootstrap` or any editable hook mounts.
- `Bootstrap` resolves an interrupted replacement, applies a pending solve
  completion, then reads sessions through `loadSessionsForStartup()` and mounts
  `App`. Settings are currently read separately by `useSettings()` during the
  first render, after the editable application has already mounted.
- Sessions live at `cubelab:sessions:v1` (schema v7); settings live at
  `cubelab:settings:v1` (schema v13); Training lives at `cubelab:training:v1`
  (schema v1). Sync provenance uses `cubelab:sync:v1`; Drive status uses its own
  key; replacement uses `cubelab:replacement:v1`.
- `useSessions` holds the checked startup snapshot, publishes a solve only after
  a successful collection write, buffers accepted solves in
  `pendingCompletion` while a replacement is prepared, and refuses to write over
  a changed raw collection.
- `useDurableReplacement` journals all previous key values, writes every
  candidate, records a durable commit marker, then publishes React state. Startup
  recovery rolls prepared journals back and committed journals forward.
- `useSync` stores immutable per-device snapshots in Drive, merges via
  `src/lib/sync.ts`, keeps tombstones and exact conflict approvals, and defers
  cross-tab adoption while the timer is active.
- Training has a checked reader/writer and a separate Drive file family and sync
  ledger.

### Confirmed failure paths addressed by this work

1. `loadSettings()` is intentionally tolerant: malformed JSON, unsupported
   versions and unreadable storage all return defaults. `useSettings()` uses it
   for its initial writable state and storage events; the first effect then
   writes those defaults. A corrupt settings key can therefore be replaced by
   defaults.
2. `useSettings.replaceSettings()` and `stageSettings()` use
   `parseSettingsData(next) ?? DEFAULT_SETTINGS`. Invalid replacement input can
   publish or persist defaults instead of failing.
3. `Bootstrap` validates sessions before mounting but not settings. Settings
   corruption is discovered only after editable hooks are live.
4. `useSync`'s storage-event handlers call tolerant `loadSessions()` and
   `loadSettings()`. A failed external read can be adopted as an empty/default
   collection/settings, and a committed replacement can be published without
   validating every participating collection.
5. Startup normalization/migration (legacy solves, sessions v1–v6, settings
   v1–v12) rewrites data through the initial hook effects without first archiving
   the exact original bytes.
6. The recovery gate only offers Retry. A user whose data cannot be validated
   has no in-app way to download the raw bytes or inspect the blocked stores.
7. Persistence/quota state is not surfaced in Settings; a failed write is only
   visible as a transient lock/status indicator.

### Existing safe behavior to preserve

- Lifetime single-tab ownership; no focus or heartbeat lock stealing.
- Checked sessions startup read with raw-byte retention and explicit throw.
- Prepared/committed replacement journal, exact raw rollback and cleanup-pending
  handling.
- Pending completion buffer for accepted solves during replacement.
- Raw millisecond solves, stable IDs, tombstones, Undo provenance, exact review
  approvals and per-device immutable Drive snapshots.
- Training's checked reader, v1 schema and separation from solve storage/Drive
  filenames.
- Site reset's explicit destructive controls and gate.
- Native backup v1, compact/checked gzip limits and Drive solve/Training limits.

### Compatibility assumptions

- Session schema v7, settings schema v13 and Training schema v1 remain current.
- `cubelab:sessions:v1` and `cubelab:settings:v1` key names stay unchanged.
- Native backup v1, solve Drive envelopes/snapshots and Training Drive/sync wire
  formats stay unchanged unless a migration is explicitly added.
- Historical settings have no mandatory per-version migration table: the v13
  parser fills documented defaults for fields added in later versions.
- The recovery archive and recovery package are local-only formats. They are not
  uploaded automatically and do not alter Drive snapshots.

### Phase plan

1. Checked settings reader and non-destructive replacement writers.
2. Verified pre-upgrade archive and recoverable migration sequence.
3. Checked cross-tab/replacement adoption and sync failure isolation.
4. Recovery center, raw recovery package, archive restore and export-and-reset.
5. Persistence/quota status and non-destructive quota behavior.
6. Frozen historical fixtures and `npm run check:data`.
7. Failure-injection integration, large-history and PWA checks.
8. Documentation, release checklist and final regression evidence.

Sections below are updated as each phase is verified.

## Phase 1 — checked settings readers (verified 2026-11-21)

- `loadSettingsChecked()` returns a discriminated result with `unavailable`,
  `read-error`, `invalid-json`, `invalid-schema` and `unsupported-version`
  failures. Only a genuinely absent key yields defaults; the reader never writes.
- `loadSettingsForStartup()` preserves documented memory-only mode only when no
  storage API exists. `loadSessionsChecked()` now provides the equivalent strict
  session reader (`absent` is distinct from corrupt/unsupported data).
- `Bootstrap` validates both sessions and settings before mounting `App`, and
  passes the checked snapshots into `useSessions`/`useSettings` so startup does
  not read the collections twice.
- `useSettings` uses checked reads for its initial state and storage events.
  `replaceSettings`/`stageSettings` reject incomplete or invalid replacements
  without changing visible or persisted state. The tolerant `loadSettings()`
  remains only for presentation/import-option reads and is documented as
  unsuitable for writable state.
- `useSync` replacement and cross-tab session adoption now require checked
  reads. Invalid external settings/sessions are ignored rather than adopted.
- Verification: `npm run typecheck`, `npm run lint`, and
  `npm test -- src/lib/storage.test.ts src/hooks/useSettings.test.ts
  src/lib/startupDataSafety.test.tsx src/hooks/useSync.test.ts` (4 files,
  168 tests passed).

## Phase 2 — verified upgrade archives (verified 2026-11-21)

- `src/lib/upgradeArchive.ts` stores exact pre-upgrade key bytes in IndexedDB
  (`cubelab-upgrade-archive`) or, only when IndexedDB cannot be opened, in
  CubeLab-owned localStorage keys. Archive records carry format/version, unique
  ID, time, app version, source versions, included keys, present-vs-absent
  state, exact strings, per-entry checksums and an overall manifest. A write is
  re-read and verified before it is accepted.
- Retention keeps the two newest verified archives plus the newest completed
  last-known-good checkpoint. Failed cleanup never deletes the only copy.
- `src/lib/startupMigration.ts` runs under the lifetime active-tab lock after
  replacement and pending-completion recovery. It reads strictly, archives,
  re-reads the archive, validates the complete candidate, starts the existing
  replacement journal (`kind: 'upgrade'`), writes both candidates, verifies the
  exact bytes, records the commit marker, revalidates schemas, and only then
  clears the journal. A failure before/after any boundary restores or retains a
  recoverable state; already-current canonical records are not rewritten.
- The replacement journal is the only transaction marker. Prepared upgrades roll
  back at startup; committed upgrades roll forward. The archive is separate and
  is never treated as a substitute for the journal.
- Verification: `npm run typecheck`, `npm run lint` and
  `npm test -- src/lib/upgradeArchive.test.ts src/lib/startupMigration.test.ts
  src/lib/startupRecovery.test.ts src/hooks/useSettings.test.ts
  src/hooks/useSessions.test.ts src/lib/startupDataSafety.test.tsx`
  (6 files, 78 tests passed), including injected failures at every listed
  transition and crash-before/after-commit recovery.


