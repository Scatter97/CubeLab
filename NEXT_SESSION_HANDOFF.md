# Next Session Handoff

**Updated:** 2026-10-28 (Stage 3 real-provider validation complete; OAuth publishing remains with the Google Cloud project owner)
**Objective:** Continue `Oct_28_AM_Plan.md` at Stage 4. Stage 4 is the
implementation stage for 5×5, 6×6, and 7×7 events and completes Phase 3 with
per-event E2E and WCA validation.
Stage 3's real-provider gate is closed; only OAuth publishing/non-test sign-in
remains, and that requires the Google Cloud project owner. Stages 4 and 5 are
approved.
**Branch:** `master`
**Working tree:** clean after the focused Stage 3 commit
**Node:** `~/.nvm/versions/node/v22.23.2/bin/node` (system Node 18 cannot run Vite 8)

## Status

Stage 0 committed the 2026-10-27 immutable-snapshot remediation and aligned the
documentation. Stage 1 on 2026-10-28 added the highest-value sync hardening:

- Drive v2 ETag/`If-Match` conditional replacement for the legacy mutable
  `cubelab-backup.json`, failing closed on HTTP 412 or a missing ETag.
- Local-only conflict-resolution audit history with exact-match Undo.
- Mandatory `legacyRecovery` review for ambiguous pre-`knownSolveIds` deletions.
- Remote-only redirect-disagreement review.
- Deduplicated visibility/`pagehide`/`freeze` exit sync.
- A non-destructive **Repair sync state** action.
- Documentation consolidation: the completed audit tracker, the original audit
  report, and the superseded Phase 2B design brief were removed. Active docs are
  `AGENTS.md`, `README.md`, `ROADMAP.md`, `PROJECT_PROGRESS.md`,
  `PATCH_LIMITATIONS.md`, this handoff, `Oct_28_AM_Plan.md`, and the screenshots
  referenced by `README.md`.

Stage 2 on 2026-10-28 added snapshot lifecycle management:

- A configurable retention policy in `cubelab:sync:v1`: automatic cleanup
  enabled by default, 10 snapshots kept per device, and a 30-day maximum age.
- Automatic cleanup after a successful all-snapshot merge and publication, with
  the published file ID and publication time as deletion boundaries.
- `appProperties.deviceId` ownership metadata on new snapshots and name-prefix
  fallback grouping for older files.
- A **Remote snapshots** section with per-device groups, sizes, dates, five-file
  pagination, selective deletion, **Refresh**, and own-only **Clean up now**.
- Safety rules: the newest snapshot per device, the just-published snapshot, and
  the legacy mutable `cubelab-backup.json` are never deleted. Partial failures
  are reported without failing the completed sync.

Stage 3 on 2026-10-28 added real-provider validation and OAuth guidance:

- An opt-in `npm run validate:drive` harness (`src/validation/realProvider.validation.ts`,
  `vitest.real.config.ts`) validates concurrent immutable publishing, all-snapshot
  convergence, same-device writers, the live Drive v2 ETag/`If-Match` path,
  retention, and selective deletion against a real account. It is excluded from
  `npm test` and `npm run check` and needs an explicit short-lived
  `CUBELAB_DRIVE_ACCESS_TOKEN`.
- `describeGoogleAuthError` maps `origin_mismatch`, `access_denied`,
  `popup_closed`, invalid-client, and related Google Identity Services errors to
  actionable guidance that names the exact authorized origin.
- README documents authorized JavaScript origins, Testing-mode test users,
  publishing, and the `origin_mismatch` failure.
- `useDriveBackup` derives `connected` and its idle phase from the transport, so a
  sync that acquires a token outside the dialog no longer leaves **Offline** and a
  **Connect** button after a successful sync. A regression test covers it.
- Real app syncs created two immutable snapshots in the test account, and the
  final harness run passed 7/7 in 24.86 s with 7 files created, 7 deleted, 2
  baseline snapshots untouched, and 0 cleanup failures. One earlier run hit a
  transient `ECONNRESET` on a repeated delete; an immediate rerun passed.
- The OAuth app remains in Testing under another owner account. Non-test sign-in
  and published production branding were not validated.

| Check | Result |
| --- | --- |
| `npm run check` | **Passed as one command**, exit 0 |
| `npm run typecheck` | Passed |
| `npm run lint` | Passed with no warnings |
| `npm test` | **337/337 passed**, 22 files |
| `npm run build` | Passed; 96 modules; PWA 22 entries, 2,311.30 KiB |
| `npm run test:e2e` | **30/30 passed**, Chromium |
| `npm run validate:drive` | **7/7 passed** against the real account (opt-in; not in CI) |
| `git diff --check` | Passed |

Stage 3 closed the real-provider multi-device, conditional-write, and retention
gate. The remaining Stage 3 item is OAuth publishing: the project owner must
publish the app out of Testing (and complete any Google verification), then a
non-test account must sign in. There is still no transaction across the immutable
snapshot set, and convergence remains eventual.

## Stage status

- **Stage 0 — complete.** Documentation matched the code and `npm run check`
  passed as one command with 287/287 unit tests.
- **Stage 1 — complete; real-provider gate closed by Stage 3.** Conditional legacy
  write, audit/Undo, exit-sync hardening, legacy-tombstone recovery review,
  redirect disagreement review, and repair are implemented and covered by
  deterministic unit/hook/stress/mock E2E tests.
