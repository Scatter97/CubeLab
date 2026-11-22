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
  clears the journal. The journal stores only the archive ID, not a second copy
  of a large history, so migration does not fail at the localStorage quota
  boundary. A failure before/after any boundary restores or retains a
  recoverable state; already-current canonical records are not rewritten.
- A committed cleanup-pending journal no longer blocks startup forever: the
  migration archives and writes the required older-schema candidate while
  leaving that journal for normal cleanup. A committed journal is never rolled
  back as if it were prepared.
- The replacement journal is the only transaction marker. Prepared upgrades roll
  back at startup (from the verified archive when the journal carries an archive
  ID); committed upgrades roll forward. The archive is separate and is never
  treated as a substitute for the journal.
- Verification: `npm run typecheck`, `npm run lint` and
  `npm test -- src/lib/upgradeArchive.test.ts src/lib/startupMigration.test.ts
  src/lib/startupRecovery.test.ts src/hooks/useSettings.test.ts
  src/hooks/useSessions.test.ts src/lib/startupDataSafety.test.tsx`
  (6 files, 78 tests passed), including injected failures at every listed
  transition and crash-before/after-commit recovery.

## Phase 3 — checked cross-tab adoption (verified 2026-11-21)

- `useSync` cross-tab session events use `loadSessionsChecked`; corrupt,
  unsupported or missing external bytes are ignored (missing is not an empty
  collection). Timer deferral and pending-completion reconciliation are
  unchanged.
- Committed replacement adoption validates sessions, settings and sync
  provenance together before publishing any of them. A failure leaves every
  prior collection and reconciliation baseline intact and surfaces the reason.
- `loadSyncStorageChecked` validates the v1 ledger, device identity, tombstones,
  conflicts, audit entries, redirects, pending names and settings field updates
  without writing. `saveSyncStorage` refuses to overwrite an unreadable or
  partly invalid existing ledger. `useSync` starts in a failed/blocked state
  when the ledger is invalid, prevents sync publication and never creates
  deletion tombstones from a failed read.
- `useDurableReplacement` also requires checked sync provenance before opening a
  journal, so import/restore cannot overwrite provenance it could not read.
- Verification: `npm run typecheck`, `npm run lint` and
  `npm test -- src/hooks/useDurableReplacement.test.ts src/lib/syncStorage.test.ts
  src/hooks/useSync.test.ts` (3 files, 95 tests passed), plus the Phase 1/2
  focused suites. The new cases cover corrupt/future external data, repeated
  invalid events, committed replacement with one invalid collection, timer
  deferral, and unreadable sync provenance.

## Phase 4 — recovery center and export (verified 2026-11-21)

- `Bootstrap` now reports a structured failure kind (sessions, settings,
  replacement, pending completion, archive, quota, migration or storage) and
  renders `RecoveryCenter` instead of a Retry-only gate while editable hooks stay
  unmounted.
- The recovery screen lists each affected store with its validated state and
  schema version when reliable, distinguishes corrupt/future/unavailable data,
  and shows verified local archives. Retry re-runs the same strict checks without
  writing.
- `src/lib/recoveryPackage.ts` creates a versioned `cubelab-recovery` package
  containing exact allowlisted raw strings, present-vs-absent entries,
  per-record checksums, an overall manifest and accessible verified archives.
  OAuth tokens and unrelated origin storage are excluded. Emergency exports are
  not subject to the native backup size caps.
- Restoring a verified archive requires preview + confirmation, creates a new
  pre-restore archive first, writes only sessions/legacy solves/settings through
  the existing replacement journal and verifies exact read-back.
- Export-and-start-fresh requires a successfully prepared recovery copy, an
  explicit saved-file acknowledgement and the exact typed phrase
  `RESET CUBELAB`. It removes local data/recovery records but keeps verified
  archives, caches, the service worker and all Google Drive files.
- Verification: `npm run typecheck`, `npm run lint` and
  `npm test -- src/components/RecoveryCenter.test.tsx
  src/lib/recoveryPackage.test.ts src/lib/startupDataSafety.test.tsx`
  (3 files, 25 tests passed). Covered exact-byte export, large payloads,
  tampered-archive rejection, archive preview/confirmation, failed removal and
  typed destructive confirmation.

## Phase 5 — storage persistence and data health (verified 2026-11-21)

