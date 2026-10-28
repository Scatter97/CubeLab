# Next Session Handoff

**Updated:** 2026-10-28 (Stage 0 complete)
**Objective:** Continue `Oct_28_AM_Plan.md` after Stage 0. Stages 1–3 need explicit
approval; Stages 4 and 5 are approved.
**Branch:** `master`
**Working tree:** clean after the Stage 0 commit
**Node:** `~/.nvm/versions/node/v22.23.2/bin/node` (system Node 18 cannot run Vite 8)

## Status

The 2026-10-27 synchronization remediation is complete and verified: writes use
unique immutable Drive snapshots, the conflict queue is uncapped (rendering is
paginated), and disagreements between remote snapshots are surfaced for review.
Stage 0 on 2026-10-28 aligned `AGENTS.md`, `README.md`, `ROADMAP.md`,
`PROJECT_PROGRESS.md`, `PATCH_LIMITATIONS.md`, `AUDIT_FIX_PROGRESS.md`, and this
handoff, then ran the full chain as one command.

| Check | Result |
| --- | --- |
| `npm run check` | **Passed as one command** |
| `npm run typecheck` | Passed |
| `npm run lint` | Passed with no warnings |
| `npm test` | **287/287 passed**, 21 files |
| `npm run build` | Passed; 95 modules; PWA 22 entries, 2,286.77 KiB |
| `npm run test:e2e` | **29/29 passed**, Chromium |
| `git diff --check` | Passed |

No real Google Drive multi-device test was run; cloud tests use the deterministic
in-memory transport. Provider compare-and-swap remains unavailable.

## Stage status

- **Stage 0 — complete.** Documentation matches the code, `npm run check` is
  recorded as one result, and the working tree is clean after the commit.
- **Stage 1 — not started; requires approval.** Real-provider concurrency
  validation, conflict-resolution audit/undo, sync-on-exit hardening, and legacy
  tombstone/redirect recovery design.
- **Stage 2 — not started; requires approval.** Snapshot cleanup policy,
  per-device management UI, and growth documentation.
- **Stage 3 — not started; requires approval and a real Google Drive test
  account.** Concurrent multi-device validation and OAuth publishing/branding.
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
- Conflicts are deduplicated by `kind:id:field`, never truncated to 100, and
  rendered 5 at a time with **Show all**. Remote-only disagreements are marked
  `remoteOnly` and use **Use newest cloud** / **Use other cloud**.
- Redirect approvals match by unordered destination pair.
- `isOwnSnapshot` identifies this device by envelope `deviceId`, falling back to
  the legacy fixed filename.

## Pitfalls

- Do not undo durable Undo by deleting tombstones; `restoredAt` is the protocol.
- Keep malformed remote envelopes rejecting as a whole, not filtering entries.
- Keep mixed-event imports rejected before confirmation or mutation.
- Keep `drive.appdata` as the only OAuth scope.
- Disconnecting Drive must leave automatic synchronization disabled.
- E2E expects countdown warning labels at **7 seconds remaining** and **3 seconds
  remaining**.
- Do not claim atomic remote writes or data-loss-proof synchronization. Snapshots
  accumulate until delete-all; there is no cleanup policy yet.
- Hidden older cloud approvals remain possible when a device already holds a newer
  approval for one side of a multi-remote disagreement.
