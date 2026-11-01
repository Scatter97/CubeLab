---
name: cubelab-architecture
description: Navigate CubeLab ownership and plan changes spanning React UI, hooks, domain logic, persistence, events, or the Vite/PWA build. Use for architecture questions, cross-layer features, and refactors; skip for isolated styling changes.
---

# CubeLab architecture

Paths below are relative to the repository root. Read `AGENTS.md` for shared rules and `NEXT_SESSION_HANDOFF.md` for current scope; this skill is a code map, not authorization for roadmap features.

## Locate ownership

| Task | Read first | Existing regression coverage |
| --- | --- | --- |
| Wiring, global Space, modal locks, solve completion | `src/App.tsx`, `src/types.ts` | `e2e/timer.spec.ts`, `e2e/cross-tab-timing.spec.ts` |
| Timing transitions vs live display | `src/timer/machine.ts`, `src/hooks/useTimer.ts`, `src/hooks/useRunningElapsed.ts`, `src/components/TimerStage.tsx` | `src/timer/machine.test.ts`, `src/hooks/useTimer.test.ts`, `src/components/TimerStage.test.tsx` |
| Sessions, solves, comments, settings | `src/lib/sessions.ts`, `src/hooks/useSessions.ts`, `src/hooks/useSettings.ts`, `src/lib/storage.ts` | `src/lib/sessions.test.ts`, `src/hooks/useSettings.test.ts`, `src/lib/storage.test.ts` |
| Import/export and confirmation | `src/lib/backup.ts`, `src/lib/csTimerImport.ts`, `src/components/DataDialog.tsx`, confirmation handlers in `src/App.tsx` | `src/lib/backup.test.ts`, `src/lib/csTimerImport.test.ts`, `e2e/timer.spec.ts` |
| Drive and cross-tab reconciliation | `src/hooks/useSync.ts`, `src/hooks/useDriveBackup.ts`, `src/lib/sync.ts`, `src/lib/driveTransport.ts` | `src/hooks/useSync.test.ts`, `src/hooks/useDriveBackup.test.ts`, `src/lib/sync.stress.test.ts` |
| Statistics and trends | `src/lib/stats.ts`, `src/lib/averageTrimming.ts`, `src/lib/timeTrend.ts`, `src/components/TimeTrend.tsx` | `src/lib/stats.test.ts`, `src/lib/timeTrend.test.ts`, `e2e/average-trimming.spec.ts` |
| Events and scramble tools | `src/lib/events.ts`, `src/lib/scramble.ts`, `src/hooks/useScramble.ts`, `src/components/ToolPanel.tsx`, `src/lib/cubeNet.ts`, `src/lib/cubeColors.ts` | `src/lib/events.test.ts`, `src/lib/scramble.test.ts`, `src/components/ToolPanel.test.tsx`, `e2e/draw-scramble.spec.ts` |
| Panel layout and tool selection | `src/lib/tools.ts`, `src/lib/toolPanelLayout.ts`, `src/hooks/useToolPanelLayout.ts`, `src/hooks/useToolPanelOpen.ts` | `src/lib/toolPanelLayout.test.ts`, `src/components/ScramblePanel.test.tsx`, `src/components/ToolPanel.test.tsx` |
| Theme/bootstrap and production workers | `src/index.css`, `index.html`, `src/hooks/useTheme.ts`, `src/lib/theme.ts`, `vite.config.ts` | `src/lib/theme.test.ts`, `e2e/accessibility.spec.ts`, offline scenario in `e2e/timer.spec.ts` |

## Follow a change through its boundaries

1. Choose the owning row. Read the implementation and its tests before editing. Keep domain transitions/calculations in pure modules; hooks coordinate state and side effects; components render and adapt input. `src/App.tsx` connects them.
2. For a persisted field, trace its type, default/parser/migration, mutation metadata, backup round trip and sync merge. Session preference keys also live in `src/lib/sessionPreferenceKeys.ts`; global setting keys live in `src/lib/settingsMerge.ts`. Local panel preferences are separate from synchronized settings.
3. For an event change, trace the registry through scramble generation, storage/import validation and both visualizations. `cubeSize` selects the N×N net; `puzzleId` selects the 3D puzzle. Follow the event rules in `AGENTS.md`.
4. Distinguish current state from presentation: `src/App.tsx` uses `src/hooks/usePostPaintValue.ts` for insights, guarded by session ID. Follow the timer/chart skills if changing this boundary; use the sync skill for data replacement or durability.
5. Run the focused tests from the relevant row using `npm test -- <test-file>`. For behavior changes, finish the verification chain in `AGENTS.md`. Build/worker changes also need the production offline scenario; a dev-server check cannot exercise it.

State the affected owners, data path, tests actually run and remaining limits. Do not copy generic React, design or Playwright tutorials into this map.