- `src/lib/storagePersistence.ts` wraps `navigator.storage.persisted()`,
  `persist()` and `estimate()` defensively. Unsupported, throwing and rejected
  calls stay distinct from a denial. Persistence is requested at most once per
  profile (marker `cubelab:persistence-request:v1`), after a first accepted solve
  or onboarding completion, without blocking the timing path. Settings exposes a
  forced request button when not granted.
- Settings → Data now shows persistent-storage status, browser usage/quota,
  the last completed local recovery archive, the last successful Drive sync,
  the last Drive backup file (when tracked) and a recovery-copy export. It
  explicitly states that synchronization is not an independent backup.
- Quota failures retain the last durable collection/settings and the verified
  archive; `storageOk` is surfaced as a warning. Archive, settings and session
  writes never substitute empty data on failure.
- Verification: `npm run typecheck`, `npm run lint`,
  `npm test -- src/lib/storagePersistence.test.ts
  src/components/StorageHealthPanel.test.tsx src/components/SettingsDialog.test.tsx
  src/lib/storage.test.ts` (4 files, 102 tests passed), plus the archive quota
  case from Phase 2.

## Phase 6 — frozen compatibility corpus (verified 2026-11-21)

- `tests/fixtures/storage/` now contains frozen synthetic-compatible fixtures
  for sessions v1–v7, settings v1–v13, Training v1, native backup v1, sync v1,
  legacy solves, prepared/committed replacement journals, and malformed,
  truncated and future-version variants. `README.md` there states they are
  parser-contract synthetic fixtures, not captured production data, and records
  the unknown-field policy.
- `src/lib/frozenStorageCompatibility.test.ts` performs load → in-memory migrate
  → validate → serialize → reload comparisons for every valid fixture. It checks
  IDs, raw milliseconds, penalties, scrambles, comments, dates, events, ordering,
  competition rounds, transfers, settings values, Training fields and sync
  provenance. Negative fixtures reject with zero writes and exact-byte
  retention.
- `npm run check:data` is the authoritative safety suite; it is documented in the
  README release workflow and added to the permanent `AGENTS.md` schema-change
  contract.
- Verification: `npm run check:data` (12 files, 320 tests passed),
  `npm run typecheck` and `npm run lint`.

## Phase 7 — integration and failure injection (verified 2026-11-21)

- `src/lib/dataSafetyIntegration.test.tsx` covers first install/first solve
  reload, historical schema archive + migration, corrupt settings with valid
  sessions, future-version data, Training/solve coexistence and archive quota
  failure with an exportable package.
- `src/lib/largeHistorySafety.test.ts` exercises 10,000 and 250,000 synthetic
  solves through strict validation, verified archive creation, recovery export
  and native-backup cap behavior. Observations (test machine, not thresholds):
  10k strict validation 18.3 ms, archive 7.3 ms, export 9.3 ms, package 1.9 MiB;
  250k strict validation 251.2 ms, archive 178.4 ms, export 279.5 ms, package
  47.3 MiB. The native backup cap rejects oversized payloads explicitly without
  truncating the collection.
- Drive corruption isolation is covered by a new `useSync` integration case:
  an invalid cross-tab collection is ignored, synchronization still publishes
  the existing valid solve and does not record a deletion tombstone.
- Existing focused browser coverage remains authoritative for two-tab ownership
  (`e2e/single-tab.spec.ts`, `e2e/cross-tab-timing.spec.ts`), Training Drive
  separation and conflict/undo runs, and the production offline PWA scenario.
- `e2e/storage-safety.spec.ts` now also verifies corrupt settings with valid
  sessions, exact recovery-package bytes, and restoring a verified pre-upgrade
  archive after corruption.
- Verification: `npm run check:data` (14 files, 328 tests passed),
  `npm run typecheck`, `npm run lint`, and Chromium
  `e2e/storage-safety.spec.ts --workers=4` (6 passed).








## Data-safety model

1. **Ownership first.** `cubelab-active-tab` is acquired for the document
   lifetime before replacement recovery, migration or editable hooks. Waiting
   tabs never read for editing, autosave, recover or sync.
2. **Checked reads before writable state.** Authoritative sessions, settings and
   sync provenance use discriminated readers. `absent` is distinct from
   unreadable, malformed, unsupported and future data. A checked read never
   writes and never returns a writable default for corrupt bytes.
3. **Preserve source bytes.** Migration archives the exact pre-upgrade strings,
   verifies the archive by re-reading it and only then starts a journaled
   candidate write. Failed or interrupted steps leave either the previous state
   or a fully committed, revalidated state.
4. **One transaction marker.** The existing replacement journal is the only
   upgrade commit marker. There is no competing migration journal. Prepared
   upgrades roll back; committed upgrades roll forward.
