# CubeLab synchronization hardening patch — limitations

This patch is deliberately **not** a claim that every audit finding is fixed.

## Addressed in the 2026-10-25 audit follow-up

- **Manual conflict resolution:** pending same-field conflicts now block cloud
  publication and appear in the Drive dialog with **Use this device** and **Use
  cloud** actions. The choice is stored, applied on the next merge, stamped as
  newer than both reviewed versions, and synchronization resumes automatically
  after the last pending conflict is resolved.
- **Deletion versus offline edits:** solves created after a session tombstone are
  copied into a clearly named `(recovered)` session instead of disappearing.
  Recovery is idempotent, preserves the puzzle event, and does not duplicate
  solves that already exist in a live session.
- **Pending count semantics:** the internal counter is now
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
  a remote backup in a write race. A monotonic JSON revision is not a CAS.
- **No server-side write serialization.** In-flight guards protect local data, not
  the remote write.
- **Conflict workflow is minimal.** It resolves solve-field conflicts only. There
  is no conflict queue for session names, preferences, redirects, or global
  settings, and no audit log of past resolutions.
- **Deletion recovery is time-based.** A solve is recovered only when its
  `createdAt` or `updatedAt` is later than the session tombstone. An offline edit
  made before the deletion with a skewed clock can still be lost. Pre-existing
  solves in a deliberately deleted session are not restored.
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
