# Next Session Handoff

**Updated:** 2026-10-28 (Stage 4 complete; Phase 3 closed; Stage 5 is next)
**Objective:** Continue `Oct_28_AM_Plan.md` at Stage 5. Stage 4 completed Phase 3
with 5×5, 6×6, and 7×7 events, per-event desktop/mobile E2E, and the shared WCA
rule audit. Stage 5 is the approved Phase 4 platform work: history
virtualization, WebKit/Firefox coverage where available, a formal
accessibility/keyboard audit, and PWA/bundle review.
**Branch:** `master`
**Working tree:** clean after the focused Stage 4 commit
**Node:** `~/.nvm/versions/node/v22.23.2/bin/node` (system Node 18 cannot run Vite 8)

## Status

Stages 0–4 are complete. Stage 1 added the legacy-file conditional write,
review audit/undo, legacy-tombstone review, exit-sync hardening, and repair.
Stage 2 added snapshot retention, per-device ownership management, selective
deletion, and manual cleanup. Stage 3 validated concurrent immutable publishing,
all-snapshot convergence, same-device writers, the live Drive v2 ETag/`If-Match`
path, retention, and selective deletion against a real Google Drive test account.

Stage 4 on 2026-10-28 completed Phase 3:

- Added `555`, `666`, and `777` to the event registry and `PuzzleEvent` union.
- Storage, backup, session metadata, and sync now validate all seven event IDs.
  Legacy `cubelab:solves:v1` migration still accepts only 3×3 records.
- Scrambles for all seven events come from `cubing.js`
  `randomScrambleForEvent(...)`. Big-cube depth notation such as `3Rw2` is
  accepted by the plausibility check.
- The header, timer stage, scramble badge, and duplicate-session suffix display
  the human-readable event label from `src/lib/events.ts`.
- Fourteen production E2E tests cover all seven events at desktop and 390 px
  mobile widths: switch event, fresh scramble, three solves, `+2`, DNF, stats,
  persistence, and overflow.
- The backup E2E now exports and restores a 3×3 + 5×5 session collection.
- WCA audit: the 15-second inspection window, `+2` from 15–17 seconds, DNF after
  17 seconds, and effective-time statistics are shared by every event. The timer
  machine remains event-independent. Competition time limits and cutoffs are
  deliberately not implemented.
- Documentation and the ROADMAP Phase 3 gate are updated.

| Check | Result |
| --- | --- |
| `npm run check` | **Passed as one command**, exit 0 |
| `npm run typecheck` | Passed |
| `npm run lint` | Passed with no warnings |
| `npm test` | **339/339 passed**, 22 files |
| `npm run build` | Passed; 96 modules; PWA 22 entries, 2,311.53 KiB |
| `npm run test:e2e` | **44/44 passed**, Chromium |
| `git diff --check` | Passed |

Stage 3's real-provider gate is closed; only OAuth publishing/non-test sign-in
remains, and that requires the Google Cloud project owner. There is still no
transaction across the immutable snapshot set, and convergence remains eventual.

## Stage status

- **Stage 0 — complete.** Documentation matched the code and `npm run check`
  passed as one command.
- **Stage 1 — complete; real-provider gate closed by Stage 3.** Conditional legacy
  write, audit/Undo, exit-sync hardening, legacy-tombstone recovery review,
  redirect disagreement review, and repair.
- **Stage 2 — complete.** Snapshot retention policy, per-device ownership and
  management UI, selective deletion, and manual cleanup.
- **Stage 3 — complete except OAuth publishing.** Real-provider concurrency,
  convergence, live ETag/`If-Match`, retention, and selective deletion passed
  7/7 with complete cleanup. The app remains in Testing under another owner.
- **Stage 4 — complete 2026-10-28.** Phase 3 completion: all seven events,
  per-event E2E, WCA rule audit, multi-event storage/backup coverage, and docs.
- **Stage 5 — next approved stage; not started.** Phase 4 platform work:
  virtualization, cross-browser coverage, accessibility audit, PWA/bundle review.
- **Stage 6 — polish, no extra approval.** Dark theme only after a full contrast
  audit; the inspection reset is already implemented.

## Current event and WCA behavior to preserve

- Supported events and `cubing.js` scramble IDs are defined only in
  `src/lib/events.ts`: `333`, `222`, `444`, `333oh`, `555`, `666`, `777`.
  Do not duplicate the list in components or validation.
- `PuzzleEvent` in `src/types.ts` must stay in sync with that registry. Storage
  and backup validation use the shared `isPuzzleEventValue` guard.
- Do not hand-roll scrambles or add random-move fallbacks. Preserve the prefetch
  queue, loading skeleton, failure message, retry action, and timer gating.
- A session event is locked once the session has solves. Changing an empty
  session's event may also rename a default-style session to the event label.
- All seven events share the 15-second inspection, `+2`, DNF, mo3, and trimmed
  average rules. Do not branch the timer machine or statistics on event without
  a documented WCA rule and focused tests.
- Event labels are presentation only. Raw times, penalties, and statistics must
  not depend on the event.
- Mixed-event sessions are rejected before import confirmation or mutation.
  Unknown event IDs must not be silently rewritten to 3×3.
- `docs/cubelab-desktop.png`, `docs/cubelab-mobile.png`, and
  `docs/cubelab-settings.png` show the default 3×3 session; adding events did not
  materially change those layouts.

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
- The per-event tests intentionally wait for the scramble text to change before
  timing. Switching events clears the scramble slots after paint, so asserting
  only the badge can race the previous event's scramble.
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