5. **Validation before publication.** Cross-tab and replacement adoption
   validates every participating collection first. A failed collection prevents
   publication of the others.
6. **No deletion from failed reads.** Sync starts blocked when provenance is
   unreadable, writes are refused over invalid provenance, and invalid external
   session collections are ignored rather than interpreted as deliberate
   deletion.
7. **Recovery remains accessible.** A blocked startup exposes exact-byte export,
   verified local archive restore and an explicitly confirmed local reset without
   opening editable hooks.

## Checked read requirements

- Use `loadSessionsChecked`, `loadSessionsForStartup`, `loadSettingsChecked`,
  `loadSettingsForStartup`, `loadSyncStorageChecked` or `loadTraining` for any
  value that can become writable state, be published, or be used to derive
  tombstones.
- The tolerant `loadSettings()`/`loadSessions()` readers remain only for
  read-only presentation such as csTimer import-option selection. Their fallback
  results must never be passed to `replaceSessions`, `replaceSettings`, sync
  publication or storage writes.
- A checked session result also rejects a collection in which any stored session
  or solve would be silently dropped by the tolerant parser. This keeps
  mixed-validity collections available for recovery instead of rewriting the
  valid subset.
- Unknown future versions fail closed in this build. Older supported versions
  migrate through documented field defaults; no future-version data is rewritten.

## Upgrade archive format and retention

`src/lib/upgradeArchive.ts` writes records with:

- `format: "cubelab-upgrade-archive"` and format version 1;
- unique ID, creation time, application release version and reason
  (`schema-migration`, `legacy-migration`, `normalization`, `pre-restore`);
- source schema versions, included key names, and per-key present/absent state;
- the exact original strings (never parse/reserialize);
- per-entry length/checksum and an overall FNV-1a manifest;
- status `verified`, `complete` or `failed`.

IndexedDB database `cubelab-upgrade-archive` is preferred. A CubeLab-owned
localStorage fallback is used only when IndexedDB cannot be opened. The archive
is re-read after writing; a mismatch deletes the attempted archive and blocks
migration. Retention keeps the two newest verified archives plus the newest
completed checkpoint. Cleanup only deletes records that re-read and verify.

## Migration protocol and crash recovery

`runStartupMigration` runs after lifetime ownership and replacement/completion
recovery:

1. Read sessions/settings strictly (plus legacy solves when applicable).
2. Decide whether an older/legacy representation needs migration. Current
   canonical records cause no write.
3. Create and verify the raw archive.
4. Build and validate the complete candidate in memory.
5. Start a `kind: "upgrade"` replacement journal.
6. Write candidate keys, re-read exact bytes, and revalidate schemas.
7. Write the durable commit marker, re-read and revalidate again.
8. Clear the journal, mark the archive complete and apply retention.

A crash before step 7 leaves a prepared journal that startup rolls back. A crash
after step 7 leaves a committed journal that startup rolls forward and cleans up.
The archive is retained independently. Failure injection covers every boundary
listed in Phase 2. An archive failure performs zero candidate writes and leaves
the source bytes intact.

## Export, restore and reset

- Recovery packages use `{ app: "CubeLab", format: "cubelab-recovery",
  version: 1 }`, an exact-record allowlist, per-record checksums and an overall
  manifest. They include sessions, legacy solves, settings, Training, solve sync,
  Drive metadata, Training sync, replacement/Undo/completion records, onboarding
  and accessible upgrade archives. They exclude UI-only tool preferences,
  unrelated origin storage and in-memory OAuth tokens.
- A verified archive restore first creates a `pre-restore` archive, then writes
  only sessions/legacy solves/settings through the replacement journal and
  verifies exact read-back. It requires preview and explicit confirmation.
- `RESET CUBELAB` requires a successfully prepared recovery package, an explicit
  saved-file acknowledgement and the exact phrase. It removes local data and
  recovery records but keeps verified upgrade archives, caches, the service
  worker and all remote Drive files. It never starts Drive sync.
- A browser download starting is not evidence that a file reached disk. The UI
  states this and cannot prove durable save.

## Synchronization suspension and quota behavior

- An invalid sync ledger starts the sync hook in a failed blocked state. Sync
  publication is skipped, and `saveSyncStorage` refuses to overwrite invalid
  existing provenance.
- A committed replacement is adopted only after sessions, settings and sync
  provenance all validate. Invalid external session/settings bytes are ignored.
