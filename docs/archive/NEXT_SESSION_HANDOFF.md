> **Historical snapshot — archived 2026-11-01.** This record may contain
> superseded behavior, approval milestones and verification results. For current
> work read [STATUS.md](../../STATUS.md), [AGENTS.md](../../AGENTS.md) and
> [KNOWN_LIMITATIONS.md](../../KNOWN_LIMITATIONS.md). Paths in code spans
> and command blocks retain their original repository-root context.

# Next Session Handoff

**Updated:** 2026-11-01. **Implementation last verified:** 2026-11-01.
**Branch:** master. **Runtime:** Node 22 or newer (validated with v22.23.2).

## Current checkpoint

The accumulated implementation includes Phase 5 audit remediation, csTimer
import, the draggable/resizable 2D/3D scramble panel, Time Trend, independent
trackpad axes and pinch/pan, clickable historical PB statistics, configurable
average trimming, the first large-session stop-response patch, and Phase 6a
(Pyraminx, Skewb, Square-1, Clock, and Megaminx). These are implemented and
verified. Future feature-phase proposals were subsequently removed at the
user's request. Sessions remain schema v4; settings are schema v8.

The November 1 Phase 6a commit includes the new event registry, official
`cubing.js` scrambles, storage/backup/import/sync validation, correct 3D
puzzles, the honest 2D fallback, tests and documentation. Later commits add the
default-panel gutter mitigation and tracked skills. Locate the Phase 6a commit
with `git log --oneline --grep="Implement CubeLab Phase 6a"`. Inspect the current
working tree with `git status --short`; no remote push is part of this handoff.

## Completed steps

1. Closed the audit regressions: timer-safe in-flight sync, cross-tab deferral,
   exact conflict approvals, singleton restore normalization, recorded-result
   precision, active-session selection metadata and cleanup retry handling.
2. Added csTimer import through the existing preview/confirmation flow. Unknown
   puzzle sessions are skipped with a warning; supported solves retain their
   original times, dates, penalties, scrambles and notes.
3. Added a persisted, pointer-isolated tool panel with scramble-derived standard
   colors in 2D and cubing.js PG3D. Position/size save only after gestures end.
4. Added compact/expanded Time Trend, DNF gaps, nonnegative scales, extrema-aware
   dense paths, responsive sizing, date axes, range summaries and accessibility.
5. Added independent horizontal/vertical wheel and trackpad zoom, pinch zoom,
   pointer pan and Fit reset. Small PB markers have larger invisible hit areas;
   PB dialogs show historical rolling windows ending at the selected solve.
6. Added independent better/worse average trimming in Settings. Defaults are
   5% / Auto, percentages round up and even medians retain two middle results.
   Policies propagate through cards, charts, PB details, backups and sync.
7. Improved stopping with large histories: capture press time before audio and
   focus, animate the live readout locally, refresh expensive presentation after
   a rendering opportunity, and skip unused UI fingerprinting when sync is off.
8. Fixed the audit's session-choice review/provenance and csTimer validation gaps.
   Reviewed choices survive later syncs, metadata stays with its selected value
   through envelope parsing/adoption, and malformed supported imports fail before
   preview/confirmation. Regression tests cover pure, hook and browser paths.

## Verified baseline

`VITE_DRIVE_MOCK=true npm run check` passed as one command on November 1 after
the audit regression fixes (including all Phase 6a coverage):

| Check | Result |
| --- | --- |
| TypeScript and Oxlint | Passed |
| Unit/component tests | 553 passed in 39 files |
| Production build | Passed |
| Browser tests | 258 passed, 9 existing skips, 267 total |
| Browser engines | Chromium, Firefox, WebKit |
| Per-event coverage | All 12 events at desktop and 390 px mobile |
| New-puzzle visualization | Players initialize with expected puzzle IDs; 2D shows an honest unavailable state; canvas probes are Chromium-only |
| 7,000-solve stop regression | Passed in all three engines |
| Offline service-worker flow | Passed in the supported Chromium project |
| Final normal production build | Restored successfully after mock tests |
| Whitespace check | Passed |

The dense-session regression checks both stop inputs before release, repeat
suppression, exactly one saved solve, display/raw-result agreement, unchanged
old solves, reload recovery and session switching. Existing tests cover
in-flight upload edits, timer-active guards, tombstones, approvals, backups,
settings reconciliation, trimming and accessibility. Skips were not increased.
Live Drive was not rerun; the historical real-provider harness passed 7/7 on
October 28. Zen, physical trackpads/mobile hardware and production OAuth
non-test sign-in were not validated by the latest patch.

## Performance evidence and remaining costs

Eight measured Firefox 157 stops per condition followed a discarded warm-up,
with 7,000 synthetic metadata-bearing solves (about 3.49 million saved
characters), sync/audio off and an isolated browser context. Median
input-listener-to-observable-stopped-DOM response:

