# CubeLab roadmap

**Updated:** 2026-11-19. Current delivery/test evidence belongs in
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
twelve built-in events plus custom events, first-run onboarding, themes,
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
   the double session serialization; measured follow-ups are the redundant
   `syncStateFingerprint` traversals inside one sync run (five of six calls repeat
   an already-fingerprinted input at ~15 ms each at 10,000 solves) and the
   ~500 KB cubing.js chunk on the production startup path via Training's static
   `KPattern` import (see STATUS.md for the measured trace and deferral notes).
4. **Design incremental storage separately**, including migration, crash recovery,
   failure and cross-tab safety, before replacing whole-collection writes. The
   reviewable design is in
   [docs/development/INCREMENTAL_STORAGE_DESIGN.md](docs/development/INCREMENTAL_STORAGE_DESIGN.md);
   implementation still requires separate approval.
5. **Complete external validation**: owner-dependent OAuth, explicitly authorized
   live Drive, physical devices/assistive technology, and a recheck of the dated
   build dependency advisory before choosing a compatible fix.

Detailed entry points and the profiling matrix live in [STATUS.md](STATUS.md).

## Delivery expectations

Follow [AGENTS.md](AGENTS.md) and the relevant skill. For behavior changes, use
focused regressions and the full mock-based verification chain, restore normal
production output, and update product/status/limitations documentation only where
affected. Keep current evidence in one place; do not create another milestone
handoff document. Report untested areas and the actual commit/push state.
