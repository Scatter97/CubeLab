# Time Trend compact redesign plan

**Status:** Implemented and verified 2026-11-21
**Date:** 2026-11-21
**Area:** Time Trend floating tool, Settings, chart presentation
**Owners:** `src/components/TimeTrend.tsx`, `src/lib/timeTrend.ts`, `src/components/ToolPanel.tsx`, `src/lib/storage.ts`, `src/components/SettingsDialog.tsx`, `src/index.css`

## Goal

Replace the current compact chart plus expanded dialog with a single
csTimer-style compact Time Trend tool that fits the floating tool panel:

- Chart-first layout with a top legend and five icon buttons.
- Read-only hover inspection and PB statistics in the compact panel.
- No expanded Time Trend dialog, no PB statistics modal and no Expand button.
- No view-changing mouse gestures in the compact chart. Pan and zoom are
  button-driven only.
- Global Y-scale and Auto-cutoff preferences live in Settings.
- The large-chart destination is the existing Analytics page.

This plan builds on the current working tree, including the uncommitted Auto Y
scale and current-tool persistence work. Do not revert unrelated changes.

## Approved decisions

1. **Fixed series:** Time Trend always shows time (single), ao5 and ao12, plus
   PB markers. There is no custom-average or additional-series selection in
   Time Trend. Other averages remain available in Statistics and Analytics.
2. **Settings:** Y scale (`Auto` / `Full range`) and Auto cutoff
   (`Gentle` / `Standard` / `Strong`) live in Settings.
3. **No PB modal:** There is no full PB statistics dialog. Generic solve details
   and PB statistics are shown in a hover/focus card.
4. **PB activation:** PB markers use the existing `--trend-pb` color and have a
   larger hover/activation area than normal solve hover targets.
5. **Current PB:** The current PB is the **latest lifetime PB marker**, not
   necessarily the last solve. Only that marker gets the current-PB ring and
   pulse. All older lifetime PB markers are larger and hoverable but static.
6. **Pulse timing:** The current PB may pulse continuously while it remains the
   latest lifetime PB. A newer lifetime PB takes over the pulse. Reduced motion
   uses a static ring only.
7. **Keyboard:** The chart supports arrow-key inspection, Home/End to jump to
   the first/latest solve, and Escape to clear the card.
8. **Compact only:** Remove the expanded Time Trend dialog and the Expand
   button. Analytics is the large-chart view.
9. **Hover only for details:** Keep the compact crosshair and hover card. Do not
   open a modal from the chart.
10. **No mouse view gestures in compact:** No wheel zoom, pinch, drag-pan or
    pointer-capture pan. The five buttons are the only viewport controls.

## Target compact layout

```text
┌────────────────────────────────────┐
│ — time   — ao5   — ao12   • PB    │
│ ┌────────────────────────────────┐ │
│ │ 1:20 ───────────────────────── │ │
│ │   40 ───────────────────────── │ │
│ │   20 ───────────────────────── │ │
│ │   10 ───────────────────────── │ │
│ └────────────────────────────────┘ │
│    ↔       ‹       ›      ⊕     ⊖  │
├────────────────────────────────────┤
│ FUNCTION  Time Trend            ▾  │
└────────────────────────────────────┘
```

- Legend at the top with line swatches and a PB dot.
- Bordered plot card with solid horizontal gridlines.
- No in-panel title, solve count, Expand button, Fit button, range slider,
  range-statistics footer or gesture-help paragraph.
- No x-axis labels in Time Trend. Solve order is the x-axis.
- Y labels remain left-aligned outside the plot.
- The Function footer remains owned by `ToolPanel`.

## Compact interactions

### Hover and crosshair

- Pointer movement over the plot shows the crosshair and the nearest solve.
- A generic hover card shows:
  - solve number
  - effective time (`+2` suffix, `DNF` when applicable)
  - date
  - ao5 and ao12 when available
- Hovering a PB marker takes priority over the generic nearest-solve card.
- The card is clamped inside the tool panel.
- Moving from a PB marker into its card should not immediately dismiss it. Use
  pointer presence on the marker/card with a short close delay.
- Escape dismisses a pinned card.
- While the timer is active, hover and PB interactions are disabled.

