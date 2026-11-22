# Data-safety final audit — 2026-11-21

**Status:** Complete; ready for local merge review.
**Branch audited:** `fix/data-integrity-hardening`
**Base:** `3dd5aea85b73db247b20ae94366ce90b87405184` (`master` and
`origin/master` at audit start)
**Expected implementation HEAD:** `7dddd9c`
**Verified hardening HEAD:** `17617be`
**Audit type:** Independent code and test review, not a re-run of the author's
summary.

This record covers the eight hardening commits, the corrective commits made
during this audit, the WebKit environment repair, Firefox/Chromium baseline
comparisons and the final merge gate. It is not a new feature specification;
[AGENTS.md](../../AGENTS.md), [DATA_SAFETY_HARDENING.md](DATA_SAFETY_HARDENING.md)
and the [sync contracts](../../.opencode/skills/cubelab-sync-safety/references/sync-contracts.md)
remain authoritative for behavior.

## 1. Repository state at audit start

- Current branch: `fix/data-integrity-hardening`.
- Branch HEAD: `7dddd9c`, eight commits ahead of `master`.
- `master` and `origin/master`: `3dd5aea` (the expected base).
- Working tree: clean before verification edits.
- No upstream drift was found. No commit was discarded, rebased or
  force-pushed during this audit.

The eight planned commits were inspected in full:

| Commit | Scope | Audit result |
| --- | --- | --- |
| `446c407` | Checked session/settings readers and startup snapshots | Sound; absent is distinct from corrupt/unsupported, and tolerant readers remain presentation-only. |
| `ba0f850` | Verified pre-upgrade archive and journaled migration | Sound; archive is re-read and verified before candidate writes; prepared/committed recovery is deterministic. |
| `3f3fafd` | Checked cross-tab and committed-replacement adoption | Sound; sessions, settings and sync provenance must all validate before publication. |
| `e4d3fde` | Recovery center, exact-byte export and archive restore | Sound; affected stores are inspected without writes; restore previews and archives current bytes first. |
| `b9daafe` | Persistence and quota health surface | Sound; persistence requests are advisory and do not block timing. |
| `cc974c9` | Frozen historical fixture corpus and `check:data` | Sound; fixtures are synthetic parser-contract records, not captured user data. |
| `8bb5012` | Failure-injection integration and large-history safety | Sound; covers first install, corrupt settings, future data and archive quota failures. |
| `7dddd9c` | Final hardening, small journals and documentation | Mostly sound; the audit found one unresolved tolerant-reader path, corrected below. |

No unexpected dependency, production-worker, timer-transition or Training
schema change was introduced. Session schema remains v7, settings v13, Training
v1, native backup v1, solve sync v1 and Training sync v1.

## 2. Invariant verification

| Invariant | Evidence and result |
| --- | --- |
| **A — No destructive fallback** | `loadSessionsChecked`, `loadSettingsChecked` and `loadSyncStorageChecked` fail closed; only a genuinely absent key permits defaults. `findSessionRecordLoss` rejects a collection where any stored session/solve would be dropped. Passed. |
| **B — Recoverable migration** | `runStartupMigration` writes a verified archive before any candidate key, validates candidates, uses the existing replacement journal as the only commit marker and restores sources on failure. Failure injection covers every boundary. Passed. |
| **C — Archive integrity** | Archives contain exact strings, per-entry length/checksum and an overall manifest; every archive is re-read and verified before acceptance. Passed. |
| **D — Safe archive retention** | Retention keeps the two newest verified archives plus the newest completed checkpoint and deletes only records that re-read and verify. Passed. |
| **E — Sync isolation** | Invalid cross-tab bytes are ignored, never adopted as empty; an unreadable sync ledger blocks publication and cannot be overwritten. Corrected path: pending Undo/completion replay no longer treats an unreadable ledger as an empty tombstone set. Passed after correction. |
| **F — Restore preview** | Archive restore requires preview, explicit confirmation and a pre-restore safety archive; it writes only sessions/legacy solves/settings and never touches Drive or Training. Passed. |
| **G — Timer durability** | The timer machine, input boundaries and accepted-solve path were not weakened. Pending-completion replay now refuses to run over unreadable deletion provenance. Passed. |
| **H — Training isolation** | Migration, archive restore and solve recovery use only solve/settings keys. Training keeps its separate store, file family and ledger. Training backup/sync tests pass in all three engines. Passed. |

## 3. Findings and corrections

### F-01 — High (fixed): unreadable deletion provenance could resurrect a deleted solve

- **Affected code:** `src/lib/pendingCompletion.ts`,
  `src/hooks/useSync.ts`, `src/App.tsx`.
