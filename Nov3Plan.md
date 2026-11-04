# CubeLab — Full Analytics Page Implementation Plan

## Objective

Build a dedicated, modern, high-performance Analytics page for CubeLab (React + TypeScript + Vite). It should provide comprehensive speedcubing statistics, interactive visualizations, historical progress tracking, and comparisons.

**Important:** Reuse existing solve data, WCA statistics calculations, settings, and chart utilities wherever possible. Do not break the timer, sessions, Google Drive synchronization, or existing Time Trend tool.

## 1. Page Layout and Navigation

- Add an **Analytics** page accessible through the existing navigation.
- Keep the existing timer page and its layout unchanged.
- Create a responsive dashboard with customizable date ranges and filters.
- Support desktop, tablet, and mobile layouts.
- Match CubeLab's existing design system and themes.

## 2. Global Filters

All analytics components must respond to shared filters:

- Puzzle/event
- Session (individual, multiple, or all)
- Date range (today, 7 days, 30 days, 90 days, year, all time, custom)
- Solve count (last 5, 12, 50, 100, 500, 1,000, custom)
- Penalty status (normal, +2, DNF)
- Solve tags, if supported

Filters must update statistics and charts consistently.

## 3. Statistics Overview

Display summary cards for:

- Total solves
- Best and worst single
- Mean and median
- Current and best Ao5, Ao12, Ao50, Ao100, Ao1000
- Standard deviation
- Total practice time
- Solves per day
- DNF percentage
- Improvement percentage

Only display valid statistics. Handle insufficient solves and DNFs according to the applicable WCA rules.

## 4. Interactive Progress Charts

### Time Progression

- Plot individual solve times against solve number or date.
- Overlay configurable rolling averages (Ao5, Ao12, Ao50, Ao100, Ao1000).
- Toggle individual series.
- Highlight personal bests.
- Zoom, pan, and reset the chart.
- Hover for exact values, timestamps, penalties, and session information.
- Support viewing selected periods or the entire solve history.

### Average Progression

- Dedicated graph for rolling averages.
- Compare multiple average sizes.
- Highlight best averages and improvement trends.

### Historical Personal Bests

- Show PB single and average progression over time.
- Display when each PB was achieved.
- Show the time between PB improvements.

## 5. Solve Time Distribution

Create an interactive histogram showing:

- Distribution of solve times
- Configurable time intervals
- Mean and median markers
- Standard deviation
- Percentage of solves within each interval
- Outlier identification

Allow clicking a distribution interval to inspect matching solves.

## 6. Consistency Analytics

Include:

- Standard deviation over time
- Rolling standard deviation
- Coefficient of variation
- Best/worst time spread
- Median versus mean
- Consistency trend chart

Clearly distinguish faster solving from more consistent solving.

## 7. Sub-X Analysis

Allow users to select custom targets such as sub-10, sub-15, sub-20, and sub-30.

Display:

- Percentage and count of solves below the target
- Sub-X percentage over time
- Current and longest consecutive sub-X streak
- Progress toward the target
- Target success rate by session

Targets must be configurable for different puzzles.

## 8. Session Comparisons

Allow comparisons between two or more sessions.

Compare:

- Mean and median
- Best single
- Best averages
- Standard deviation
- DNF rate
- Solve count
- Sub-X percentage
- Historical progression

Provide side-by-side statistics and overlaid charts. Clearly distinguish sessions with different sample sizes.

## 9. Practice Activity

Include:

- Daily/weekly/monthly solve counts
- Calendar activity heatmap
- Total practice time
- Practice frequency
- Practice streaks
- Most active days
- Solve volume trends

Use recorded timestamps. Do not invent missing practice-duration data.

## 10. Advanced Analytics

Add:

- Personal best frequency
- Improvement rate over different periods
- Fastest and slowest percentiles
- Moving median
- Performance comparison between recent and historical solves
- Best and worst practice days
- Solve rankings
- Estimated likelihood of achieving a chosen target, using clearly labeled statistical estimates

Avoid presenting estimates as guaranteed predictions.

## 11. Drill-Down and Interactions

- Clicking a chart point opens the corresponding solve details.
- Allow viewing the scramble, penalty, comment, session, and timestamp.
- Support filtering solve history directly from charts.
- Provide tooltips explaining statistical measurements.
- Allow resetting filters.
- Synchronize filters across dashboard components.

## 12. Customization

- Show/hide individual statistics and charts.
- Reorder dashboard sections.
- Resize supported charts.
- Save user dashboard preferences.
- Respect existing theme settings.
- Persist preferences using CubeLab's established settings infrastructure and synchronization rules.

## 13. Performance Requirements

The page must remain responsive with **100,000+ solves**.

- Memoize expensive calculations.
- Avoid recomputing statistics during unrelated renders.
- Use efficient rolling-average algorithms.
- Use chart downsampling or aggregation for large datasets without changing underlying statistical results.
- Virtualize large solve lists.
- Consider Web Workers for expensive processing.
- Lazy-load Analytics components.
- Prevent unnecessary chart remounts.
- Avoid blocking the main thread.
- Preserve full precision in calculations.

## 14. Data Integrity and Compatibility

- Use the existing solve and session schemas.
- Respect WCA +2 and DNF calculations.
- Never modify stored solves simply to generate analytics.
- Handle deleted sessions, invalid timestamps, missing scrambles, and incomplete records.
- Keep analytics read-only except for explicitly supported solve-editing interactions.
- Do not introduce changes that compromise Google Drive synchronization.
- Avoid duplicating existing statistics logic.
- Ensure charts update correctly following imports, edits, deletions, and cloud merges.

## 15. Testing

Add Vitest and Playwright coverage for:

- WCA averages and penalties
- Rolling statistics
- Global filtering
- Cross-session comparisons
- Empty and incomplete datasets
- DNF-heavy datasets
- Imported solve histories
- Analytics updates after data changes
- Responsive layouts
- Chart interactions
- Large datasets (1,000, 10,000, and 100,000+ solves)
- Performance and memory usage

## 16. Recommended Implementation Order

1. Inspect the existing architecture, data schemas, and statistics utilities.
2. Implement Analytics routing, page layout, and global filters.
3. Build reusable analytics calculation functions.
4. Implement overview statistics.
5. Implement progress and rolling-average charts.
6. Add distributions and consistency analytics.
7. Implement Sub-X tracking and PB history.
8. Add session comparisons and activity tracking.
9. Implement advanced analytics.
10. Add dashboard customization and persistence.
11. Optimize large-dataset performance.
12. Complete automated tests and UI verification.

## Acceptance Criteria

- All charts and statistics calculate correctly.
- Global filters consistently affect relevant components.
- WCA penalties and DNFs are handled correctly.
- Charts are interactive and responsive.
- Large solve histories remain usable.
- Analytics never causes timer lag.
- Existing features continue working.
- Dashboard settings persist correctly.
- No data loss, duplicate solves, or synchronization regressions.
- The implementation follows CubeLab's existing architecture and visual design.

## Agent Instructions

Before implementation, inspect the repository and identify reusable components, utilities, and existing functionality. Do not assume features are missing without checking.

Implement incrementally, prioritizing correctness, maintainability, performance, and compatibility. Avoid unnecessary dependencies and duplicate logic.

Use the existing test infrastructure to verify changes. Test the interface with Playwright at multiple viewport sizes, including large solve datasets.

Do not consider implementation complete until all required functionality is implemented, tested, and verified. Report completed features, outstanding limitations, and test results accurately.