### PB hover card

Show:

- `PB` or `Current PB`
- Effective PB time and +2/DNF state
- Improvement versus the previous PB, both time and percent
- Previous PB time and solve number
- Solve number and date
- mo3, ao5 and ao12
- Optional one-line scramble

Use `buildPBStats(points, solveId, [5, 12], trimming)`. For the first valid
solve, show `First valid solve — starting PB`.

There is no click-to-open modal. Click/tap may pin the card for touch or pointer
inspection; Enter has no modal action.

### Touch

- Tap a point or PB marker to pin its card.
- Tap another point to move the pin.
- Tap outside the chart or press Escape (with a keyboard) to dismiss.
- No modal and no pointer-capture drag.

### Keyboard

- Make the chart focusable (`tabIndex=0`) with an accessible label.
- Left/Right move the inspected solve.
- Home/End select the first/latest solve.
- Escape clears the hover/pin state.
- Keep a visible focus ring.
- Announce keyboard selection changes through a polite live region summary.
- Do not capture Space or affect timer controls.
- PB markers are not separate tab stops; arrow navigation reaches them and
  displays PB statistics.

### Five viewport buttons

1. **Axis toggle** (`↔` / `↕`) switches the pan/zoom axis.
2. **Pan earlier / pan later** move 25% of the currently visible span in the
   selected axis.
3. **Zoom in** applies about `√2` magnification around the viewport center.
4. **Zoom out** applies about `√2` reduction, stopping at the fit boundary.
5. **No Fit button.** Repeated zoom-out reaches fit.

Use a compact axis state (`'x' | 'y'`, default `'x'`) separate from the old
expanded `Zoom axes` selector. Disable pan buttons at their bounds and zoom
buttons at their limits. Clear hover when the viewport changes.

- Icon-only buttons, 24–28 px hit targets, inline SVG icons.
- Accessible labels describe the current axis and action.
- No new icon dependency.
- Buttons respect the existing timer lock.

### Removed mouse behavior

- Do not attach compact wheel or Safari gesture listeners.
- Do not use pointer capture for panning.
- Do not change the viewport on pointer drag.
- Use a crosshair cursor for inspection, not `grab` / `grabbing`.
- Do not set `touch-action: none` for the compact plot.
- Page scrolling and browser zoom should remain unaffected outside hover.

## PB marker design

Use the existing `--trend-pb` color. Do not introduce a new PB hue.

| Marker | Treatment |
| --- | --- |
| Ordinary PB | Radius about 3.2–3.5 px; `--surface` stroke |
| Current PB | Radius about 4.2 px plus a static outer ring/halo |
| Current PB, not reduced motion | Gentle repeating pulse on the outer ring |
| Older lifetime PB | Ordinary larger PB marker; no ring or pulse |

- Increase the invisible PB hover/click target to about 16 px radius.
- Current PB = last chronological point with `personalBest === true`.
- Only that marker gets `is-current-pb` / pulse styling.
- When a newer lifetime PB occurs, move the current treatment to it and stop
  the previous marker's pulse.
- Add `data-current-pb` or a stable class for tests.
- Pause the pulse while the timer is active.
- Under `prefers-reduced-motion: reduce`, keep the static ring and disable the
  animation.
- Do not animate color; keep the marker fill and ring in `--trend-pb`.
- Accessible label includes `Current personal best` for the current marker.
- Older PB markers remain individually hoverable and show their own historical
  improvement versus the PB before them.

## Settings

Add a **Time Trend** fieldset under **Settings → Statistics**:

```text
Time Trend
  Y scale            [ Auto ▾ ]
  Auto Y cutoff      [ Standard ▾ ]

  Gentle shows more slow solves.
  Strong focuses on the main trend.
  Full range shows every result.
```

Fields:

- `timeTrendScale: 'auto' | 'full'`, default `'auto'`
- `timeTrendCutoff: 'gentle' | 'balanced' | 'strong'`, default `'balanced'`

Behavior:

- Settings apply globally to the compact chart.
- `Auto` uses the selected cutoff.
- `Full range` ignores the cutoff; disable or explain the cutoff control in
  that state.
- The cutoff never clips enabled rolling averages.
- Fewer than 10 valid singles remain full-range.
- No chart markers or counts indicate clipped values.

