# CubeLab feature and behavior inventory

Source audit: **2026-11-04**, application baseline **`3e3d38a`**. This describes
implemented features, not proposed future work. It includes visible controls,
settings defaults, persistence scope, interaction rules, and data behavior.
The source links identify the owning implementation; this inventory is not a
claim that every combination has been manually tested. See [STATUS.md](STATUS.md)
for dated verification and [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md) for limits.

## Contents

- [Application and navigation](#application-and-navigation)
- [Timer, input, inspection and feedback](#timer-input-inspection-and-feedback)
- [Puzzles and scrambles](#puzzles-and-scrambles)
- [Sessions and custom events](#sessions-and-custom-events)
- [Solve history and actions](#solve-history-and-actions)
- [Statistics and calculation behavior](#statistics-and-calculation-behavior)
- [Floating tools and Time Trend](#floating-tools-and-time-trend)
- [Analytics](#analytics)
- [Complete settings reference](#complete-settings-reference)
- [Backup, import and destructive actions](#backup-import-and-destructive-actions)
- [Google Drive synchronization and recovery](#google-drive-synchronization-and-recovery)
- [Persistence, accessibility and platform behavior](#persistence-accessibility-and-platform-behavior)
- [Implementation and test map](#implementation-and-test-map)

## Application and navigation

- Local-first browser application with **Timer** and **Analytics** header views.
- Timer is the initial view; the active session supplies the current event,
  solves, statistics and history. Header context identifies session/event and
  inspection state.
- Analytics is read-only and lazy loaded. Timer keyboard handling is disabled
  there; switching to Analytics is unavailable during an active timer gesture.
- Header Settings opens automatically saved preferences; Done/Close dismisses
  the dialog rather than applying a separate batch of edits.
- Desktop uses a statistics/history rail beside scramble and timer. Narrow
  screens place timing first and stack the other areas below it; short portrait
  and landscape viewports scroll the workspace beneath a readable timer instead
  of painting panels over the readout.
- Statistics/Solves divider supports pointer dragging and keyboard resizing:
  arrows, larger Shift steps, Home/End limits, Enter/double-click reset. The
  preferred split is persisted. Desktop fits complete enabled statistic rows
  and distributes spare row height; mobile shows every enabled statistic.
- A bottom-right display version identifies the running build. It is separate
  from storage and backup schema versions.
- Toasts report actions, failures and available follow-up actions such as Undo
  or Review Merge. Empty, loading and error states are part of each relevant flow.

## Timer, input, inspection and feedback

### Timing lifecycle

- Keyboard Space or primary pointer input on the timer operates the timer.
  Holding arms it; the ready state signals that release will start timing.
  Releasing before ready cancels the hold, or returns to the same inspection.
- Without inspection: hold → ready → release starts → next press stops.
- With inspection: first press starts inspection; a second hold and release
  starts the solve. Holding does not pause inspection.
- Elapsed time comes from monotonic `performance.now()`. Wall-clock dates are
  metadata, not the timer clock. Saved timer durations are floored to whole ms.
- Stopping uses the press timestamp, records one solve with event, current
  scramble and inspection penalty, and advances to the next scramble. Release
  does not stop or record again; repeated presses cannot re-arm an active hold.
- Live display updates and slower statistics/history/chart rendering are
  separated. The final result gets a rendering opportunity before expensive
  insights; persistence and sync still receive current solve data.
- Starting requires an available scramble. Loading/error states block a new
  start instead of recording a solve with a missing scramble.
- Escape cancels inspection/arming before timing. It does **not** cancel or
  discard a running solve. Modifier combinations and OS key repeat are ignored
  by the global timing shortcuts.
- Losing window focus cancels a holding/ready gesture so it cannot remain stuck;
  a running solve continues. Idle shows the last result, including a DNF raw-time
  caption or the effective +2 result when applicable. Arming has progress and
  ready/release feedback; inspection displays its progress and penalty state.

### Input boundaries

- On the Timer view, Space is reserved for timing and does not scroll the page.
  Text inputs retain normal typing; custom dropdowns/disclosures and dividers
  keep their own Space behavior. Enter activates focused buttons and switches.
- Optional any-key stop applies only while running, ignores modifier-only keys,
  repeat events and text/control entry boundaries. Tab may still move focus.
- Modal dialogs block global timer input. Settings, event/session controls and
  relevant data-changing actions are locked while holding, ready, inspecting or
  running. Floating tools do not start/stop timing through their pointer events.
- Cross-tab or cloud adoption cannot switch the session of an in-flight solve.

### Inspection

| Start-time inspection elapsed | Automatic penalty |
| --- | --- |
| Through exactly 15,000 ms | None |
| Over 15,000 through exactly 17,000 ms | +2 seconds |
| Over 17,000 ms | DNF |

- Count down starts at 15; count up starts at 0. After the limits, the readout
  indicates +2 and then DNF. The penalty is determined when the solve starts.
- Independent 8-second and 12-second warnings use elapsed inspection time. In
  count-down mode their labels are 7 and 3 seconds remaining; in count-up mode,
  8 and 12 seconds elapsed.
- Enabled inspection warnings pulse visually and announce a direction-aware
  label through the live region. The visual scope can be timer or entire screen;
  there is no separate warning-text overlay. Sound/haptic follow the selected
  alert channel, including when the warning's visual pulse remains enabled.
- Solve/DNF feedback supports visual, sound, haptic and offered combinations.
  DNF sound is slightly louder than ordinary completion at the same volume.
- Inspection rules are shared by all events. Competition-specific cutoffs and
  time limits are not implemented.

Owners: [timer machine](src/timer/machine.ts), [timer hook](src/hooks/useTimer.ts),
[timer display](src/components/TimerStage.tsx), [input wiring](src/App.tsx),
[alerts](src/lib/alerts.ts).

## Puzzles and scrambles

- Built-in events: **3×3, 2×2, 4×4, 3×3 OH, 5×5, 6×6, 7×7, Pyraminx,
  Skewb, Square-1, Clock and Megaminx**.
- Built-in scrambles use the event registry and official `cubing.js` generators.
  One current and one prefetched next scramble reduce waiting after a solve.
- Event changes reset the scramble queue; stale generation results are ignored.
  Loading, generation failure and explicit retry are supported.
- Scramble text supports left/center/right alignment, optional limited height,
  and a configured activation action: nothing, copy, or next scramble.
- A separate next/regenerate control advances the scramble without recording a
  solve; retry controls recover from generation failure.
- The floating Draw Scramble tool follows the current event and scramble.
  Settings chooses 2D net or 3D puzzle.
- 2D nets are scramble-derived for N×N cubes; colors are U white, D yellow,
  F green, B blue, R red, L orange. Non-cube events explain that 2D is unavailable.
- 3D uses the event's `cubing.js` PG3D puzzle, rather than substituting a cube.
- Custom events show their configured placeholder or the default custom-event
  placeholder; they have no generated scramble or 2D/3D visualization. Imported
  solves keep their original scramble text.

Owners: [events](src/lib/events.ts), [scramble queue](src/hooks/useScramble.ts),
[scramble component](src/components/ScramblePanel.tsx),
[tool panel](src/components/ToolPanel.tsx).

## Sessions and custom events

### Session lifecycle

- Starts with one empty **Session 1**; create, select and rename named sessions.
  The creation dialog suggests the event label, lets the user choose event/name
  and an explicit inspection override, and requires a unique name. The lower-level
  unnamed-session fallback chooses the next unused Session number. Names are
  trimmed, limited to 40 characters and checked case-insensitively for duplicates
  during editing. Creating a session makes it active.
- Sessions have stable IDs and independent solve histories/statistics. A session
  event applies to the session's solves; event identity is never inferred from
  names, solve durations or scramble text.
- Selector has separate selection and drag handles, arrow-key reordering and
  accessible Up/Down move controls. Reordering does not select another session.
- Session ordering persists locally, round-trips in native backups and syncs as
  an ID-based ordering record; additions are appended without dropping sessions.
- Session settings gear exposes name, event, session overrides, custom-event
  management, merge/split, clear and delete. Controls lock during active timing.
- Merge accepts one or more same-event sources and one destination, previews
  names/counts/resulting total, preserves every solve field/ID, removes sources
  after transfer and makes the destination active. Incompatible events are
  disabled with an explanation.
- Split moves individual or range-selected solves into a new named session.
  It supports Shift-click ranges, position-range entry, Select all/none, live
  moved/remaining counts and windowed rendering for large histories. The new
  session copies event/per-session settings, is inserted after the source and
  becomes active; the source remains even when emptied. Both operations require
  typed confirmation and have no Undo.
- Event correction on a populated session requires confirmation showing the
  session, previous/new events and affected count. It changes the session and
  every solve together, retaining IDs, times, penalties, scrambles, dates,
  comments and import provenance.
- Event correction also updates an untouched/default-looking session name to the
  new event label when possible; an intentionally customized name is retained.
- Clear requires **CLEAR THIS SESSION** and retains the session. Delete requires
  **DELETE THIS SESSION** and leaves at least one session in the application.
- Optional timer-footer summaries independently show completed/total attempts
  and completed time in hours. DNF is in total attempts but excluded from
  completed count/time; +2 counts as completed and adds two seconds.
  Summaries update after solves, penalty edits, delete/Undo, import and switching.

### Custom-event management

- Create and rename definitions, and edit an optional scramble placeholder.
  Stable IDs start with `custom:`. Selectors mark custom events as `(custom)`.
- Names are nonempty, limited to 40 characters, and cannot duplicate another
  custom name or a built-in event name. Placeholders are limited to 120 characters.
- Custom events participate in normal timing, inspection, sessions, statistics,
  PB tracking, Analytics, backup and sync, separately from built-in events.
- Deleting a definition is blocked while a session or solve references it.
  Reassignment provides a confirmed way to move whole sessions to another event.
- Imported csTimer identifiers generate stable definitions reused on repeat
  import. Automatic correction can use retained csTimer provenance; older
  imports without that provenance require explicit session reassignment.
- Custom-event edits and deletions are merged by stable ID during sync.

Owners: [sessions](src/lib/sessions.ts),
[session settings](src/components/SessionSettingsDialog.tsx),
[custom events](src/components/CustomEventsDialog.tsx),
[custom-event rules](src/lib/customEvents.ts).

## Solve history and actions

- Newest-first session history shows numbered rows, recorded/raw display with
  penalty indication, and comment indicators. Records retain stable ID, event,
  raw milliseconds, penalty, scramble, date, comment and available edit/import
  metadata.
- Click a row or press Enter to open its viewport-positioned action menu.
  Wider screens also show inline +2 and DNF buttons for direct penalty toggles;
  narrow screens keep those actions in the row menu so touch targets and
  metadata stay readable.
- Menu supports add/remove +2, mark/clear DNF, copy scramble, copy time, copy
  full solve text, add/edit/save/cancel a comment, and delete.
- Penalties are mutually exclusive; toggling the current penalty clears it.
  Raw time stays intact; effective time and statistics recalculate.
- Comments persist and are limited to 500 characters.
- Solve deletion offers Undo. Deletion and restoration provenance is durable
  and synchronized, so the undo is not merely a temporary UI insertion.
- Histories over 200 solves use row windowing with preserved scroll height and
  accessible position/count metadata. **Show all solves** enables full DOM rows
  for find-in-page and keyboard traversal; the control can return to windowing.
- Desktop history scrolls inside the rail. Long content and menus are bounded
  for narrow viewports. Clipboard success/failure is reported.

Owners: [solve history](src/components/SolveHistory.tsx),
[session mutations](src/hooks/useSessions.ts), [formatting](src/lib/format.ts).

## Statistics and calculation behavior

- Built-in cards: **single, mo3, ao5, ao12, ao25, ao100, ao200, ao500,
  ao1000, ao5000, ao10000**, with current/latest and best values as applicable.
- Up to five additional custom averages; integer sizes 3–10,000, excluding
  duplicate/built-in average sizes. Custom ao3 is trimmed; mo3 is untrimmed.
- Missing complete windows display unavailable results; a completed DNF window
  is distinct from missing data. DNFs cannot become single or average PBs.
- Effective single = raw time plus 2 seconds for +2; DNF has no valid time.
- Recorded-result precision truncates effective singles below ten minutes to
  hundredths and rounds singles at/above ten minutes to whole seconds.
  Aggregates use corresponding precision. Raw stored values are preserved.
- mo3 averages the most recent three attempts without trimming; any DNF makes
  the result DNF.
- Other averages sort each window conceptually, trim configured best/worst
  counts and average retained results. DNFs occupy worst slots; a DNF remaining
  after trimming makes the average DNF.
- Default trimming is 5% best and Auto worst (same 5%), rounded upward. Thus
  default ao5/ao12 remove one best and one worst; ao1000 tolerates 50 DNFs.
- Better/worse rules can be asymmetric: 0 results, 1 result, 1%, 5%, 10%, 20%,
  or median. An even median retains two middle values. Invalid combinations
  that leave no counted results are handled rather than inventing an average.
- Best averages scan eligible windows across the session; changing trimming
  recalculates averages/PBs in statistics, quick stats, charts and PB details.
- Visibility and display precision affect presentation, not stored times.
  Large rolling-average windows use a shared sliding-window implementation.

Owners: [statistics](src/lib/stats.ts), [trimming](src/lib/averageTrimming.ts),
[definitions](src/lib/statDefinitions.ts), [statistics panel](src/components/StatsPanel.tsx).

## Floating tools and Time Trend

### Shared floating panel

- Current tool button opens/closes the panel. Function selector offers **Draw
  Scramble** and **Time Trend**; Draw Scramble is the initial selected tool.
- Drag by the header and resize from the corner. Geometry is constrained to
  the timer area; saved position/size is committed at the end of the gesture.
- Open state and geometry persist on this browser. Tool selection itself is
  component state, not a synchronized preference.
- Pointer activity inside the panel is isolated from timer gestures.

### Time Trend chart

- Compact chart plots oldest-to-newest effective single results and rolling
  series; DNFs are gaps and slow outliers remain represented. Time axes are
  nonnegative. Dense paths are downsampled without replacing source results.
- Available series: single, ao5, ao12, ao25, ao50, ao100, ao200, ao500, ao1000,
  and a chart-specific custom average from 3–10,000. Default enabled series are
  single, ao5 and ao12; chart custom size starts at 10.
- PB toggle controls strict single-PB markers. Clicking or keyboard-activating
  a marker opens read-only historical PB details: recorded and raw time,
  penalty, prior PB, gain, rolling values ending there, date, scramble and notes.
  Closing returns focus to the marker; future solves do not enter that window.
- Expand opens a focus-contained responsive dialog and is disabled during timing.
  Escape/Close returns focus to Expand.
- Expanded controls include series/PB toggles, custom size, solve/date x-axis,
  zoom-axis choice (both/history/time), zoom buttons, Fit all, earlier/later
  navigation, visible-range slider and selected-range statistics.
- Range statistics include solve count, mean, best single, best ao5/ao12,
  population SD, DNF count and, for sufficiently long ranges, first-versus-last
  tenth improvement. These describe the visible range, not the whole session.
- Vertical wheel motion zooms time; horizontal wheel or Shift+wheel zooms solve
  history. Pinch zooms both axes around the pointer; drag pans. Compact Fit and
  expanded Fit all reset both axes. Horizontal navigation preserves time scale.
- Hover/focus exposes solve data and supported detail interactions. Chart
  selections, axes and viewport controls are transient component state.

Owners: [tool panel](src/components/ToolPanel.tsx),
[Time Trend](src/components/TimeTrend.tsx), [trend calculations](src/lib/timeTrend.ts),
[historical PB dialog](src/components/PBStatsDialog.tsx).

## Analytics

### Scope, navigation and persistence

- Statistics overview plus **nine analysis destinations** below it; desktop
  index selects one analysis at a time, narrow screens use Analysis dropdown.
  Tabs support arrows, Home/End and focus-following selection.
- Global filters: event (initial active event or all events), sessions
  (all/none/partial/individual), date (all time, today, 7/30/90 days, year,
  custom start/end), last matching solves (all, 5, 12, 50, 100, 500, 1000),
  penalty (all/normal/+2/DNF). Reset returns to initial-event scope. Narrow
  screens collapse the controls behind a Filters disclosure with an active-count
  badge.
- Last-N applies **after** event/session/date/penalty filtering. Reports share
  the resulting chronological solve set, using stored event IDs and dates,
  **except session comparison**, which deliberately uses each session's complete
  matching history and ignores Last solves.
- Date filters use local calendar-day boundaries; custom end dates include the
  whole selected day. Last year is the current day plus the preceding 364 days.
- Event selection resets session selection. Session menu shows counts, supports
  keyboard dismissal and all/none/indeterminate selection. Explicit none shows
  a helpful empty state and Select all sessions action.
- Customize controls visibility and analysis order, shows visible count, and
  resets layout. Overview remains above the analysis rail. Preferences and
  per-event Sub-X targets persist with global settings and sync.
- Older retired Solve explorer entries are ignored; stored width flags remain
  compatible but do not control the single-analysis layout.
- Global filters, selected analysis, histogram interval, series/x-axis choices,
  chart viewport and Sub-X splitter position are transient page state.
- View solves opens a newest-first virtualized filtered list; histogram
  drill-down narrows it to a selected interval. Filters/data/interval changes
  invalidate stale interval selections. Row/point selection opens read-only
  details with event, session, effective/raw result, penalty, date, scramble and
  notes. Empty scope disables View solves.
- Compact empty charts avoid full-height blank plots and hide stale legends.
  Empty-to-populated charts reattach resize observation.
- Desktop uses bounded internal scrolling; mobile, short viewports and increased
  interface zoom permit page scrolling. Tables and long heatmaps remain scrollable.

### Reports and controls

| Area | Implemented data and behavior |
| --- | --- |
| Statistics overview | Best single, available current ao5/ao12/ao50 with best values, total/valid/DNF counts; worst, mean, median, sample SD, recorded practice time, active days, DNF rate, improvement and available ao100/ao1000 current/best. Scope dates/session count are shown. Zero data uses a compact message. |
| Time progression | Toggle single/ao5/ao12/ao50/ao100/ao1000; solve-number/date x-axis, PB markers and point drill-down. |
| Average progression | Available ao5/ao12/ao50/ao100/ao1000 lines and current/best/size table; missing/DNF points remain gaps. |
| Historical personal bests | Cumulative single/ao5/ao12 PB chart; recent single and ao5 PB tables with date, gain and single-PB time gap. |
| Solve time distribution | Automatic or 0.25/0.5/1/2/5-second intervals; mean/median markers, sample SD, 1.5×IQR outlier count/bounds. Auto range uses central 98%, grouping extremes into drillable edge bars. Hover shows interval/count/share; click opens matching solves; clear interval restores scope. |
| Consistency | Sample SD, coefficient of variation, fastest-to-slowest spread, mean/median, latest/best rolling SD for 12/50 attempts, rolling-SD chart and solve inspection. |
| Sub-X analysis | Strictly-under-target success rate, valid-only rate, current/longest success streak, normal-approximation probability, latest-50-attempt success chart (fewer while building the first window), session count/success/rate table. DNFs count as unsuccessful attempts. Per-event target is editable to 3 decimal places, 1–3600 seconds, with built-in presets. Splitter supports drag, arrows/Shift, Home/End and reset; table headers remain sticky. |
| Session comparison | Two-or-more-session table for mean, median, best single, best ao5/ao12/ao50, SD, DNF and Sub-X rates; overlaid ao5 progression. Fewer sessions use a compact prompt. |
| Practice activity | Timed practice, active days/frequency, streaks, daily intensity heatmap over the full filtered range, weekly volume, most active days and best/hardest practice days. Empty dates stay visible; multi-year labels include years; long ranges scroll. |
| Advanced analytics | 5th/25th/50th/75th/95th percentiles, single-PB count/rate/per-month frequency, improvement, estimated target probability, moving median over the latest 25 attempt slots, fastest/slowest solve rankings and detail links. DNFs occupy moving-window slots but have no valid median value. |

- Analytics line charts provide hover/per-series values, keyboard left/right
  inspection and Enter detail activation where supported, wheel zoom, drag pan,
  accessible zoom-in/out/reset controls, legends and visible-range indicators.
- Calculations are read-only and share effective-time, precision and trimming
  helpers. Normal probability estimates are estimates, not guaranteed outcomes.
- Overview improvement compares the first/latest tenth of filtered valid data;
  Advanced improvement compares older/recent halves. Recorded practice duration
  excludes idle time and DNFs, rather than measuring total wall-clock practice.

Owners: [Analytics page](src/components/AnalyticsPage.tsx),
[charts](src/components/AnalyticsCharts.tsx), [calculations](src/lib/analytics.ts),
[saved Analytics preferences](src/lib/analyticsSettings.ts).

## Complete settings reference

### Global application settings

These are all fields in [Settings](src/types.ts), with defaults from
[storage](src/lib/storage.ts). They save automatically, are included in native
JSON backups and participate in settings sync. Session overrides below can
replace only the explicitly supported subset. Settings does not expose raw
storage keys to the user; keys here make the inventory auditable.

| Control / stored key | Default | Choices and behavior |
| --- | --- | --- |
| Inspection / `inspectionEnabled` | Off | Enable first-press inspection before timing. |
| Inspection timer / `inspectionCountDirection` | Down | Down/up; changes readout and warning wording, not elapsed limits. |
| Timer updates / `timerUpdateMode` | Live | Live animation, every 0.1 s, whole seconds; saved timing remains precise. |
| Hold duration / `holdDurationMs` | 300 ms | 0–10,000 ms, UI step 50 ms; affects readiness of a new hold. |
| Stop with any key / `stopWithAnyKey` | Off | Running-only non-modifier stop with input boundaries described above. |
| Small decimal point / `showTimerDecimalSmall` | Off | Smaller decimal portion of timer display; no timing/data change. |
| Interface zoom / `uiZoomPercent` | 100 | 70, 80, 90, 100, 110, 125, 150%; scales interface. |
| Statistics split / `statsPanelHeightPercent` | 36 | Saved desktop Statistics/Solves divider proportion, 20–80%; adjusted in the page, subject to fitting complete rows. |
| Scramble alignment / `scrambleAlignment` | Center | Left/center/right. |
| Limit scramble height / `scrambleLimitHeight` | Off | Constrain long scramble presentation. |
| Scramble action / `scrambleAction` | Copy | Nothing/copy/next on scramble activation. |
| Solve/DNF feedback / `alertChannel` | Off | Off, visual, sound, sound+visual, haptic, sound+haptic. |
| Alert volume / `alertVolume` | 70 | 50–150%, UI step 5; controls sound output. |
| 8-second warning / `inspectionWarning8s` | Off | Independent warning at 8 seconds elapsed. |
| 12-second warning / `inspectionWarning12s` | Off | Independent warning at 12 seconds elapsed. |
| Warning display / `inspectionWarningVisualScope` | Timer | Timer surface/entire screen pulse. |
| Theme / `theme` | Light | Light/dark/system; applied before first paint, system follows OS theme. |
| Accent / `accentColor` | Green | Green/blue/violet/amber across themed controls and surfaces. |
| Visible cards / `statVisibility` | Single, mo3, ao5, ao12 on | Each of the 11 built-in statistic keys independently visible; remaining seven initially off. |
| Custom averages / `customAverages` | Empty | Up to five `{id, size, visible}` entries; valid integer size 3–10,000, excluding built-in average sizes and duplicates; add/edit/show/hide/remove. |
| Statistics precision / `statPrecision` | Hundredths | Hundredths/tenths for statistic presentation, not rewriting raw results. |
| Better trim / `averageTrimBetter` | 5% | 0, 1, 1%, 5%, 10%, 20%, median. |
| Worse trim / `averageTrimWorse` | Auto | Auto matches better side; otherwise same individual choices. |
| Session solve progress / `showSessionSolveProgress` | Off | Completed/total in timer footer, including accessible count labels. |
| Session total time / `showSessionTotalTime` | Off | Completed post-penalty recorded time, formatted in hours. |
| Analytics / `analytics` | All sections visible | Ordered `sections` entries (`id`, `visible`, legacy `wide`) and `subXTargetsMs` per event; edited on Analytics. |

Settings sections are **Timer, Alerts, Display, Appearance, Statistics,
Scramble, Controls, Data, Developer options and About**. Controls provides input
help; Data shows local-data status and opens Backup & restore or Google Drive.
Developer options is collapsed initially and contains the typed-confirmation
Danger Zone. About identifies the application. They are not additional hidden
calculation or timing modes.

### Session-specific settings

Absent overrides inherit the current global value; changing a global default
does not overwrite an explicit session value. Session overrides are backed up
and synchronized with session metadata. The supported `SessionPreferences`
keys are:

- `inspectionEnabled`, `inspectionCountDirection`, `inspectionWarning8s`,
  `inspectionWarning12s`, `inspectionWarningVisualScope`.
- `scrambleAlignment`, `scrambleLimitHeight`, `scrambleAction`.
- `timerUpdateMode`, `holdDurationMs`, `stopWithAnyKey`, `showTimerDecimalSmall`.

The current Session settings UI exposes **inspection enablement** and **Use
global setting** to clear that override. The other listed override fields are
supported by the data model, effective-settings resolution, imports/backups and
sync; they are not separate editable controls in the current session gear.
The older session-level inspection field remains compatible with stored sessions.
Theme, accent, alert channel/volume, zoom, statistics display, trimming,
session-summary display and Analytics preferences remain global.

### Device-only and transient preferences

| Preference | Initial behavior | Scope |
| --- | --- | --- |
| Draw Scramble visualization | 2D net (`net`); alternative `3d` | Local `cubelab:drawScrambleMode:v1`, edited in Settings → Scramble; outside `Settings`, native backup and settings sync. |
| Floating panel visibility | Closed | Local `cubelab:toolPanelOpen:v1`. |
| Floating panel geometry | Default position/size constrained to stage | Local `cubelab:toolPanelLayout:v1`; end-of-gesture persistence. |
| Current tool | Draw Scramble | Transient app state; Function selects Time Trend. |
| Current app view/dialogs/menus | Timer; dialogs closed | Transient, not a saved preference. |
| Time Trend series/custom size/PB/axes/zoom | Single+ao5+ao12, custom 10, PB on, solve x-axis, both zoom axes, fitted viewport | Transient chart state. |
| Analytics filters/active analysis/series/interval/zoom/Sub-X split | Initial-event scope; initial visible analysis; auto histogram interval | Transient page state; saved visibility/order/targets are separate. |
| Drive connection and scheduling | Disconnected, automatic sync off | Separate local Drive/sync stores; OAuth token is memory-only. |
| Conflict review history | Empty; newest first, maximum 50 | Local-only, excluded from cloud snapshots and native backup. |

### Sub-X defaults and presets

Targets and presets below are in **seconds**. Custom events default to 20 seconds
and have free entry without built-in presets. All target edits accept 1–3600
seconds and up to three decimal places; strict `< target` defines success.

| Event | Default | Presets |
| --- | --- | --- |
| 3×3 | 20 | 10, 15, 20, 30 |
| 2×2 | 5 | 2, 3, 5, 10 |
| 4×4 | 60 | 30, 45, 60, 90 |
| 3×3 OH | 30 | 15, 20, 30, 45 |
| 5×5 | 90 | 60, 90, 120, 180 |
| 6×6 | 150 | 120, 150, 180, 240 |
| 7×7 | 210 | 150, 210, 300, 420 |
| Pyraminx | 8 | 3, 5, 8, 12 |
| Skewb | 8 | 3, 5, 8, 12 |
| Square-1 | 30 | 15, 20, 30, 45 |
| Clock | 15 | 8, 10, 15, 20 |
| Megaminx | 90 | 60, 90, 120, 180 |

## Backup, import and destructive actions

### Native JSON backup and restore

- Backup & restore exports a readable local JSON download containing sessions,
  solves, custom events, active session, session order, partial-split ownership
  records and application Settings.
  Export itself does not upload to a server.
- Native import validates application marker, version, sessions, solve fields,
  matching session/solve events, custom definitions and settings before mutation.
  Empty-session backups are valid. Native parsing sanitizes individual invalid
  session/solve entries and applies supported settings defaults/migrations;
  it does not promise strict rejection of every malformed individual row.
  Invalid markers/versions, no valid collection/settings, mixed session/solve
  events, or a malformed optional sync envelope reject the whole backup.
- Preview/confirmation explains current and incoming data; native restore
  replaces local sessions/settings only after confirmation. Cancel does nothing.
- File limit is 10 MB. Rejected input produces an inline error without mutation;
  accepted sanitized input is still subject to replacement confirmation.
  Device UI preferences and local review audit are outside the native backup
  payload. The parser accepts valid optional sync envelopes for compatibility;
  ordinary local export does not include that envelope.

### Additive csTimer import

- Automatically recognizes csTimer `.txt`/`.json`; previews every imported
  session's final name and solve count, including empty sessions.
- Appends sessions and custom definitions, preserving existing history/settings.
  This is additive import, not general deduplication or merging by solve ID.
- Orders sessions by csTimer rank with session number fallback/tie-breaker.
  Numeric names survive; case-insensitive collisions receive `(1)`, `(2)`, etc.
  Names are bounded to CubeLab's limit and preview matches final imported names.
- Converts supported scramble identifiers to built-in events. Valid metadata
  omitting `opt.scrType` uses csTimer's 333 default. Explicit unsupported types
  become stable custom events; unavailable/malformed metadata is not guessed 3×3.
- Preserves raw time, penalty, scramble, comment, original date and source
  session/solve/type provenance, including explicit/default/unavailable type.
- Malformed rows/lists, invalid durations and invalid provided dates in sessions
  with solves reject before preview. Missing solve dates use available session
  date/current-time fallback; unusable empty-session dates use import time.
- Previously imported history is not silently reclassified when mappings change.

### Destructive actions and guards

| Action | Confirmation | Result |
| --- | --- | --- |
| Delete one solve | Action menu; Undo offered | Removes that solve with durable deletion metadata; Undo revokes deletion. |
| Clear session | Type `CLEAR THIS SESSION` | Removes its solves, retains session. |
| Delete session | Type `DELETE THIS SESSION` | Removes session/solves, leaves an active session available. |
| Reset All Solve Data | Type `DELETE ALL SOLVES` | Clears solves across sessions; preserves session names/events/preferences, custom definitions and application settings. |
| Delete All Sessions | Type `DELETE ALL SESSIONS` | Removes all sessions/solves and creates empty active Session 1; retains settings/custom definitions. |
| Native import | Explicit replacement confirmation | Replaces collection/settings with validated backup. |
| csTimer import | Preview and import confirmation | Appends imported sessions/definitions. |
| Event correction/reassignment | Explicit affected-session/solve confirmation | Changes event identity only, preserving solve data. |

- Storage/sync safety and active-timing guards can disable destructive controls.
  Bulk reset/deletion records known solve/session tombstones even when sync is off.
- Resets do not delete remote Drive snapshots; their publication skips cleanup.
  Unknown solves created solely on another offline device can later be recovered,
  rather than being falsely claimed erased everywhere.

Owners: [data dialog](src/components/DataDialog.tsx), [backup](src/lib/backup.ts),
[csTimer parser](src/lib/csTimerImport.ts), [action wiring](src/App.tsx).

## Google Drive synchronization and recovery

### Connection and scheduling settings

Drive controls require a configured `VITE_GOOGLE_CLIENT_ID` deployment. Explicit
Google connection requests only `drive.appdata`; no email/profile identity scopes.
Tokens are memory-only; a connection label and runtime status are local. Timing,
local persistence and JSON backup work without Google. Disconnect also disables
automatic sync; reconnecting explicitly enables it again.

| Sync preference | Default | Available behavior/options |
| --- | --- | --- |
| Automatic sync / `enabled` | Off before connection | Enabled through explicit connection; manual Sync now remains the reconciliation action. |
| Interval / `intervalMinutes` | 5 | 1, 2, 3, 5, 10, 15, 30, 60 minutes. |
| Solve threshold / `solveThreshold` | 10 | 1, 2, 3, 5, 10, 20, 25, 50, 100 solves; combined schedule triggers at interval or threshold. |
| Startup / `syncOnStartup` | On | Attempt startup synchronization when authorized/available. |
| Exit / `syncOnExit` | On | Best-effort hidden/pagehide/freeze sync; duplicate exit events coalesced. |
| Reconnect / `syncOnReconnect` | On | Resume synchronization after connectivity returns. |
| Manual conflict review / `manualConflictReview` | Off | Off uses deterministic automatic field resolution; on queues conflicting choices before publication. Mandatory legacy recovery review is separate. |
| Automatic cleanup / `snapshotCleanupEnabled` | On | Cleanup only after successful all-snapshot merge/publication. |
| Keep per device / `snapshotKeepPerDevice` | 10 | 3, 5, 10, 20, 50 snapshots. |
| Maximum age / `snapshotMaxAgeDays` | 30 days | 7, 30, 90, 180, 365 days. |

### Merge and publication behavior

- Sync now, startup and automatic scheduling reconcile local/cloud data; there
  is no separate blind Restore from Drive or Backup now user flow.
- UI reports disabled, synced, pending, syncing, offline, auth-required, failed
  and conflict states, along with available last-sync/error information.
- Requests during holding/ready/inspection/running defer until idle. In-flight
  guards protect solves recorded while downloading; failures use bounded retries
  and then ask for manual Sync now. Automatic sync and backup share a Web Lock.
- Each publication creates an immutable device/UUID-named snapshot. A run lists
  every page, reads/validates all CubeLab snapshots, including older per-device
  and fixed-name backups, before adoption/publication.
- Stable solve/session/event IDs, tombstones and restore provenance merge data.
  Solve fields, session fields/overrides, custom definitions and global Settings
  use edit metadata with deterministic tie-breaks. Active-session selection
  retains the metadata of the chosen value rather than creating a fake local edit.
- Session ordering is a single last-writer-wins record; missing session IDs append
  deterministically. Concurrent reorder loss is not a manual-review conflict.
- Whole-session merges propagate as approved redirects. Partial splits carry
  durable source/destination solve-ownership records so stale source snapshots
  cannot duplicate or reclaim moved solves; later transfers use a deterministic
  operation/device order. Neither operation offers Undo after publication.
- Invalid/unsupported snapshots block unsafe mutation. Legacy mutable-file writes
  require conditional metadata/If-Match handling, never unconditional overwrite.
- Sync is eventual reconciliation, not a cross-file transaction or a guarantee
  against data loss. Provider listing delays and browser storage failures remain
  relevant; keep JSON backups.

### Conflict review, duplicate sessions and recovery

- Manual review pauses publication and shows both values for pending solve,
  session, settings, event/redirect and selection disagreements. Choices are Use
  this device/Use cloud; cloud-only conflicts use newest/other-cloud labels.
- Approvals match exact values and timestamps; later changes need new decisions.
  Pending correctness state is not capped; UI pages conflicts five at a time with
  Show all.
- Local review history shows newest first, at most 50 entries. Undo changes the
  stored choice only while that exact decision remains reversible. Later edits,
  already-applied redirects and already-recovered legacy data can prevent undo.
- Duplicate session names never auto-merge. Persistent Review Merge lets the user
  preview destination/source/result count and explicitly confirm the merge.
- Offline solves added to a deleted session are recovered into a labelled
  recovered session. Later arrivals deduplicate by stable ID. Known-solve deletion
  metadata distinguishes new offline solves from intentionally deleted ones.
- Ambiguous legacy deletion provenance triggers mandatory Keep deleted/Recover
  solves review against the exact candidate set; later candidates require review.
- Repair sync state clears derived bookkeeping and re-reads snapshots while
  preserving sessions, deletions, approvals, pending conflicts and review history.

### Remote snapshot management

- Remote snapshots lists device-owned files, sizes and modification dates;
  supports selective deletion and explicit remote-backup deletion.
- Cleanup targets superseded snapshots beyond the count **or** age threshold;
  always retains the newest snapshot per device and excludes legacy mutable
  files from automatic cleanup. Manual Clean up now targets this device.
- Remote-backup deletion includes legacy files, reports partial failures, and
  leaves local sessions/settings intact. Cleanup is best effort.

Owners: [Drive dialog](src/components/DriveBackupDialog.tsx),
[sync orchestration](src/hooks/useSync.ts), [backup transport hook](src/hooks/useDriveBackup.ts),
[merge](src/lib/sync.ts), [local sync preferences](src/lib/syncStorage.ts),
[retention](src/lib/snapshotRetention.ts).

## Persistence, accessibility and platform behavior

- No application backend or telemetry; records are in browser storage unless
  exported or explicitly synchronized. Browser/origin changes do not share local
  storage automatically.
- Sessions schema v6, Settings schema v10; storage key suffixes remain v1.
  Validation and migrations preserve supported older data. Legacy single-session
  migration imports its supported 3×3 records into Session 1.
- Persistence failures are surfaced; corrupt/unsafe state is not a reason to
  silently clear user history. Same-origin tabs reconcile session/settings edits,
  defer external adoption while timing, and merge newly recorded solves by ID.
  This does not provide transactional simultaneous destructive editing.
- Light/dark palettes, four accents, system-theme following and pre-paint theme
  bootstrap; interface scales without changing saved solve data.
- Custom combobox/listbox controls support arrows, Home/End, Enter, Space within
  their own menu, type-ahead, disabled options, outside press, Escape, focus
  restoration and viewport positioning within modal focus boundaries.
- Dialogs contain focus, support dismissal according to their flow and restore
  focus; buttons, icon controls, chart points, warnings and summaries have
  accessible labels/live announcements and visible focus states. Responsive
  tables, menus, internal scrolling and reduced-motion styling are implemented.
- Installable production PWA with service worker/asset caching supports local
  timing and built-in scramble generation offline after caching completes. Drive
  needs networking. Development-server behavior is not evidence of offline PWA
  operation.
- Browser-dependent sound, haptic, clipboard, 3D and installation support may
  differ. Automated checks do not establish physical-device or screen-reader
  compatibility for every combination. Large histories are optimized but no
  unlimited memory/performance guarantee is made.
- Known presentation boundaries include possible moved/resized tool-panel overlap
  and rounded session hours (a short session can display `0.00 h`). Analytics runs
  on the main thread; synchronous whole-collection persistence can still be costly
  for large histories. These are existing implementation limits, not features
  claimed solved by this inventory.
- Developer verification includes typecheck, lint, Vitest, focused Playwright and
  production/PWA build scripts; live Drive verification is a separate explicitly
  authorized harness, not an ordinary application operation.

## Implementation and test map

| Feature area | Representative regression sources |
| --- | --- |
| Timing/inspection/input | [machine tests](src/timer/machine.test.ts), [timer hook tests](src/hooks/useTimer.test.ts), [timer browser flows](e2e/timer.spec.ts), [response flows](e2e/timer-response.spec.ts) |
| Sessions/settings/summaries | [session rules](src/lib/sessions.test.ts), [Settings UI](src/components/SettingsDialog.test.tsx), [session settings UI](src/components/SessionSettingsDialog.test.tsx), [session browser flows](e2e/session-management.spec.ts) |
| Custom events/imports | [custom events](src/lib/customEvents.test.ts), [csTimer parser](src/lib/csTimerImport.test.ts), [custom-event flows](e2e/custom-events.spec.ts) |
| Statistics/trimming | [statistics](src/lib/stats.test.ts), [trimming](src/lib/averageTrimming.test.ts), [format](src/lib/format.test.ts), [browser trimming](e2e/average-trimming.spec.ts) |
| Scramble/tools/trends | [scrambles](src/lib/scramble.test.ts), [tool panel](src/components/ToolPanel.test.tsx), [Time Trend](src/components/TimeTrend.test.tsx), [trend calculations](src/lib/timeTrend.test.ts), [trend browser flows](e2e/time-trend.spec.ts) |
| Analytics | [calculations](src/lib/analytics.test.ts), [settings](src/lib/analyticsSettings.test.ts), [page](src/components/AnalyticsPage.test.tsx), [browser flows](e2e/analytics.spec.ts) |
| Persistence/backup/sync | [storage](src/lib/storage.test.ts), [backup](src/lib/backup.test.ts), [sync hook](src/hooks/useSync.test.ts), [merge stress](src/lib/sync.stress.test.ts), [cross-tab timing](e2e/cross-tab-timing.spec.ts) |
| Theme/accessibility | [theme tests](src/lib/theme.test.ts), [browser accessibility](e2e/accessibility.spec.ts) |

For ongoing maintenance, update this file when a control, default, persisted
field or user-visible behavior changes. Record test execution in STATUS rather
than treating the presence of a test file as proof of a passing run.