- **Stage 2 — complete 2026-10-28.** Snapshot retention policy, per-device
  ownership and management UI, selective deletion, manual cleanup, and growth
  documentation are implemented and covered by unit, hook, and production E2E
  tests.
- **Stage 3 — complete except OAuth publishing — 2026-10-28.** Real-provider
  concurrency, convergence, live ETag/`If-Match`, retention, and selective
  deletion passed 7/7 with complete cleanup. OAuth uses only `drive.appdata` and
  the consent screen is branded CubeLab, but the app is still in Testing under
  another owner account, so non-test sign-in is unverified.
- **Stage 4 — next approved stage; not started.** Phase 3 completion: implement
  5×5, 6×6, and 7×7 events; add per-event E2E for all seven events; verify
  event-specific WCA rules; and verify storage migration, backup, and import
  across multiple events.
- **Stage 5 — approved 2026-10-28; not started.** Phase 4 platform work:
  virtualization, cross-browser coverage, accessibility audit, PWA/bundle review.
- **Stage 6 — polish, no extra approval.** Dark theme only after a full contrast
  audit; the inspection reset is already implemented.

## Current sync behavior to preserve

- Each write creates `cubelab-backup-<device-id>-<uuid>.json` and never overwrites
  a file. `uploadDeviceBackup` has no `existingFileId` parameter.
- Same-origin writes share the Web Lock. Per-device transports do not re-list or
  recheck; the optimistic recheck remains only for the legacy fixed-name
  transport.
- The legacy mutable file is listed through Drive v3, read through Drive v2
  metadata, and replaced with a v2 media `PUT` carrying `If-Match`. A pre-write
  ETag mismatch, HTTP 412, or a missing ETag must fail closed.
- Conflicts are deduplicated by `kind:id:field`, never truncated to 100, and
  rendered 5 at a time with **Show all**. Remote-only disagreements are marked
  `remoteOnly` and use **Use newest cloud** / **Use other cloud**.
- Approvals match the reviewed pair in either local/remote orientation. Redirect
  approvals match by unordered destination pair.
- `isOwnSnapshot` identifies this device by envelope `deviceId`, falling back to
  the legacy fixed filename.
- Review history lives only in `cubelab:sync:v1`, newest first, capped at 50
  display entries. It is never uploaded, synchronized, or included in backups.
- **Repair sync state** clears only `lastSyncedFingerprint`,
  `lastRemoteRevision`, status, and error; it preserves sessions, tombstones,
  redirects, pending conflicts, audit history, and settings metadata.
- Automatic cleanup runs only after a successful upload, keeps the newest
  snapshot of every device group, and never deletes the just-published snapshot
  or the legacy mutable file. It prunes when either the per-device count or age
  threshold is exceeded.
- Manual cleanup re-lists first and passes `ownOnly: true`; it must never remove a
  foreign snapshot that this browser may not have merged yet.
- New snapshots write `appProperties.deviceId`. Older snapshots group by the
  sanitized name prefix after stripping the UUID or fallback write token.
- Selective snapshot deletion removes only the cloud file. It does not change
  local sessions, settings, tombstones, or conflict state.

## Pitfalls

- Do not undo durable Undo by deleting tombstones; `restoredAt` is the protocol.
- Keep malformed remote envelopes rejecting as a whole, not filtering entries.
- Keep mixed-event imports rejected before confirmation or mutation.
- Keep `drive.appdata` as the only OAuth scope.
- Disconnecting Drive must leave automatic synchronization disabled.
- Ambiguous legacy-tombstone recovery must always raise a review, even when
  manual review is off; a new candidate set needs a fresh review.
- Undo only applies while the stored conflict still has the exact recorded
  resolution and `updatedAt`; applied redirect merges and a legacy recovery that
  already restored solves are not reversible. **Keep deleted** can still be
  changed to **Recover solves**.
- E2E expects countdown warning labels at **7 seconds remaining** and **3 seconds
  remaining**.
- Do not claim atomic remote writes or data-loss-proof synchronization. Provider
  CAS covers only the legacy mutable file. Snapshot cleanup was validated against
  real Drive on 2026-10-28, but it remains a best-effort sequence of independent
  deletes, not a transaction. A repeated delete of an already-removed file hit one
  transient `ECONNRESET` that did not reproduce.
- Do not claim non-test sign-in or production OAuth publishing. The app remains in
  Testing under another owner account; the owner must publish it and complete any
  Google verification before that can be verified.
- The real-provider harness needs an explicit short-lived access token. Never
  commit or print the token, and keep the harness out of `npm run check`/CI. Use
  `CUBELAB_DRIVE_ALLOW_EXISTING=true` only to leave pre-existing app snapshots
  untouched; cleanup removes only files the run created.
- Do not run automatic cleanup before publication, and do not remove the newest
  snapshot of any device group or the legacy mutable file. A cleanup failure must
  be reported without turning a completed sync into a failure.
- Do not delete foreign snapshots from manual cleanup. Only automatic cleanup
  after a successful all-snapshot merge may prune another device's superseded
  group.
- Exit sync is best effort even with the deduplicated `visibilitychange` /
  `pagehide` / `freeze` triggers.
- Hidden older cloud approvals remain possible when a device already holds a newer
  approval for one side of a multi-remote disagreement.