### Cutoff presets

| UI label | Fence |
| --- | --- |
| Gentle | `max(Q3 + 4 × IQR, 1.75 × Q3)` |
| Standard | `max(Q3 + 3 × IQR, 1.5 × Q3)` |
| Strong | `max(Q3 + 2 × IQR, 1.25 × Q3)` |

Keep the existing maximum-average clamp and minimum-sample rule.

### Settings schema

- Add `timeTrendScale` and `timeTrendCutoff` to `Settings`.
- Default both in `DEFAULT_SETTINGS`.
- Validate both in `parseSettingsData`; older records and backups fall back to
  `auto` / `balanced`.
- Bump `SETTINGS_STORAGE_VERSION` from 12 to 13.
- `SettingsFieldKey` is `keyof Settings`, so settings-sync field updates include
  the new fields automatically; add explicit sync/merge coverage.
- Native backup includes the settings object; older backups without fields
  parse to defaults.
- Older builds that only understand v12 will reject v13 settings. This is the
  normal schema-bump compatibility boundary and should be documented.
- The storage key remains `cubelab:settings:v1`.

## Removed features and replacements

| Removed | Replacement |
| --- | --- |
| Expand button and expanded dialog | Analytics page for a larger chart |
| Series chips and custom averages | Fixed time/ao5/ao12; Statistics/Analytics keep other averages |
| PB markers toggle | PB markers always shown |
| Date x-axis | Solve order only |
| Zoom axes select | Five-button axis toggle |
| Range slider | Five-button pan/zoom only |
| Range statistics footer | Statistics/Analytics |
| Gesture help | Removed |
| PB statistics modal | Hover/focus PB card |

Keep the shared dialog/content/button CSS used by Analytics solve dialogs
(`.time-trend-dialog`, `.time-trend-modal-header`, `.time-trend-button`,
`.time-trend-pb-content`, etc.). Do not delete those shared styles just because
`PBStatsDialog.tsx` is removed.

## Data and durability rules

- Never mutate stored solves or source solve order.
- Continue using the post-paint `insightSolves` feed from `App`.
- Keep the timer-active interaction lock.
- PB improvement and rolling values continue to use the shared statistics and
  trimming helpers.
- The chart remains SVG; no canvas migration.
- No storage/sync/backup changes beyond the Settings fields.
- No Analytics calculation changes.

## Performance

- Keep dense-path downsampling.
- Because hover is now the primary compact interaction, replace the linear
  nearest-point scan with a binary search over monotonic x positions.
- Memoize PB stats for the hovered PB ID; do not rebuild all PB windows on every
  pointer move.
- Keep pointer-hover state updates cheap; coalesce to animation frames if
  needed.
- CSS pulse must be low-cost and respect reduced motion.
- Verify timer stop response is unchanged with the panel open.

## Implementation steps

### 1. Settings data and UI

- Add the two types/fields to `src/types.ts`.
- Update `DEFAULT_SETTINGS` and `parseSettingsData` in `src/lib/storage.ts`.
- Bump `SETTINGS_STORAGE_VERSION` to 13.
- Add the Time Trend fieldset and selects to `src/components/SettingsDialog.tsx`
  with test IDs `time-trend-scale` and `time-trend-cutoff`.
- Update settings sync/merge/backup tests and settings docs.

### 2. Pure trend helpers

- Add `TimeTrendCutoff` handling and preset constants in `src/lib/timeTrend.ts`.
- Extend `trendOutlierLimit` with a cutoff argument defaulting to the current
  Standard behavior.
- Keep `trendAxis`, `trendPath`, `buildTrendData` and `buildPBStats` contracts.
- Add a pure helper for the latest lifetime PB if useful.

### 3. Rewrite `TimeTrend.tsx`

- Remove the expanded state, dialog, portal, Expand button and PB modal.
- Remove series/custom/date/range/gesture-help state and markup.
- Read scale and cutoff from props.
- Keep fixed series: single, ao5, ao12, PB.
- Add the five-button compact control strip.
- Add chart focus, arrow navigation, crosshair, hover card, PB card, touch pin
  and Escape dismissal.