- **Defect:** `readTombstones()` used the tolerant `loadSyncStorage()` reader.
  A malformed or unsupported `cubelab:sync:v1` record was converted to a default
  ledger with no tombstones. Startup pending-completion replay and the live
  pending-Undo recovery effect could then apply a restored solve without knowing
  that it had been deliberately deleted. Backup export had the same exposure
  when materializing pending Undo operations.
- **Action:** `readTombstones()` now uses `loadSyncStorageChecked()` and returns
  “unknown” on failure. Startup replay keeps the completion buffer and blocks.
  `recoverPendingSolveRestores()` refuses to run while the sync ledger is
  blocked and re-reads checked provenance at the operation boundary, so a
  ledger that becomes unreadable after startup cannot use stale in-memory
  tombstones. Backup export refuses to materialize pending Undo operations
  without trustworthy provenance.
- **Regression evidence:** `src/lib/pendingCompletion.test.ts` (unreadable
  provenance leaves sessions and buffer untouched),
  `src/hooks/useSync.test.ts` (pending Undo retained with a corrupt ledger) and
  `e2e/storage-safety.spec.ts` (real app blocks export and retains bytes).
- **Commit:** `20452ca`.

### F-02 — Low (fixed): explicit site reset could leave the archive database behind

- **Affected code:** `src/lib/siteReset.ts`.
- **Defect:** The known-database fallback list omitted
  `cubelab-upgrade-archive`. Browsers without `indexedDB.databases()` could
  leave verified recovery archives after “Reset All Site Data”.
- **Action:** Added the archive database to the fallback list and asserted it in
  the site-reset unit test.
- **Commit:** `8e3ddfa`.

### F-03 — Test environment (fixed, not a product defect): WebKit launch failure

- **Observed cause:** The local Playwright WebKit bundle had been altered with
  symlinks into a deleted `/tmp/cubelab-webkit-libs` directory, so
  `libflite.so.1`, ICU 74, legacy libxml2 and related libraries were broken
  symlinks. The host is Arch Linux while Playwright downloaded its supported
  Ubuntu 24.04 fallback build.
