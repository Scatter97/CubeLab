# CubeLab code and behavior audit

**Date:** November 7, 2026 (America/Toronto)\
**Reviewed checkout:** `/home/joshua/cube-lab`, branch `master`\
**Commit:** `28f38d76fa052010d9f13d1a44495ab90026fac3`\
**Repository:** [Scatter97/CubeLab](https://github.com/Scatter97/CubeLab)

## Assessment

CubeLab has substantial regression coverage and sensible separation between timer transitions, domain calculations, React orchestration, and persistence. Its existing unit suite passes. Nevertheless, this audit found **eight distinct confirmed defects**, including two paths that lose deletion intent and permit old solves to return, several Analytics calculation errors, a manual-restore selection error, and a reproducible keyboard-focus regression.

The highest priority is preserving durable sync metadata through additive imports and individual deletion failures. Correct Analytics calculations next. Broader features should follow those repairs and a recovery-focused regression gate.

“Confirmed” below means observed through a deterministic executable fixture or an existing browser test. It does **not** mean observed in a real user's history or a live Google Drive account. Hypotheses have separate confidence labels. No confirmed loss of real history, remote compromise, or timer-duration corruption was established.

## Scope and method

The original request was to inspect GitHub's current default branch. At the start, the repository was cloned and its default branch established as `master`. At your request, that downloaded clone was deleted. The remainder used the existing local checkout above, which had the same commit and no tracked changes. No subsequent fetch/pull changed that checkout.

Review concentrated on the input-to-record path, session mutations and transfers, backup/import/recovery, sync orchestration and field provenance, storage validation, statistics/Analytics, chart consumers, modal lifecycle, build/PWA configuration, and the corresponding tests. Recent history and blame were used to distinguish new regressions from older defects. This is a targeted in-depth audit, not a proof that every module or browser state is correct.

The repository's architecture, sync-safety, timer-testing and chart-performance guides were followed. All tests used synthetic fixtures, isolated browser contexts or memory transports. No live Drive validation was run. Application source, dependency declarations, and repository documents were not edited; nothing was committed or pushed.

## Verification results

Environment: Node **22.23.2**; Vitest **5.0.5**; Playwright Chromium project; one browser worker. Synthetic calendar probes explicitly used `TZ=America/Toronto`.

| Check | Result and scope |
|---|---|
| `npm run typecheck` | Passed in the local checkout |
| `npm run lint` | Passed with one existing `react(purity)` warning at `src/components/SessionPanel.tsx:566`, concerning `Date.now()` during render |
| `npm test -- --maxWorkers=2` | **823 passed, 58 files** in the local checkout |
| Seven selected Chromium spec files | **55 passed**: accessibility, Analytics, cross-tab timing, session management, statistics, timer response, timer stability |
| Seven selected recovery/offline cases from `timer.spec.ts` | **6 passed, 1 failed**; failure was dialog focus restoration before the native backup round trip |
| Isolated rerun of that failed case | Failed again at the same focus assertion |
| New audit regression fixtures | **8 expected-correct assertions failed**, demonstrating seven domain/hook defects; A1/A2 share one root cause |
| Normal `npm run build` | Passed, including PWA generation; normal non-mock output restored. Build reports a large-chunk advisory; see `build.log` |
| `git diff --check` / tracked working changes | Clean at final verification |

The selected existing browser cases total **62 unique cases: 61 passed and 1 failed**. The repeated focus failure is a confirmation run, not a second unique defect. Offline Chromium operation passed. Mock Drive backup/restore, manual conflict review, active-session review, and both selected csTimer import cases passed. The native backup browser test stopped before export/import assertions, so that complete round trip is **not** reported as verified.

The new audit tests are deliberately red on the audited commit. They assert the correct behavior rather than asserting the buggy outputs. See `audit-regressions.test.ts`, `audit.config.mts`, and `audit-regressions.log` in the evidence directory listed below. They remain outside the source checkout.

### Exact browser commands

```bash
npm run test:e2e -- e2e/analytics.spec.ts e2e/session-management.spec.ts e2e/timer-response.spec.ts e2e/cross-tab-timing.spec.ts e2e/statistics.spec.ts e2e/timer-stability.spec.ts e2e/accessibility.spec.ts --project=chromium --workers=1

npm run test:e2e -- e2e/timer.spec.ts --project=chromium --workers=1 --grep 'backup export and import|csTimer|completely offline|google drive backup and restore|manual conflict review|active-session Drive review'

npm run test:e2e -- e2e/timer.spec.ts --project=chromium --workers=1 --grep 'backup export and import restore'
```

Run the added probes from this chat's workspace, using Node 22.23.2 and the existing local dependencies:

```bash
TZ=America/Toronto /home/joshua/cube-lab/node_modules/.bin/vitest run --config outputs/audit.config.mts --maxWorkers=1
```

The supplied harness contains absolute paths to this machine. Adjust those paths if moving it elsewhere. Its storage clearing and injected failures affect its isolated jsdom environment, not browser history.

## Confirmed findings

Priority definitions: **P1** = repair before expanding data workflows; **P2** = normal correctness/accessibility repair. No P0 incident was established.

### B1 — P1: Additive csTimer import discards unpublished deletion intent

**Evidence:** [App.tsx:1172–1174](https://github.com/Scatter97/CubeLab/blob/28f38d76fa052010d9f13d1a44495ab90026fac3/src/App.tsx#L1172-L1174) calls `sync.resetBase(merged)` even for an additive import. [useSync.ts:599–628](https://github.com/Scatter97/CubeLab/blob/28f38d76fa052010d9f13d1a44495ab90026fac3/src/hooks/useSync.ts#L599-L628) clears tombstones, conflicts and session redirects. Fixture **A6** reproduces the resulting resurrection through the real hook and merge function.

**Reproduction:**

1. Have a solve already present in an older cloud/device snapshot.
2. Delete it locally while offline or with sync disabled; do not publish that deletion yet.
3. Add a valid csTimer import.
4. Merge the older snapshot after reconnecting.

**Expected:** Existing history stays deleted while the imported sessions are added.\
**Observed:** The deletion record is erased; merging the stale snapshot returns the deleted solve. In A6 the returned solve ID is `s0`.

This condition matters: a tombstone already present in another remote snapshot may protect the deletion. The fixture specifically exercises an **unpublished** deletion, where local metadata is the only copy.

**Repair:** Give additive import its own sync update path. Preserve existing tombstones, redirects, approvals, field metadata and unrelated review state; mark the expanded collection pending without resetting its history. Avoid restamping all global settings for an operation documented as retaining settings.

**Acceptance:** An offline deletion followed by additive import, reload and stale-device sync must not resurrect the solve. Add corresponding coverage for pending redirects and approvals. The metadata clearing is confirmed; those additional consequences were not independently reproduced here.

### B2 — P1: Individual solve deletion reports success even when its durable deletion record cannot be written

**Evidence:** [App.tsx:627–638](https://github.com/Scatter97/CubeLab/blob/28f38d76fa052010d9f13d1a44495ab90026fac3/src/App.tsx#L627-L638) removes the solve before recording deletion. [useSync.ts:263–267](https://github.com/Scatter97/CubeLab/blob/28f38d76fa052010d9f13d1a44495ab90026fac3/src/hooks/useSync.ts#L263-L267) ignores the result of `saveSyncStorage`; [recordDeletion:413–444](https://github.com/Scatter97/CubeLab/blob/28f38d76fa052010d9f13d1a44495ab90026fac3/src/hooks/useSync.ts#L413-L444) returns no success result. Fixture **A7** exercises `useSessions`, `useSync`, real session persistence and a selective storage-write failure.

**Reproduction:**

1. Keep a stale copy of a solve on another device/snapshot.
2. Make writes to `cubelab:sync:v1` fail while session writes still succeed.
3. Delete the solve.
4. Reload and reconcile the stale snapshot using persisted metadata.

**Expected:** Block/roll back the deletion or retain a durable intent and clearly surface failure.\
**Observed:** The session collection saves without the solve and `storageOk` remains true, but no tombstone survives on disk. Reload-based reconciliation returns the deleted solve.

The failure was injected; its incidence on physical devices is unmeasured. Quota, policy, or partial storage failures are the relevant class, not normal successful writes.

**Repair:** Make single deletion use the same durable-intent-first discipline as the protected bulk/session operations. Return persistence success and gate the mutation/toast on it. Surface sync-metadata storage health separately from successful session/settings writes. Keep Undo provenance durable too.

**Acceptance:** Fail just the sync-key write, just the session write, and both writes. Verify the collection and deletion journal agree after reload; no false success and no resurrection.

### B3 — P2: Analytics “best average” uses the latest window and contaminates earlier history with future results

**Evidence:** [analytics.ts:231–239](https://github.com/Scatter97/CubeLab/blob/28f38d76fa052010d9f13d1a44495ab90026fac3/src/lib/analytics.ts#L231-L239) receives newest-first windows and accumulates the running minimum while writing backward into chronological indexes. [analytics.ts:349–356](https://github.com/Scatter97/CubeLab/blob/28f38d76fa052010d9f13d1a44495ab90026fac3/src/lib/analytics.ts#L349-L356) uses the last element as the all-history best. Fixtures **A1/A2** reproduce both directions of the same defect.

**Reproduction:** Feed chronological singles `[10,10,10,10,10,20,20,20,20,20]` seconds with default trimming and ao5 enabled.

**Expected:** Current ao5 = 20.00; best ao5 = 10.00.\
**Observed:** Analytics best ao5 = **20.00**.

Reverse the blocks: the running-best entry at the first complete 20-second window already contains **10.00**, although the fast block occurs later.

**Impact:** Analytics overview and average-comparison consumers can disagree with the timer's separately calculated session best. A latest DNF window can also hide an earlier valid best. Do not assume the PB-progression chart has the same failure: it uses its own forward `buildPBHistory` calculation.

**Repair:** Populate chronological average values first, then scan forward for prefix minima, carrying earlier valid bests through DNF windows. Alternatively traverse the rolling results in reverse when constructing the prefix series.

**Acceptance:** Worsening history, improving history, trailing DNFs, equal averages and custom trimming must match a direct chronological oracle.

### B4 — P2: Advanced moving median takes the middle chronological value instead of the median

**Evidence:** [analytics.ts:1191–1198](https://github.com/Scatter97/CubeLab/blob/28f38d76fa052010d9f13d1a44495ab90026fac3/src/lib/analytics.ts#L1191-L1198) passes filtered but unsorted attempts into [medianSorted:286–292](https://github.com/Scatter97/CubeLab/blob/28f38d76fa052010d9f13d1a44495ab90026fac3/src/lib/analytics.ts#L286-L292). Fixture **A3** reproduces it.

**Reproduction:** Calculate a three-attempt moving median for chronological results `[10,30,20]` seconds.

**Expected:** 20.00.\
**Observed:** **30.00**.

The default window is 25; the three-attempt parameter simply makes the mistake minimal. Nonmonotonic values also affect the default window. DNF slot handling was recently improved, but filtering DNFs still does not sort the remaining results.

**Repair:** Sort a detached valid-value window numerically before calling the helper, or maintain an ordered rolling structure if profiling justifies it. Keep attempt slots occupied by DNFs.

**Acceptance:** Unsorted odd/even windows, duplicates, DNFs, all-DNF windows and the default 25-attempt window.

### B5 — P2: Rolling date presets include an extra calendar day across spring daylight saving

**Evidence:** [analytics.ts:90–97](https://github.com/Scatter97/CubeLab/blob/28f38d76fa052010d9f13d1a44495ab90026fac3/src/lib/analytics.ts#L90-L97) subtracts fixed 24-hour periods from local midnight. Fixture **A4** runs in `America/Toronto`.

**Reproduction:** Set “now” to March 10, 2026 at local noon and select the last seven days.

**Expected:** Start March 4 at 00:00, seven local dates including today.\
**Observed:** Start **March 3 at 00:00**, eight local dates.

The spring offset change makes the arithmetic land at 23:00 on the preceding date before `startOfLocalDay` rounds backward again. The same arithmetic appears in the 30-, 90- and 365-day presets; those were not separately asserted in this audit.

**Repair:** Subtract calendar dates using a local date constructor or `setDate`, preserving intended local-calendar semantics.

**Acceptance:** Spring/fall transitions, UTC and a non-DST zone, month/year boundaries, plus custom inclusive bounds.

### B6 — P2: Equal timestamps reverse within-session chronology and can select the wrong “latest N” solves

**Evidence:** [analytics.ts:125–149](https://github.com/Scatter97/CubeLab/blob/28f38d76fa052010d9f13d1a44495ab90026fac3/src/lib/analytics.ts#L125-L149) iterates newest-first session arrays, then uses that same iteration order to break equal timestamps in an ascending chronological sort. The importer explicitly stores reversed rows at [csTimerImport.ts:396–397](https://github.com/Scatter97/CubeLab/blob/28f38d76fa052010d9f13d1a44495ab90026fac3/src/lib/csTimerImport.ts#L396-L397). Fixture **A5** reproduces the order mismatch.

**Reproduction:** Store three attempts, originally chronological `[10,20,30]` seconds, with identical timestamps. Their persisted newest-first array is `[30,20,10]`. This can occur when csTimer rows lack individual dates and share the session-date fallback.

**Expected:** Analytics preserves the original within-session chronology, `[10,20,30]`; latest-count selection picks the newest attempts.\
**Observed:** Analytics emits `[30,20,10]`. A last-two slice therefore picks the older portion of that tied group.

**Impact:** PB sequence, trends, streaks, moving windows and latest-count filters can change. Cross-session ordering at identical timestamps is inherently ambiguous; the actionable defect is losing chronology already available **within** one session.

**Repair:** Reverse within-session tie order when assembling chronological data, and define a deterministic cross-session fallback separately. Longer term, preserve an explicit ordering key/import index through every relevant merge path.

**Acceptance:** Same-timestamp imported runs with missing dates; first/last-N filters; consistency with Time Trend and stored history order.

### B7 — P2: Manual Drive restore ignores active-session selection timestamps

**Evidence:** [remoteBackups.ts:97–104](https://github.com/Scatter97/CubeLab/blob/28f38d76fa052010d9f13d1a44495ab90026fac3/src/lib/remoteBackups.ts#L97-L104) and [120–128](https://github.com/Scatter97/CubeLab/blob/28f38d76fa052010d9f13d1a44495ab90026fac3/src/lib/remoteBackups.ts#L120-L128) call `mergeSessionsData` without selection metadata from either envelope. [sync.ts:354–360](https://github.com/Scatter97/CubeLab/blob/28f38d76fa052010d9f13d1a44495ab90026fac3/src/lib/sync.ts#L354-L360) then follows the legacy local-first selection fallback. Fixture **A8** reproduces the actual restore merger.

**Reproduction:** Supply two valid snapshots containing sessions A and B. The older snapshot selects A with timestamp T; the newer selects B with timestamp T+1000. Merge them in the normal oldest-to-newest restore order.

**Expected:** Restore B under the newer selection provenance.\
**Observed:** Restores **A**.

This is selection inconsistency, not lost solve records. The selected ordinary active-session review browser case passes because automatic sync has a different metadata-aware path.

**Repair:** Carry the accumulator's chosen selection metadata through each manual-restore merge and pass each remote envelope's metadata. Separately review [useDriveBackup.ts:149–156](https://github.com/Scatter97/CubeLab/blob/28f38d76fa052010d9f13d1a44495ab90026fac3/src/hooks/useDriveBackup.ts#L149-L156): manual backup creation also omits the optional active-session metadata argument. That omission was inspected but not independently hook-tested here.

**Acceptance:** Multiple snapshots with opposing selection timestamps; equal timestamps; a deleted chosen session; legacy snapshots; parity between automatic sync and manual restore.

### B8 — P2: Closing the lazy Backup dialog loses keyboard focus

**Evidence:** [App.tsx:2156–2169](https://github.com/Scatter97/CubeLab/blob/28f38d76fa052010d9f13d1a44495ab90026fac3/src/App.tsx#L2156-L2169) conditionally mounts the dialog and unmounts it on close. [useModalDialog.ts:10–22](https://github.com/Scatter97/CubeLab/blob/28f38d76fa052010d9f13d1a44495ab90026fac3/src/hooks/useModalDialog.ts#L10-L22) relies on a later `open=false` effect calling native `dialog.close()` and has no unmount restoration. Existing [timer.spec.ts:1699–1701](https://github.com/Scatter97/CubeLab/blob/28f38d76fa052010d9f13d1a44495ab90026fac3/e2e/timer.spec.ts#L1699-L1701) fails twice.

**Reproduction:** Open Settings → Backup, choose an invalid JSON file, then close the Backup dialog.

**Expected:** Focus returns to the visible Settings header button, as required by the existing test.\
**Observed:** The dialog disappears but the header button is not focused. The five-second focus assertion times out in both the original run and isolated rerun.

The likely regression boundary is commit `a167d16`'s lazy dialog mounting. This attribution is supported by blame, not a historical bisect. Other conditionally mounted dialogs may share the lifecycle problem; they were not individually confirmed.

**Repair:** Explicitly preserve a valid return target and restore it when a dialog unmounts, accounting for handoffs between Settings, Backup and confirmation dialogs. A removed Settings-internal button is not a useful return target.

**Acceptance:** Close, Escape, failed-file close, export close, cancel-import and completed-import paths, with keyboard-only navigation. Finish the native backup round trip once this early failure is resolved.

## Potential defects requiring targeted verification

Confidence estimates refer to confidence in the code-based concern, not the probability a typical user encounters it.

| Concern | Confidence / priority | Evidence, impact and next experiment |
|---|---|---|
| Relative-date filters and current activity streak become stale while Analytics remains open across midnight | High, 90%; P2 | [AnalyticsPage.tsx:1718–1721](https://github.com/Scatter97/CubeLab/blob/28f38d76fa052010d9f13d1a44495ab90026fac3/src/components/AnalyticsPage.tsx#L1718-L1721) memoizes filtering on sessions/filters, without a clock dependency. Activity also memoizes a time-dependent calculation. Freeze time before midnight, advance past it without changing data, and inspect Today/7d/current streak. Add local-day rollover/visibility refresh if confirmed. |
| Hold-to-arm depends on a render tick arriving before release | High, 85%; P2/P3 | [machine.ts:149–159](https://github.com/Scatter97/CubeLab/blob/28f38d76fa052010d9f13d1a44495ab90026fac3/src/timer/machine.ts#L149-L159) cancels a release from `holding` without testing elapsed hold duration; readiness is only promoted by a tick. Under dropped frames, or a zero-duration rapid tap, a sufficiently long physical hold may not start. Simulate missing rAF callbacks and decide whether readiness is intentionally visual-gated before changing it. No physical latency claim is made. |
| Export/upload can produce a backup that readers reject as over 10 MB | High, 90%; P2 | [backup.ts:136–137](https://github.com/Scatter97/CubeLab/blob/28f38d76fa052010d9f13d1a44495ab90026fac3/src/lib/backup.ts#L136-L137) serializes without a size check; [DataDialog.tsx:103–106](https://github.com/Scatter97/CubeLab/blob/28f38d76fa052010d9f13d1a44495ab90026fac3/src/components/DataDialog.tsx#L103-L106) and [remoteBackups.ts:53–65](https://github.com/Scatter97/CubeLab/blob/28f38d76fa052010d9f13d1a44495ab90026fac3/src/lib/remoteBackups.ts#L53-L65) reject large inputs. Large metadata/comments plus pretty export expansion warrant round-trip tests at the boundary. No oversized real collection or live upload was exercised. Keep the cap unless an explicit redesign is approved; add preflight and a usable recovery strategy. |
| Huge date spans consume memory proportional to elapsed days rather than solve count | High, 95%; P2 | [analytics.ts:1051–1070](https://github.com/Scatter97/CubeLab/blob/28f38d76fa052010d9f13d1a44495ab90026fac3/src/lib/analytics.ts#L1051-L1070) materializes every day between first and last solve. csTimer accepts dates through JavaScript's representable limit. Two syntactically valid extreme dates can imply millions of empty days. Validate with bounded date-span fixtures and profiling; use sparse/virtualized heatmap ranges. An intentionally enormous allocation was not run. |
| Native import/Drive restore can announce success before session/settings persistence succeeds | High, 85%; P2 | [App.tsx:1180–1184](https://github.com/Scatter97/CubeLab/blob/28f38d76fa052010d9f13d1a44495ab90026fac3/src/App.tsx#L1180-L1184) and [1099–1110](https://github.com/Scatter97/CubeLab/blob/28f38d76fa052010d9f13d1a44495ab90026fac3/src/App.tsx#L1099-L1110) replace in-memory data and show success; saving occurs in hook effects. Inject a late quota failure and test reload/rollback/notification behavior. Existing bulk-session write-before-publish protection should guide the design, but this exact user flow was not reproduced. |

These are not added to the confirmed count. Fixing them should begin with an owning regression, particularly where semantics such as visual readiness need a product decision.

## Current limitations and validation gaps

These are boundaries of the implementation or evidence, not newly discovered bugs:

- **Durability and scale:** Session saves serialize and synchronously write the full collection. Hashing, statistics and Analytics can still block the main thread. Passing the 100,000-solve calculation fixture does not establish a practical browser memory/performance ceiling. Current audit checks establish correctness on their fixtures, not physical input/display latency.
- **Sync:** Immutable device snapshots prevent direct overwrites; they do not provide a transaction across devices or immediate convergence. Wall-clock metadata, review disagreements and 32-bit fingerprints retain documented limits. Web Locks coordinate one origin, not independent devices. The B1/B2 defects exceed those intended boundaries because local deletion intent is actually lost.
- **Recovery:** Native JSON replaces local collections after confirmation; csTimer adds sessions. There is no general arbitrary-file merge by stable solve ID. Merge/split operations have no Undo. Snapshot cleanup is best effort. Native parsing deliberately tolerates some corrupt rows; users do not receive a comprehensive row-by-row recovery report.
- **Data model:** Custom events have placeholder scrambles and no generated visualization. Sessions are single-event. Analytics is read-only and has no solve tags. Session ordering is last-writer-wins rather than review-gated.
- **Layout:** Floating tools can deliberately cover the timer digits. Position stability checks do not prove absence of occlusion. Font scaling, narrow screens and intrinsic statistics height still require careful visual/physical validation.
- **Platform evidence:** This audit did not run Firefox/WebKit, actual Zen, physical touch/trackpad, screen readers, or production OAuth. Axe passing is useful automated evidence, not a substitute for assistive-technology testing. Existing repository engine-specific skips were not removed; none occurred in the selected Chromium cases.
- **Live provider:** No new Google Drive account or multi-device live-provider claim is made. Owner-controlled OAuth publishing cannot be established from local source.
- **Dependency security:** Repository documentation records an older build-tool advisory. This audit did not query the live advisory database or run an online `npm audit`; that historical note is not presented as a current confirmed vulnerability. No dependency upgrade/downgrade was attempted.
- **Release enforcement:** No GitHub Actions workflow is tracked in `.github/workflows` at this commit. Local test coverage is broad, but the public tree does not itself show an enforced automated pull-request gate. This says nothing about external or private CI.

The repository's [KNOWN_LIMITATIONS.md](https://github.com/Scatter97/CubeLab/blob/28f38d76fa052010d9f13d1a44495ab90026fac3/KNOWN_LIMITATIONS.md) and [STATUS.md](https://github.com/Scatter97/CubeLab/blob/28f38d76fa052010d9f13d1a44495ab90026fac3/STATUS.md) describe additional dated evidence and boundaries; their old test results were not substituted for this audit's runs.

## Recent-commit review

| Change | Audit assessment |
|---|---|
| `28f38d7` — ignore generated workflow map | Housekeeping; no runtime change found in this commit |
| `b0b515d`, `03ea31d` — remove timer workspace/phase labels | Selected stability/inspection/readiness browser checks pass; no new timer-recording defect established |
| `2f6abe1`, `b724a5e` — statistics grouping and resizable layout | Selected statistics tests pass, including metric grouping and visibility combinations. No new calculation finding is attributed to the timer StatsPanel |
| `ad001f9` — statistics/UI and expanded session work | Transfer-related browser cases pass, including stale split ownership and write failures. Recovery metadata interactions still deserve broader scenario coverage |
| `a167d16` — Analytics/dialog/viewer performance | Useful section-specific computation and viewer reuse; conditional dialog unmounting is the likely B8 regression boundary. The B3 running-best bug predates this optimization |
| `5d5dc85`, `42d07d9`, `3e3d38a`, `0d73a87`, `b800d97` | Reviewed current settings/release, responsive, chart, dropdown and session-reordering paths with matching selected coverage; no separate confirmed defect assigned |
| `9b1f0de` / `9f4aea2` — Analytics introduction and follow-ups | Blame places B3's reverse running minimum in `9f4aea2`. B4's unsorted median remains in the later DNF-window change. Existing tests miss the nonmonotonic and historical-prefix oracles |
| Earlier import/sync base code | B1 combines an older additive-import reset call with the reset's metadata-clearing behavior; it is not introduced by November 6's visual work |

Passing tests validate the cases they assert. B3/B4 show why counting tests alone misses direction/order errors: include adversarial datasets and compare public outputs against small independent oracles.

## Prioritized repairs and future features

These are recommendations for review, not edits to your existing roadmap.

| Order | Work | Value / effort | Acceptance target |
|---|---|---|---|
| 1 | Fix B1/B2; unify durable deletion and import metadata handling | Very high / medium | Unpublished deletions, storage failures, reloads, additive import and stale snapshots preserve intent; failure is actionable |
| 2 | Fix B3–B7; add chronology/calendar/provenance oracles | High / small–medium | Independent expected values for every confirmed fixture; parity between timer/Analytics and automatic/manual recovery |
| 3 | Fix B8 and audit lazy-dialog return focus | High / small–medium | Existing native backup round trip completes; keyboard returns to useful controls through all close/handoff paths |
| 4 | Add a recovery dashboard: last durable save, metadata health, backup size, pending local changes, export reminders and clear failure recovery | High / medium | Users can distinguish “visible in memory,” “saved locally” and “published remotely”; diagnostics exclude sensitive credentials |
| 5 | Add automatic local recovery snapshots and restore preview/diff | High / medium–large | Versioned recovery points with retention/quota handling; counted changes and rejected-row report; recoverable failed restores |
| 6 | Add continuous correctness checks | High / medium | PR checks run types/lint/unit tests plus focused Chromium durability/offline smoke; scheduled additional-engine coverage; red regressions block merging |
| 7 | Introduce incremental storage, then optimize measured calculation bottlenecks | High / large | Migration/recovery design first; avoid whole-history writes per solve; profile 7k/10k histories with sync/tools on/off; exact invalidation after edits/Undo/import |
| 8 | Move expensive Analytics preparation into a cancellable worker where profiling supports it | Medium–high / medium–large | Stale requests cannot replace newer filters; numeric parity; measured long-task reduction and bounded memory |
| 9 | Improve large-history organization: tags, search, filtered selection and CSV/report export | Medium / medium–large | Stable tag IDs/migrations/sync semantics, precise export of the displayed scope, clear units and penalties; no accidental history replacement |
| 10 | Optional training features: goals, practice plans and drill-specific custom events | Medium / medium | Use correct existing statistics; clearly distinguish empirical results from estimates; no misleading cross-event comparison |
| 11 | Stackmat/Bluetooth/smart-cube input integrations | Optional / large | Explicit hardware compatibility, disconnect behavior, timing-source ownership and exact-once recording tests before treating as supported |

### Suggested delivery sequence

**First repair batch:** B1/B2 plus their focused hook and browser regressions. Reuse synthetic stale-device fixtures and selective storage failure injection. Do not bundle a persistence-engine rewrite into this repair.

**Second batch:** Analytics chronology, running best, median and calendar fixes; manual restore provenance; cross-check current/best values against the independent statistics engine. Keep each root cause independently reviewable.

**Third batch:** Modal focus lifecycle and the blocked backup round trip. Audit other lazy dialogs, then establish CI coverage around the repaired failures.

**Then:** Recovery visibility and local snapshots, followed by measured storage/worker improvements. Only expand training/hardware features once the data/recovery baseline is dependable.

## Evidence package and remaining work

The supporting fixtures, configuration and logs remain at:
`/home/joshua/Documents/Codex/2026-11-07/referenced-chatgpt-conversation-this-is-an/outputs/`

The audit report was moved into this repository at the user's request after the audit was completed; its original no-source-changes statement describes the audit run.

- `audit-regressions.test.ts`: eight executable expected-correct assertions.
- `audit.config.mts`: external harness using the existing local source/dependencies.
- `audit-regressions.log`: actual failing outputs for A1–A8.
- `unit-tests.log`: existing 823-test local run.
- `browser-tests.log`: 55 passing focused Chromium checks.
- `recovery-browser-tests.log`: six passing recovery/offline cases and the focus failure.
- `focus-rerun.log`, `focus-trace.zip`, `focus-test-failed-1.png`: independent reproduction and browser evidence.
- `build.log`: final normal production/PWA build.

No fixes were applied. Remaining work is to turn the confirmed findings into small reviewed patches, complete the interrupted native backup round trip, verify the hypotheses with targeted fixtures, and run the additional platform/provider checks appropriate to those changes.