- Compute current PB and apply only its ring/pulse.
- Keep PB markers larger with bigger hit targets.

### 4. Chart rendering

- Gate compact interaction:
  - hover only
  - no wheel/gesture listeners
  - no drag/pointer capture
  - default page scroll and browser zoom outside hover
- Render crosshair and hover card.
- Render larger PB markers and current-PB pulse.
- Keep SVG roles/labels and clipping.
- Binary-search nearest x on pointer move.

### 5. Remove obsolete code

- Delete `src/components/PBStatsDialog.tsx` if no other component imports it.
- Remove Time Trend expanded-only CSS while retaining shared classes used by
  Analytics.
- Remove `useModalDialog` usage from `TimeTrend`.
- Remove expanded-related imports and helpers.

### 6. Tests

Unit:

- cutoff presets, 10-single floor, average clamp, zero variance, invalid values
- settings v12→v13 parsing/defaults
- latest PB selection and improvement stats
- dense path and axis regressions unchanged

Component:

- fixed legend and no Expand button
- generic hover/crosshair card
- PB hover priority, larger marker, improvement text
- only latest PB has current class/pulse
- older PBs static
- touch pin and Escape
- arrow/Home/End keyboard inspection
- five buttons, axis toggle, bounds and disabled states
- no wheel/pointer drag viewport changes
- timer lock and empty/DNF states

Browser:

- rewrite `e2e/time-trend.spec.ts` for the compact-only UI
- update `e2e/average-trimming.spec.ts`,
  `e2e/timer-response.spec.ts` and `e2e/tools.spec.ts`
- 220 px default and 150×170 minimum panel
- 320 px viewport, light/dark, axe
- Settings changes update the chart and survive reload
- hover, PB hover, current PB marker, keyboard and touch pin
- timer stop response remains stable

### 7. Documentation

- README: compact-only Time Trend, five buttons, hover/PB stats, Settings,
  Analytics as the large-chart destination
- FEATURES: remove expanded dialog/PB modal claims; document fixed series,
  hover card, current-PB treatment and Settings schema v13
- KNOWN_LIMITATIONS: no expanded in-panel chart, hover-only details, fixed
  series, full-range/cutoff in Settings, tooltip accessibility boundaries
- STATUS: record implementation and verification after it lands
- AGENTS.md: settings schema v13 and other affected claims
- chart-performance skill: new compact interaction and test map
- README architecture map and screenshots

## Verification commands

```bash
npm run typecheck
npm run lint
npm test -- src/lib/timeTrend.test.ts src/components/TimeTrend.test.tsx \
  src/components/SettingsDialog.test.tsx src/lib/storage.test.ts \
  src/lib/settingsMerge.test.ts src/hooks/useSettings.test.ts
npm run test:e2e -- e2e/time-trend.spec.ts e2e/average-trimming.spec.ts \
  e2e/tools.spec.ts e2e/timer-stability.spec.ts e2e/timer-response.spec.ts \
  --project=chromium --workers=4 --retries=0
npm run build
git diff --check
```

Run the full settings/sync/backup unit files affected by schema v13 before
editing. Do not run `npm run validate:drive`; it is not routine verification.

## Acceptance criteria

- Time Trend has one compact view only.
- No Expand button, expanded Time Trend dialog or PB statistics modal remains.
- Top to bottom: legend, plot card, five icon buttons, Function footer.
- Hover shows crosshair and details; PB hover shows improvement versus the
  previous PB.
- Only the latest lifetime PB pulses; older PB markers are static.
- PB markers are visibly larger and use `--trend-pb`.
- Keyboard arrow inspection works and does not interfere with the timer.
- No mouse wheel, pinch or drag changes the compact viewport.
- Settings contains Y scale and Auto cutoff; schema migration is covered.
- Full range remains reachable in Settings.
- Analytics remains the large-chart path.
- Timer response, focus, touch, 320 px and minimum-panel layouts pass.
- Documentation and screenshots match the final UI.

## Non-goals

- No new Analytics chart or Analytics redesign.
- No solve/session/Training schema changes.
- No native backup format changes beyond the Settings fields.
- No changes to PB calculations, trimming, recorded precision or sync
  reconciliation beyond the Settings schema bump.
- No new chart library or canvas migration.