- **Correction:** Removed the ad-hoc bundle state with the official
  `npx playwright install --force webkit` download and ran the browser in an
  isolated Ubuntu 24.04 userland via `bwrap` with the Playwright-listed
  dependencies. No system-wide symlinks, copied random host libraries, host
  validation bypass or production application workaround was used. The
  reproducible recipe is recorded in
  [ARCH_LINUX.md](ARCH_LINUX.md#browser-checks-on-arch).
- **Verified APIs:** headless launch, localStorage, IndexedDB read/write,
  `navigator.locks`, downloads and service-worker offline loading.
- **Not a product change:** no production source was modified for the launch
  failure.

### F-04 — Test harness (fixed): WebKit LockManager wrapper identity

- **Affected code:** `e2e/single-tab.spec.ts`, `e2e/legacy-tabs.ts`.
- **Defect:** WebKit can hand back different `LockManager` wrappers for repeated
  `navigator.locks` reads. Monkey-patching a previously read wrapper was
  nondeterministic under parallel load, so synthetic lock rejection and legacy
  concurrent-tab simulations sometimes used the real lock.
- **Action:** Replace the whole `navigator.locks` object with a stable fake
  manager that delegates replacement/Drive locks to the real implementation.
  The five cross-tab timing tests previously skipped for WebKit now run and
  pass. The rejection/retry test uses the same stable pattern.
- **Commits:** `e068115`, `17617be`.

### F-05 — Pre-existing Chromium accessibility failure (not data safety)

`accessibility.spec.ts` dark-theme axe scan intermittently reports
`label-content-name-mismatch` on `.appearance-preview` (“12.34 / Hold to
preview”). It reproduced unchanged on base `3dd5aea`. The final full Chromium
run passed 272/272; the earlier failing run is retained as a known flaky
pre-existing UI check, not a hardening regression.

### F-06 — Pre-existing Firefox layout/touch failures (not data safety)

The final Firefox run reproduced exactly the 15 failures reported before the
hardening branch. Every one was re-run against an isolated worktree at
`3dd5aea` and failed identically:

- session drag/scroll drop position;
- Statistics panel minimum/maximum and wrapped-metric geometry;
- Statistics long-value wrapping;
- 11 mobile per-event scramble-timeout cases (all events except 3×3).

The data-safety specs (`storage-safety`, `single-tab`, `cross-tab-timing`,
`site-reset`, session deletion/Undo/import replacements and Training
backup/sync) pass in Firefox: 63/64 focused cases, with only the same
pre-existing session-drag failure.

### F-07 — Pre-existing WebKit layout/accessibility/touch failures

The final full WebKit run passed 258 cases and skipped 5. Nine failed:

- 8 failures reproduce identically on base `3dd5aea`: Analytics rail
  coordinates, midnight-relative dates, onboarding accessibility, wrapped
  Statistics metrics, the Time Trend touch pin and two Training
  accessibility/contrast scans.
- One Training Drive sync case was load-sensitive under the full 4-worker run
  and passed alone; it is not a data-safety failure.

The focused WebKit data-safety set is fully green: storage safety, single-tab,
cross-tab timing, site reset, solve/settings recovery, mock Drive and Training
backup/sync (30/30). The manually unskipped offline-PWA case also passes in
WebKit.

### F-08 — High (fixed after independent post-merge review): failed session deletion left solve tombstones

- **Affected code:** `src/App.tsx`, `src/hooks/useSync.ts`.
- **Defect:** `recordSessionDeletion` writes a session tombstone and one solve
  tombstone per solve. If the local session deletion then failed (for example,
  the last-session guard or a storage write failure), the UI revoked only the
  session tombstone. The active solve tombstones remained global, so a later
  merge could delete those solves from the session that was still present.
- **Action:** session rollback now accepts the deletion's solve IDs and revokes
  both the session tombstone and its matching solve tombstones. A regression
  asserts no active solve tombstone remains after rollback.
- **Commit:** `6631ed7`.
- **Evidence:** `src/hooks/useSync.test.ts`; Chromium session-management 34/34,
  Firefox 40/40 focused safety cases, WebKit storage safety and the focused
  session-management case (one parallel WebKit run flaked, then passed alone).

### F-09 — High (fixed after independent post-merge review): tolerant Undo journal could be overwritten

- **Affected code:** `src/lib/solveRecovery.ts`, plus its sync, replacement,
  backup-export and Training guards.
- **Defect:** the private `cubelab:recovery:v1` journal used a tolerant reader
  that returned an empty operation list for invalid JSON, read errors and future
  versions. `addPendingSolveRestore`/`removePendingSolveRestore` then wrote a
  fresh journal, discarding the original pending Undo bytes. Replacement, sync
  and backup export also treated the unreadable journal as "no pending Undo".
- **Action:** added `loadSolveRecoveryChecked`, made `saveSolveRecovery` refuse
  to overwrite unreadable/future bytes, and changed the operation, replacement,
  sync, backup-export and Training guards to use the checked result. Valid v1
  journals may still salvage individually parseable operations, preserving the
  documented compatibility behavior.
- **Commits:** `6631ed7`; `8af361b` additionally keeps a v1 journal whose every
  operation is unusable instead of salvaging it as an empty list.
- **Evidence:** `src/lib/solveRecovery.test.ts` (invalid JSON, future version
  and all-invalid v1 keep exact bytes and reject writes) and
  `src/hooks/useSync.test.ts`; affected Chromium/Firefox/WebKit safety suites
  pass.

## 4. Recovery and compatibility review

- Recovery packages contain exact allowlisted CubeLab records, present/absent
  markers, per-record checksums, an overall manifest and accessible archives.
  OAuth tokens, unrelated origin storage and UI-only tool preferences are
  excluded.
- `RESET CUBELAB` requires a freshly prepared download, a saved-file
  acknowledgement and the exact phrase. It keeps verified archives, caches, the
  service worker and all Drive files.
- Archive restore creates a pre-restore archive first and writes only
  sessions/legacy solves/settings. Training and synchronization provenance are
  untouched.
- Native backup and csTimer import semantics are unchanged. Native restore is
  replace-only after preview; csTimer remains additive and preserves settings.
- The 10 MB native import cap, checked gzip 16 MB encoded / 64 MB decoded bounds,
  solve Drive 10 MB cap and Training 16 MB cap are unchanged.
- No schema version or wire format was changed by this audit.

## 5. Final verification matrix

All commands were run from the repository root with synthetic fixtures, mock
Drive and isolated browser contexts. No real user profile, live Google Drive
credential or production account was used.

| Command / suite | Result |
| --- | --- |
| `npm run typecheck` | Passed |
| `npm run lint` | Passed; pre-existing warnings only |
| `npm run check:data` | 17 files, 357 tests passed |
| `npm test` | 128 files, 1672 tests passed |
| `npm run build` | Passed; production/PWA output restored |
| Chromium full E2E | 272 passed on the merged tree; 271 passed after the post-merge provenance fixes, with one unrelated app-startup timeout that passed alone |
| Firefox full E2E | 252 passed, 15 pre-existing failures, 5 skipped |
| WebKit full E2E | 258 passed, 8 pre-existing failures, 1 load-sensitive case passed alone, 5 skipped |
| WebKit focused data-safety | 30/30 passed |
| Firefox focused data-safety | 63/64 passed; only the baseline session-drag failure |
| WebKit offline PWA (manual unskip) | 1/1 passed |
| Baseline reproduction | All 8 WebKit and all 15 Firefox failures failed identically at `3dd5aea`; Chromium axe failure also reproduced there |

Known skips remain deliberate and visible:

- Firefox/WebKit mobile pointer hold-to-time remains Chromium-only.
- Firefox/WebKit offline PWA remains Chromium-only in the checked-in matrix;
  the manual WebKit run above establishes current support.
- The WebKit suite retains no data-safety skips after this audit.

`npm run validate:drive` was intentionally not run: it creates and deletes real
remote files and requires explicit live-test authorization and a short-lived
`drive.appdata` credential, neither of which was supplied. Mock Drive coverage
is reported separately.

## 6. Remaining limitations

- No live-provider Google Drive, physical touch/screen-reader or real
  multi-device evidence was produced.
- Browser storage clearing, profile loss and catastrophic quota/filesystem
  failure remain outside the application's control.
- Existing deployed clients that predate these checks can still rewrite newer
  data from an old cache; this build fails closed on future versions but cannot
  retroactively harden historical clients.
- Emergency recovery packages can exceed browser/download capacity for very
  large histories; the 250k-solve synthetic package measured about 47 MiB.
- A pending completion applied at startup before a lower-version migration is
  still written in the current schema before the migration archive pass. The
  supported v1–v7 data is preserved, but exact pre-upgrade bytes are not
  archived in that rare upgrade sequence. No supported-field loss was observed.
- Native/Drive backup parsing intentionally skips malformed individual records,
  matching the longstanding native-import compatibility contract; the source
  backup file remains available. This is separate from checked local startup
  reads.
- **Medium, recovery export:** a transient per-key `getItem` failure is recorded
  as an absent record rather than a read failure. If `removeItem` still
  succeeded, an export-and-reset could omit that key. The reset is gated on a
  fresh package and explicit acknowledgement, but the package cannot distinguish
  this case. A selective read/write asymmetry was not observed in testing.
- **Medium, legacy data:** a non-empty `cubelab:solves:v1` record with no usable
  3×3 solves is still reported as `absent`, so the app creates an empty sessions
  key and prefers it. The legacy bytes remain available in the recovery package;
  they are not deleted.

## 7. Merge gate and result

| Gate | Status |
| --- | --- |
| All eight commits inspected | Passed |
| No unresolved critical/high data-loss defect | Passed after F-01, F-08 and F-09 |
| Regression tests for corrected defects | Passed |
| Chromium full suite | Passed 272/272 on the merged tree; 271/272 after the final provenance fixes with one unrelated startup timeout passing alone |
| Firefox data-safety suite | Passed; 15 documented pre-existing UI failures |
| WebKit data-safety suite | Passed (30/30 at two workers); 8 documented pre-existing UI failures |
| Unit, typecheck, lint, data checks and build | Passed |
| No test disabled to obtain a pass | Passed; WebKit cross-tab skips were removed and the offline case was separately verified |
| Working tree preserved | Passed; only audit corrections committed |
| Deployed or pushed | No |

**Merge performed:** `346b50a` (`Merge data-integrity hardening and
cross-browser safety verification`) on local `master`, using a regular
`--no-ff` merge. The original branch head was `7dddd9c`; the final hardening
head before merge was `64ba2e2`; `master` and `origin/master` were both at
`3dd5aea` before the merge. Nothing was pushed or deployed.

**Post-merge verification on `master`:** typecheck, lint, `check:data` (357
tests), the full unit suite (128 files / 1672 tests) and the production build
passed. An independent post-merge review then found F-08/F-09; both were fixed
and regression-tested in `6631ed7`. The affected Chromium session-management
and storage-safety set passed 41/41; Firefox passed 40/40 focused safety cases;
WebKit storage safety passed and its focused data-safety set passed 30/30 at two
workers. Full Chromium passed 272/272 on the merged tree and 271/272 after the
provenance fixes, with one unrelated app-startup timeout that passed alone. The
same WebKit set at four workers reproduced one load-sensitive Training sync
timeout that passes alone. The Firefox safety set retained only the documented
pre-existing session-drag failure; the full Firefox/WebKit matrices were already
run on the identical branch tree.

One WebKit Training Drive sync case is timing-sensitive under a full four-worker
run. It is not a data-loss or provenance failure: it passes alone, passed in the
focused suite, and passed the post-merge two-worker safety run. Treat it as a
load-sensitive test/WebKit environment limitation, not a merge blocker.
