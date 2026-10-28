# Next Session Handoff

**Updated:** 2026-10-28 (Stage 2 snapshot lifecycle complete; Stage 3 remains gated on a real provider account)
**Objective:** Continue `Oct_28_AM_Plan.md` at Stage 3. Stage 3 needs explicit
approval and a real Google Drive test account; Stages 4 and 5 are approved.
**Branch:** `master`
**Working tree:** clean after the focused Stage 2 commit
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

| Check | Result |
| --- | --- |
| `npm run check` | **Passed as one command** |
| `npm run typecheck` | Passed |
| `npm run lint` | Passed with no warnings |
| `npm test` | **332/332 passed**, 22 files |
| `npm run build` | Passed; 96 modules; PWA 22 entries, 2,309.44 KiB |
| `npm run test:e2e` | **30/30 passed**, Chromium |
| `git diff --check` | Passed |

The Stage 1 gate is only partially met: no real Google Drive account/OAuth
credentials were available, so the required real-provider multi-device scenario
was not run. Cloud tests use the deterministic in-memory transport. There is
still no transaction across the immutable snapshot set. Stage 2's gate is met,
but real-provider retention behavior is part of the deferred Stage 3 validation.

## Stage status

- **Stage 0 — complete.** Documentation matched the code and `npm run check`
  passed as one command with 287/287 unit tests.
- **Stage 1 — complete except the real-provider gate; documentation cleanup
  complete.** Conditional legacy write, audit/Undo, exit-sync hardening,
  legacy-tombstone recovery review, redirect disagreement review, and repair are
  implemented and covered by deterministic unit/hook/stress/mock E2E tests. Real
  Drive validation is deferred to Stage 3.
- **Stage 2 — complete 2026-10-28.** Snapshot retention policy, per-device
  ownership and management UI, selective deletion, manual cleanup, and growth
  documentation are implemented and covered by unit, hook, and production E2E
  tests.
- **Stage 3 — next; requires approval and a real Google Drive test account.**
  Concurrent multi-device validation, retention behavior against real Drive, and
  OAuth publishing/branding.
- **Stage 4 — approved 2026-10-28; not started.** Phase 3 completion: per-event
  E2E, event-specific WCA rules, and storage-migration verification.
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
  CAS covers only the legacy mutable file. Snapshot cleanup is a best-effort
  sequence of independent deletes, not a transaction, and has not been validated
  against real Drive.
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
