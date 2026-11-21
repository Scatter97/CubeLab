# CubeLab roadmap

**Updated:** 2026-11-21. Current delivery/test evidence belongs in
[STATUS.md](STATUS.md); risks belong in [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md).
The verified primary local development environment is Arch Linux with KDE
Plasma on Wayland; see [docs/development/ARCH_LINUX.md](docs/development/ARCH_LINUX.md).
The [previous detailed roadmap](docs/archive/ROADMAP.md) preserves completed
phase checklists and historical acceptance gates.

The work queue below is the retained project roadmap. Future feature-phase
proposals have been removed at the user's request. Keep changes scoped to the
current request; dependency installation and external account changes still
require their existing authorization.

## Delivered baseline

The timer, inspection, named sessions, native backup, optional Drive sync,
twelve built-in events plus MISC, first-run onboarding, themes,
scramble tools, Time Trend/PB details, the Analytics dashboard, configurable
trimming, csTimer import, competition sessions with derived rounds and the
OLL/PLL Training workspace are implemented.
Core phases 2A–4, theme polish, Phase 5 audit remediation and Phase 6a are
delivered. The first stop-response patch and November 1 selection/import
regression fixes are also implemented; remaining performance/platform
follow-ups are below.

## Retained follow-ups

1. **Floating-panel occlusion** — auto-avoid implemented 2026-11-19 for saved and
   released panel positions, including reload. Retain visual confirmation at
   narrow/short edge sizes where no clear side exists.
2. **Profile large-history performance** at 7,000–10,000 solves, with sync on/off,
   charts open/closed, both stop inputs, Zen Browser when available and
   production preview. Separate first-result response, chart completion and storage cost.
   The 2026-11-19 persistence/Analytics pass measured the pure calculation and
   serialization layers (see STATUS.md); browser stop-response with enabled sync
   remains the unmeasured part.
3. **Optimize the measured bottlenecks** in hashing, statistics and charts while
   preserving recording, durability, exact pending/in-flight detection and cache
   invalidation after edits, deletion/Undo, imports, session and trimming changes.
   The 2026-11-19 pass removed the duplicate Analytics rolling-series rebuilds and
   the double session serialization. The 2026-11-21 pass memoized
   `syncStateFingerprint` by immutable `(sessions, settings)` identity, removing
   the repeated in-run traversals. At 10,000 solves the production stop path is
   still dominated by synchronous full-collection persistence (median 79–174 ms to
   idle across two runs); incremental storage is the next step. The ~500 KB
   cubing.js chunk on the production startup path via Training's static `KPattern`
   import remains a separate measured follow-up.
4. **Design incremental storage separately**, including migration, crash recovery,
   failure and cross-tab safety, before replacing whole-collection writes. The
   reviewable design is in
   [docs/development/INCREMENTAL_STORAGE_DESIGN.md](docs/development/INCREMENTAL_STORAGE_DESIGN.md);
   implementation still requires separate approval.
5. **Complete external validation**: owner-dependent OAuth, explicitly authorized
   live Drive, physical devices/assistive technology, and a recheck of the dated
   build dependency advisory before choosing a compatible fix.
6. **Training history backup, portable large backups and Training Drive
   sync** — delivered 2026-11-20. Native backup/restore includes the complete
   checked Training store with replace-only restore, and the checked gzip path
   handles native files above the legacy 10 MB compact limit within 16 MB
   encoded / 64 MB decoded bounds. Training also has a separate `cubelab-training-*` Drive file
   family: manual backup, replace-only restore and optional merge-based sync
   with `cubelab:training-sync:v1`, tombstones, conflict review and separate
   retention. Solve snapshots and csTimer imports still exclude Training, and
   the solve Drive cap remains unchanged at 10 MB. Designs and the implementation
   record are in
   [TRAINING_HISTORY_BACKUP_DESIGN.md](docs/development/TRAINING_HISTORY_BACKUP_DESIGN.md)
   and [TRAINING_DRIVE_SYNC_PLAN.md](docs/development/TRAINING_DRIVE_SYNC_PLAN.md).
   Retained boundary: live Google Drive, physical devices, provider concurrency
   and Firefox/WebKit Training Drive flows remain unverified.

Detailed entry points and the profiling matrix live in [STATUS.md](STATUS.md).

## Delivery expectations

Follow [AGENTS.md](AGENTS.md) and the relevant skill. For behavior changes, use
focused regressions and the full mock-based verification chain, restore normal
production output, and update product/status/limitations documentation only where
affected. Keep current evidence in one place; do not create another milestone
handoff document. Report untested areas and the actual commit/push state.
