# CubeLab Training redesign delivery

> **Historical delivery record (2026-11-11).** The E15 redesign is implemented
> and committed in the current baseline. “Working tree” below describes the
> delivery-time checkout, not the current git state. Current Training status is
> in [CURRENT_STATUS.md](../CURRENT_STATUS.md).

## A. Implementation summary

The five approved stages are implemented. Training now shares Timer's sidebar
presentation, uses one Setup action, keeps the clock anchored, supports the
execution preview preference, and docks Last Result when the timing surface
needs the room. The four histories, checked local storage and seven-sample
calibration protocol remain in use.

## B. Visual parity

At 1440×900, both sidebars measure 296 px. Training's first Statistics row grew
from 40.34 px to 51.59 px at the default split. Timer's is 53.84 px. With both
Statistics panels set to 267 px, both rows measure 53.84 px. Both headings
measure 20.59 px and ordinary Attempts and Solves rows measure 46.94 px.
Training's case controls leave its default Statistics panel 9 px shorter than
Timer's. The compact controls follow the approved mockup's larger top panel.

The desktop Training clock stayed at (872, 501.5) CSS px across idle, both sets
and modes, preview changes, and calibration review. The shared surface, notation
and typography come from CubeLab's Timer. At narrow widths, the clock comes
before the docked result and the sidebar. [Comparisons](index.html) ·
[Computed measurements](measurements.json)

## C. Code architecture

Training uses StatisticsPanel and StatColumns, HistoryPanel and HistoryRow,
SidebarSplit, TimerStage, the Scramble styles and ToolPanel. TrainingActions
provides the heading options and practice help. TrainingPreparation controls
the setup view, CalibrationReview controls sample actions, and
TrainingSaveRecovery exposes recovery in the active surface. TrainingController
owns checked writes and preparation. The existing timer supplies the captured
duration.

## D. UI-Debloat

The case count opens Edit cases. Statistics options group customization,
breakdowns and the recognition timing series in the heading. Training options
group settings, presets and Practice History. Practice help holds the stop
rules and timing instructions. Eligibility and recovery text appears when
action is needed. Last Result shows the recorded case, time and algorithm
summary, with revisions and full attribution in Attempt Details.

## E. Training workflow

**Begin practice** activates the selection. **Next setup** advances within the
current visit. **Retry setup** repeats a failed preparation. **Resume practice**
opens a new visit after inactivity. Changing set or mode takes effect
immediately. Calibration shows the untimed setup, timed precursor and sample
count. Sample review provides Keep, Retry and Cancel in the timer area.

## F. Case preview

**Show upcoming case** is on by default and applies to both execution modes.
Turning it off removes the case name, diagram and divider. The same browser
preference survives refresh and preserves its previous value if storage rejects
a write. Recognition never mounts an upcoming target name, image or related
attributes in active preparation. Last Result still shows the previous attempt.

## G. Audited defects