| Condition | Before | After |
| --- | ---: | ---: |
| Development, chart closed | 223 ms | 74 ms |
| Development, Time Trend open | 382 ms | 75 ms |
| Production, chart closed | 66 ms | 25 ms |
| Production, Time Trend open | 75 ms | 22 ms |

These are historical recorded measurements; raw profiling traces are not tracked
in the repository, so their original numbers were not independently revalidated
by the documentation audit. They are not physical-display or actual Zen measurements.
Chart completion can take longer, especially in development mode. Chromium Event Timing also
showed earlier next-paint response with the development chart open (available
entries: median 356 ms before, 56 ms after). Do not infer enabled-sync or
10,000-solve stop performance from these sync-off 7,000-solve measurements.

Enabled sync still calculates complete fingerprints. Local saving still
serializes and synchronously writes the full collection. Historical statistics
and chart data still rebuild after changes; the first patch prioritizes stop
feedback rather than replacing those algorithms or the storage model.

## Recommended next steps

### 1. Finish the narrow-screen tool-panel overlap review

A right gutter is reserved while the default panel is open, but moved/resized
panels and wide layouts still need visual verification. Do not mark this
follow-up complete until desktop, 320/390 px, mobile landscape and timing states
have been inspected with the panel open, moved, resized and persisted.

### 2. Profile the remaining performance cases before changing sync

Reproduce on the user's Zen development site (`http://localhost:5173/`) and the
production preview (`http://127.0.0.1:4173`). Use isolated 7,000- and 10,000-solve
fixtures, both inputs, charts open/closed, expanded/custom averages and sync
on/off. Measure input dispatch, captured timestamp, first result rendering,
chart completion, storage cost and long tasks separately. Retain median/range
and sample counts; do not turn host timing numbers into brittle E2E thresholds.

### 3. Optimize only the measured remaining work

For enabled-sync hashing, evaluate revisions/caching or background work while
preserving exact pending status, redundant-upload detection and in-flight guards.
For statistics/charts, append incremental results where valid and fully
invalidate on edits, deletion, import, session changes and trimming changes.
Any incremental storage proposal needs crash recovery, failure handling,
migration/rollback and cross-tab tests before adoption. Do not debounce saves
or weaken durability merely to improve a benchmark.

### 4. Complete external and owner-dependent validation

Arrange a live Drive rerun only with an explicitly supplied short-lived test
credential. Test physical mobile/trackpad and assistive technology when available.
The Google Cloud owner must handle OAuth publishing/non-test access; the latest
patch does not prove the current external console state. Recheck the dated
build-dependency advisory before selecting a compatible fix, then verify offline
behavior. Follow the retained work queue in the current root roadmap; the
former future feature-phase proposals have been removed.

## Correctness rules to preserve

- Keep timer transitions/inspection penalties in `src/timer/machine.ts`,
  monotonic `performance.now()` input times and authoritative refs. Display
  rounding/animation must never determine recorded duration or duplicate a solve.
- Only presentation is delayed. The final readout, persistence, sync refs,
  tombstone detection and sync scheduling receive current session data.
- Preserve enabled-sync fingerprints, exact approvals, timer-active guards,
  deferred idle reconciliation, same-origin write locks and exit-sync behavior.
  Disabled-sync deletion tracking still records future synchronization metadata.
- Immutable snapshots are create-only. Provider CAS protects only the legacy
  mutable file; no cross-file transaction or data-loss-proof guarantee exists.
- Share trimming/precision helpers everywhere. A default ao1000 drops 50 results
  at each end, so 50 DNFs can be removed; 51 make it DNF. mo3 is untrimmed.
- Keep settings v1–v7 migration to v8 defaults, separate-side merging, raw solve
  immutability, ID-based session guards and historical PB windows.
- Preserve the 12-event registry, official cubing.js scramble IDs, the
  N×N-only 2D net with honest non-cube fallback, cubing.js worker isolation,
  tokenized light/dark palettes, modal focus restoration and Space reservation.

## Reproduction and delivery commands

Use Node 22+; the installed validation runtime is
`/home/joshua/.nvm/versions/node/v22.23.2/bin/node`.

```bash
npm run dev
VITE_DRIVE_MOCK=true npm run check
npm run build
git diff --check
git status --short
```

The normal build after mock checks restores non-mock production output. If
running browser tests alone against an already-running preview, explicitly
build with `VITE_DRIVE_MOCK=true` first: Playwright reuses that server and skips
its own server/build command. Never commit dist, dependencies, browser reports,
local credentials or scratch measurements. Run focused regressions followed by
the full check after a behavior change; documentation-only changes need link,
reference and whitespace verification rather than an unnecessary full rebuild.

For live-provider validation, follow README instructions for
`npm run validate:drive`; never print or commit the token. Record what was
actually exercised and distinguish historical provider evidence from new tests.
