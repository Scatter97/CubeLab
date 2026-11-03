# CubeLab roadmap

**Updated:** 2026-11-03. Current delivery/test evidence belongs in
[STATUS.md](STATUS.md); risks belong in [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md).
The [previous detailed roadmap](docs/archive/ROADMAP.md) preserves completed
phase checklists and historical acceptance gates.

The work queue below is the retained project roadmap. Future feature-phase
proposals have been removed at the user's request. Keep changes scoped to the
current request; dependency installation and external account changes still
require their existing authorization.

## Delivered baseline

The timer, inspection, sessions, native backup, optional Drive sync, twelve
events, themes, scramble tools, Time Trend/PB details, the Analytics dashboard,
configurable trimming and csTimer import are implemented. Core phases 2A–4, theme polish, Phase 5 audit
remediation and Phase 6a are delivered. The first stop-response patch and
November 1 selection/import regression fixes are also implemented; remaining
performance/platform follow-ups are below.

## Retained follow-ups

1. **Verify and fix panel/readout overlap**, including moved/resized panels,
   narrow screens, timing states and layout restored after reload.
2. **Profile large-history performance** at 7,000–10,000 solves, with sync on/off,
   charts open/closed, both stop inputs, actual Zen when available and production
   preview. Separate first-result response, chart completion and storage cost.
3. **Optimize the measured bottlenecks** in hashing, statistics and charts while
   preserving recording, durability, exact pending/in-flight detection and cache
   invalidation after edits, deletion/Undo, imports, session and trimming changes.
4. **Design incremental storage separately**, including migration, crash recovery,
   failure and cross-tab safety, before replacing whole-collection writes.
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