| Defect | Cause and correction | Regression |
| --- | --- | --- |
| Category mismatch after save retry | Category preferences and visit changes were saved separately. One checked candidate now carries both and retains the activation intent. | Failing memory store |
| Spinner stuck after a superseding selection | Generation invalidation kept the old busy flag. The new state clears setup and generation together. | Deferred OLL generation superseded by ineligible PLL |
| Ready setup after inactivity | Expiry cleared setup without invalidating its asynchronous job. Expiry invalidates generation and readiness requires an active visit. | Controlled clock and deferred generation |
| Calibration and failed saves announced as recorded attempts | Timer completion now reports sample review, saved attempt or unsaved attempt based on the controller outcome. | Controller outcomes and seven-sample workflow |
| Failed correction appeared saved | The dialog used the pending candidate as the saved record. It now shows the last saved outcome with Retry and Download recovery copy in the dialog. | Browser storage rejection during correction |
| History floor lost the divider footprint | The splitter reserves the measured grip and margins separately from the 120 px history minimum. | Shared maximum-height and keyboard bounds |
| Clock moved with preparation content | A stable notation track and separate review region keep the surface anchored. | Frame sampling through four categories and preview toggle |
| Last Result covered long times at increased zoom | Docking now considers effective width and height. The docked card uses its own space below the surface. | 125% and 150% interface zoom, plus actual browser zoom |
| Docking changed desktop placement and pointer cancel persisted it | The floating frame projects preferred bounds without overwriting them. Only a completed gesture saves a position. | Drag, cancel, resize, reload and dock/undock |
| Retry switched categories and generated a random interim setup | The action names a different destination and sends the requested case through one preparation. | Generator call order |
| Report notice opened the route without Practice History | The notice carries the dialog intent. Attempt Details restores focus to its surviving opener in the report. | Report navigation, Escape, correction and deletion |
| Mobile algorithm editor opened out of view | The editor opens before the case grid and focuses its heading. Back to cases restores focus. | Mobile keyboard capture |
| Clock 2D availability depended on scramble generation | The event registry already knows that Clock has no 2D net. The shared tool displays that state while the scramble loads. | Component and Chromium Draw Scramble regression |

The detailed Statistics scroller already had a labelled keyboard focus target.
Practice History now uses the same pattern for wide report tables.

## H. Verification

The exact commands and results are recorded in the
[dated verification](../../../STATUS.md#approved-training-workspace-redesign--2026-11-11).
Coverage includes type checking, lint, production build, isolated browser
workflows, accessibility, checked recovery, offline startup and the 200/201
history boundary. All 78 approved SVGs match their pre-redesign SHA-256 hashes.

## I. Performance

Production Chromium at 1440×900 used synthetic 250- and 8,000-attempt
histories. Each condition used two warm-up cycles and seven measured cycles.
Times are milliseconds, shown as median (range).

| Attempts | Statistics | Stop to first frame | Checked save | Set switch to ready | Divider to frame |
| ---: | --- | ---: | ---: | ---: | ---: |
| 250 | Default | 29.9 (22.2–37) | 9.2 (8–11.3) | 61 (42.5–67.2) | 5.6 (3.7–9.6) |
| 250 | Expanded | 34.9 (26.4–49.5) | 9.8 (8.3–16.5) | 53.5 (44.5–73.5) | 4.3 (3.3–9.8) |
| 8,000 | Default | 366.5 (356.5–416.6) | 222.8 (214.1–257) | 496.2 (466.7–567.3) | 11.9 (4.6–14.9) |
| 8,000 | Expanded | 471.1 (461.7–484) | 230.7 (218.9–250.3) | 567 (556.4–686.3) | 4.2 (3.7–12) |

The profile used a memory-backed Training storage key because the larger
fixture serialized to about 8.1 MB. The checked reads, validation, comparison
and serialization ran in the production application. Each stop added one
attempt, with the stored time matching the observed input interval within
0.1 ms. Statistics, history and the readout agreed on the first
observed stopped frame. The visual baseline preceded the redesign. A paired
pre-redesign production performance trace is unavailable.
[Profile data](performance.json)

## J. Documentation

Updated the [README](../../../README.md), [verification status](../../../STATUS.md),
[known limitations](../../../KNOWN_LIMITATIONS.md), [Training status](../CURRENT_STATUS.md)
and [project memory](../PROJECT_MEMORY.md). The approved audit and concepts
remain available as the original references.

## K. Remaining limitations

Physical touch hardware, screen readers, live Drive and full cross-browser
suites were outside this pass. The benchmark has no paired pre-redesign
production trace. Users can deliberately position a floating desktop panel over
the digits. Long-history validation and save cost remain visible in the profile.

## L. Working tree at delivery time

At delivery time, the changes were local to Training presentation, its
controller and tests, the shared workspace components, and the delivery
evidence. Existing onboarding and other working changes were preserved. No
commit, push, deployment or publication was made at that checkpoint; the work is
committed in the current baseline.
