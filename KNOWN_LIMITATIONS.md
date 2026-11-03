# CubeLab known limitations

**Reviewed:** 2026-11-03 against the implementation and the latest recorded
regression run. See [STATUS.md](STATUS.md) for test results and immediate work.
These are current boundaries; dated repair details are in the
[archived limitations record](docs/archive/PATCH_LIMITATIONS.md).

## Layout and performance

- **Panel overlap is not fully closed.** The default open panel reserves a right
  gutter, but moved/resized panels, 320 px, landscape and all timing/chart states
  still need visual verification. Existing layout tests do not establish that
  every placement keeps the readout clear.
- **Stop performance evidence is limited.** Historical measurements used 7,000
  synthetic solves, sync/audio off and isolated Firefox/Chromium. Actual Zen,
  enabled sync, 10,000 solves and physical display latency were not established.
  Chart/statistics completion can lag the first stopped result.
- **Saving still writes the full collection.** Browser storage serialization and
  writes are synchronous. Enabled sync still calculates full fingerprints;
  statistics/chart data rebuild after changes. Future caching or incremental
  persistence needs exact invalidation and durability/recovery tests.
- **Analytics runs on the main thread.** The page is lazy loaded, calculation
  results are memoized, dense chart lines are downsampled and the solve explorer
  is virtualized. A synthetic 100,000-solve correctness case passes, but no Web
  Worker offload, physical-device profiling, memory ceiling or 100,000-solve
  browser workflow has been established. Very large histories can still make the
  first Analytics calculation block noticeably.
- **Analytics is read-only and tag-free.** There is no solve-tag schema, so tag
  filters are not offered. Session comparison uses each included session's
  matching history rather than the latest-count limit. Statistical target
  estimates are labeled approximations, not predictions or WCA probabilities.
- **Fingerprints have limits.** Render-time pending detection relies on immutable
  React state references; in-place mutations can leave the display stale.
  In-flight guards recompute content fingerprints, but 32-bit FNV-1a is not a
  collision-free equality proof.

## Synchronization and recovery

- **Drive convergence is eventual.** Each device must merge again to see another
  device's newest snapshot. Unique immutable files prevent overwriting a writer's
  snapshot; they do not provide ordering, push delivery, read-after-write
  guarantees or a transaction across files. Web Locks serialize same-origin
  writes only. ETag/`If-Match` protects the legacy mutable file only.
- **Review is not consensus.** Different approval sets can yield different
  results until exchanged. A newer local approval can hide an older independent
  cloud approval in a multi-remote disagreement. Redirect merging is deterministic
  but an applied redirect cannot be automatically undone.
- **Duplicate names require user action.** Same-named sessions are never merged
  automatically. Dismissing a warning leaves the collision unresolved until the
  user reopens the Drive review action.
- **Cleanup is best effort.** Listing can lag uploads; independent deletes can
  partially succeed. Automatic cleanup runs after merge/publication, preserves
  each group's newest snapshot and can prune superseded device groups. Manual
  cleanup is own-device only. Legacy ownership falls back to sanitized filenames;
  unusually renamed files may group separately. No server-side cleanup job exists.
- **Legacy deletions remain ambiguous.** Tombstones without `knownSolveIds` use
  wall-clock comparison for clearly newer solves and explicit review for the
  ambiguous set. A user can choose incorrectly; older clients may not understand
  recovery review or durable `restoredAt` revocations. Keep sharing clients current.
- **Resolution history is local and bounded.** It retains 50 entries, is neither
  synced nor exported, and is lost if sync storage is cleared. Undo requires the
  exact decision to remain current; redirect merges, completed legacy recovery
  and superseded decisions are not automatically reversible.
- **Exit sync is best effort.** A browser may terminate OAuth/network work on
  close despite lifecycle requests. Local storage remains the durability boundary.
- **Provenance depends on sync metadata.** Clearing `cubelab:sync:v1` loses
  settings timestamps and local review history. First-sync settings then use the
  conservative fallback. Cross-tab adopted settings can lack external timestamps
  if the other tab has not yet published metadata. Selection metadata/review is
  implemented and regression-tested; it does not establish multi-device consensus.

## Import and supported scope

- Native CubeLab JSON imports replace local data after confirmation; csTimer
  imports add sessions and retain existing settings. Neither implements a general
  local-file merge by solve ID. The import cap remains 10 MB.
- Invalid rows/durations/provided dates in supported csTimer sessions reject the
  file before preview; unknown-puzzle sessions are skipped with a warning.
  Missing solve dates retain the established session-date/current-time fallback.
- Twelve events are implemented. The retained roadmap covers the existing
  product's layout, performance, storage design and external validation.

## External validation and build tooling

- **Live Drive evidence is dated.** The October 28 harness used independent
  transports in one process, not two physical browsers/machines. It exercised
  immutable concurrency, convergence, legacy conditional writes and cleanup.
  The latest repair suite used mock Drive; no new live-provider claim follows.
- **OAuth publishing is owner-dependent.** The last record reported Testing under
  another owner account. Repository code cannot establish today's console state;
  production branding and non-test sign-in need owner action and verification.
- **Hardware/accessibility coverage is partial.** Browser automation and axe scans
  do not replace physical mobile/trackpad or assistive-technology testing.
  Offline coverage is scoped to the supported Chromium project. Non-cube player
  checks establish puzzle IDs/initialization, not every rendered pixel. README
  describes existing engine-specific skips.
- **Build advisory needs rechecking before action.** The October 30 record found
  `GHSA-gcqx-w48m-w2h4` through `vite-plugin-pwa → workbox-build →
  @rollup/plugin-node-resolve → deepmerge@4.3.1`. It concerned build tooling;
  the proposed forced downgrade broke the offline pipeline. This is a dated
  dependency observation, not a current upstream-status claim. Recheck before
  selecting a compatible fix; do not force-install a breaking downgrade.