- Quota failures return `false`, retain the previous durable collection and
  verified archive, and surface `storageOk`/error status. No fallback empty
  collection is written. Recovery export remains available when the browser can
  still read storage.

## Remaining limitations

- This is not incremental session storage; ordinary saves still rewrite the
  complete collection.
- Browser storage clearing, profile loss or catastrophic storage failure cannot
  be prevented. Persistence is advisory.
- Historical deployed clients that predate these checks can still rewrite newer
  data if loaded from an old cache. This build cannot retroactively harden them.
- Emergency recovery exports can exceed browser/download/filesystem capacity for
  extremely large histories; the 250k-solve synthetic package is about 47 MiB.
- Training v1 has no historical schema migration. A verified archive restore does
  not replace Training; Training keeps its separate backup/sync path.
- Recovery export cannot prove durable file saving, and local recovery is not a
  substitute for an independent backup.
- No guarantee is made against arbitrary browser defects, hostile extensions or
  physical storage failure.

## Extending compatibility fixtures

1. Decide whether the schema version must increase. Never add a silent unknown
   field to sessions/settings; Training permits documented additive fields.
2. Add a new immutable fixture under `tests/fixtures/storage/` and update its
   README. Keep every older fixture unchanged.
3. Extend `frozenStorageCompatibility.test.ts` with the round trip and negative
   cases, including zero-write assertions.
4. Add migration/failure-injection coverage for every new boundary and review
   native backup, Drive snapshot/envelope, Training sync, tombstone and rollback
   compatibility.
5. Record the downgrade behavior and recovery/archive impact in this document,
   `AGENTS.md` and `KNOWN_LIMITATIONS.md`.
6. Run `npm run check:data`, typecheck, lint and the affected browser specs.

## Phase 8 — final verification (2026-11-21)

Final commands and results on branch `fix/data-integrity-hardening`:

```bash
npm run typecheck     # passed
npm run lint          # passed with pre-existing warnings only
npm run check:data    # 17 files, 353 tests passed
npm test              # 128 files, 1667 tests passed
npm run build         # passed; PWA 80 precache entries (4056.74 KiB)
npm run test:e2e      # full three-project attempt, see below
```

The full `npm run test:e2e` attempt ran 509 tests successfully and exposed 299
failures: all 287 WebKit cases could not launch because the installed WebKit
bundle is missing `minibrowser-wpe/sys/lib/libflite.so.1`, and 12 Chromium
failures were fixed after diagnosis. The Chromium failures were caused by two
real integration issues found here:

1. The archive IndexedDB connection stayed open, blocking explicit site reset
   deletion. Archive operations now open and close the database per operation
   and combine IDB with the localStorage fallback for reads.
2. The upgrade journal duplicated the full previous collection in localStorage,
   exceeding quota for a 7,000-solve history. Upgrade/restore journals now carry
   only a verified archive ID plus a commit marker; large before-images remain in
   the archive.

After those fixes, the complete Chromium project passed:

```bash
CI=1 VITE_DRIVE_MOCK=true npm run test:e2e -- \
  --project=chromium --workers=4 --retries=0
# 271 passed (5.9m)
```

This includes production PWA offline coverage, both Training offline/Drive
suites, single-tab ownership, cross-tab replacement, site reset, Storage Safety
recovery/export/archive restore, all destructive session/import/conflict flows,
and the mock-Drive matrix.

Focused Chromium reruns after the final journal changes:

```bash
CI=1 VITE_DRIVE_MOCK=true npm run test:e2e -- \
  e2e/storage-safety.spec.ts e2e/single-tab.spec.ts e2e/cross-tab-timing.spec.ts \
  --project=chromium --workers=4 --retries=0
# 17 passed
```

Firefox has pre-existing Apple/Firefox-specific layout/touch failures unrelated
to this task. A representative mobile 2×2 and statistics-resize failure was
reproduced unchanged on the `master` baseline (`3dd5aea`). Firefox safety-
relevant cases (site reset, committed-cleanup, large-session stop, csTimer
import) passed. WebKit remains unverified on this machine until its Playwright
system libraries are repaired.

`npm run validate:drive` was intentionally not run: it requires explicit live
Google Drive authorization and a short-lived credential, neither of which was
provided. Mock Drive coverage is reported separately.

**Safety verdict:** the specific pre-release data-loss paths addressed by this
task are closed and covered by failing-before/passing-after tests. The remaining
unverified items are platform/environment coverage (WebKit and pre-existing
Firefox layout/touch behavior), not the data-safety contract.
