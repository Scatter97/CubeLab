# CubeLab synchronization hardening patch — limitations

This patch is deliberately **not** a claim that every audit finding is fixed.

## Addressed

### Manual conflict resolution and stale approvals

- Pending same-field conflicts block cloud publication and appear in the Drive
  dialog with **Use this device** and **Use cloud** actions. The choice is
  stored, applied on the next merge, stamped newer than both reviewed versions,
  and synchronization resumes automatically after the last pending conflict is
  resolved.
- An approval applies only while both sides still hold the exact field values and
  modification timestamps that were displayed for review. A third edit made
  between review and approval raises a fresh conflict instead of being silently
  overwritten by the stale choice.

### Deletion recovery across successive devices

- Solves belonging to a deleted session can be copied into a clearly named
  `(recovered)` session instead of disappearing.
- If a recovered session already exists, later eligible solves are merged into it
  by stable solve ID. A second or third offline device cannot lose its solves
  because the recovered session was created earlier.
- Recovery preserves the puzzle event, existing recovered-session preferences,
  and inspection override. Repeated synchronization is idempotent.
- New session tombstones record the solve IDs known to the deleting device.
  Unknown solve IDs from another device are recoverable even if clock skew makes
  them look older than the deletion. Legacy tombstones without that snapshot fall
  back to wall-clock comparison.

### Other hardening

- **Pending count semantics:** the internal counter is
  `newSolvesSinceLastSync`, matching the UI label. It does not claim to count
  renamed sessions, penalty edits, deletions, or preference changes.
- **Status messages:** manual completion now says that no new solves were
  exchanged instead of implying that every metadata change was synchronized.
- **Redirect determinism:** normalization is covered for shuffled input and
  divergent approvals for the same source.
- **In-flight edits:** reference-change checks still protect local state during
  download and upload.

## Still unresolved

- **No verified atomic compare-and-swap.** The Drive transport uses direct media
  `PATCH` without an atomic revision precondition. Two devices can still overwrite
  a remote backup in a write race. A monotonic JSON revision is not a CAS, and
  Google Drive v3 does not expose a verified conditional-write token through this
  transport. This requires a provider-supported protocol or backend guarantee.
- **No server-side write serialization.** In-flight guards protect local data, not
  the remote write.
- **Conflict workflow is minimal.** It resolves solve-field conflicts only. There
  is no conflict queue for session names, preferences, redirects, or global
  settings, and no audit log of past resolutions.
- **Legacy deletion tombstones still use wall-clock comparison.** Session
  tombstones created before the known-solve snapshot cannot distinguish an
  unknown offline edit from an intentionally deleted solve, so ambiguous
  pre-existing edits can still be lost. New tombstones remove the clock-skew
  dependence by recovering IDs the deleting device did not know, which is
  conservative: an old solve that never reached the deleting device can be
  recovered rather than silently deleted.
- **Explicit deletion wins.** If a recovered session is itself tombstoned, later
  recovery passes do not resurrect it.
- **Session preferences remain session-wide.** Independent edits to different
  preference fields on two devices can still lose one edit because there are no
  per-preference timestamps.
- **Redirects are deterministic, not consensus-based.** Devices that temporarily
  hold different approval sets can resolve differently until they exchange the
  same set. Divergent approved destinations have no explicit recovery flow.
- **Sync-on-exit is best effort.** Browsers may terminate async OAuth and network
  work during close. Local persistence is the durability boundary.
- **In-flight identity checks assume immutable React state.** An accidental
  in-place mutation of the sessions or settings objects would not be detected.
- **No real cross-device validation after this patch.** Automated coverage uses
  the deterministic in-memory Drive transport.

To validate after applying, run `npm run typecheck`, `npm run lint`, `npm test`,
`npm run build`, and `npm run test:e2e` with Node 20 or newer. Use an isolated mock
cloud for concurrency scenarios. Do not treat this patch as a data-loss-proof
synchronization protocol.
