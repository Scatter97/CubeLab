# CubeLab incremental session storage design

**Status:** Design only. Not implemented; production writes remain whole-collection.
**Last reviewed:** 2026-11-19
**Owners:** `src/lib/storage.ts`, `src/hooks/useSessions.ts`, `src/lib/syncStorage.ts`,
`src/lib/sync.ts`, `src/hooks/useSync.ts`

## Why

CubeLab currently serializes and writes the complete session collection on every
accepted solve or session mutation. That is simple, durable and easy to validate,
but write cost grows with history size:

- browser storage serialization is synchronous;
- enabled sync calculates a full content fingerprint;
- a single solve edit rewrites every session and solve in the record.

This design reduces ordinary write cost without weakening validation, recovery,
deletion provenance, exact pending detection or cross-tab ownership. It does not
replace the existing snapshot until the migration, recovery and failure paths
have dedicated regression coverage.

## Current contract to preserve

1. One editable tab owns `cubelab-active-tab` for the document lifetime.
2. Current sessions are schema v6 at `cubelab:sessions:v1`; older v1–v5 records
   load with defaults.
3. Unreadable current or legacy bytes stay untouched and block editing behind
   the recovery gate.
4. A failed write retains the candidate and never publishes a fallback.
5. Solve IDs are stable; deletions and Undo have durable tombstones and recovery
   records.
6. Native import/replacement, csTimer import, Drive merge, session merge/split
   and event reassignment are checked operations with exact ownership metadata.
7. Sync fingerprints detect pending/in-flight differences; they are not a
   collision-free equality proof.
8. Native backups and Drive snapshots consume a validated collection snapshot,
   not an uncommitted journal.

## Proposed layout

Keep the existing snapshot key as the compatibility base:

```text
cubelab:sessions:v1                 existing validated snapshot (schema v6)
cubelab:sessions:journal:v1         append-only mutation journal
cubelab:sessions:journal-meta:v1    journal generation, base revision, length, checksum
```

A journal record contains:

```ts
interface SessionsJournalRecord {
  version: 1
  sequence: number              // strictly increasing within a generation
  operationId: string           // idempotency key
  deviceId: string
  baseRevision: string          // snapshot revision this journal extends
  recordedAt: number
  operation:
    | { kind: 'solve-add'; sessionId: string; solve: Solve }
    | { kind: 'solve-update'; sessionId: string; solveId: string; solve: Solve }
    | { kind: 'solve-delete'; sessionId: string; solveId: string; tombstone: SolveDeletion }
    | { kind: 'session-add'; session: Session }
    | { kind: 'session-update'; sessionId: string; fields: SessionMetadataPatch }
    | { kind: 'session-delete'; sessionId: string; tombstone: SessionDeletion }
    | { kind: 'order-update'; order: SessionOrder }
    | { kind: 'transfer'; transfer: SessionTransfer }
    | { kind: 'custom-events'; definitions: CustomEventDefinition[] }
  checksum: string              // canonical record checksum
}
```

Large structural operations (native import, replacement, merge/split, Drive
adoption) continue to write a checked snapshot or a replacement journal. They
must not be expressed as an unbounded sequence of ordinary solve operations.

## Read path

1. Read and validate the base snapshot exactly as today.
2. Read journal metadata and journal records.
3. Reject the journal for editing if its version, sequence, generation,
   checksum, operation ID or base revision is malformed, duplicated or
   out-of-order.
4. Replay valid operations in sequence order onto the validated base.
5. Remove/retain tombstones exactly as the current merge rules require.
6. Expose the resulting collection to the same startup/session hooks.
7. If replay is invalid, show the existing recovery gate with a download of the
   exact journal and snapshot bytes.

A journal that belongs to a different base revision is not replayed. Startup
recovery decides whether it is an obsolete compaction remnant or an interrupted
replacement.

## Write path

1. The active tab validates the complete candidate as today.
2. It appends one or more journal records with a new sequence and operation ID.
3. It verifies the journal metadata and exact record checksum.
4. It publishes the candidate in memory only after the append succeeds.
5. On append failure, it retains the candidate, reports the failure and blocks
   further writes until retry or recovery-copy download. It never truncates the
   journal or writes a fresh empty snapshot.

The lifetime Web Lock remains the primary single-writer mechanism. Journal
sequence checks are an additional corruption guard, not a multi-tab transaction.

## Compaction

Compaction bounds journal growth:

1. Write a new snapshot to a temporary/staging key and validate the serialized
   bytes.
2. Write a replacement/commit marker naming the new snapshot revision and the
   journal generation to reset.
3. Switch reads to the new snapshot and start a new journal generation.
4. Delete old journal data only after the commit marker is durable.

A crash before the marker leaves the old snapshot and journal authoritative. A
crash after the marker only needs cleanup. The same prepared/committed recovery
pattern already used for native replacement should be reused, not duplicated.

Compaction triggers should be size/count based, not timing based, so a burst of
solves cannot bypass the bound. The exact threshold must be measured; start with
a small synthetic benchmark and preserve the 10 MB import/export cap.

## Sync and backup interaction

- Fingerprints include the snapshot revision plus journal content.
- Native backup and Drive publication materialize the replayed collection.
- The journal itself is local-only and is never uploaded as a sync envelope.
- After a successful publication/compaction, the journal may be reset only if
  the exact published revision is durable and the pending/in-flight guards pass.
- A remote adoption writes a checked replacement and does not merge into the
  local journal.
- Deletion/Undo and durable tombstones keep their current provenance.

## Migration and rollback

- Existing schema v6 snapshot loads unchanged with an empty journal.
- No read-time rewrite is required.
- A build without journal support ignores the new keys and continues using the
  validated snapshot; this is the rollback path.
- A journal-aware build must never write a compacted snapshot while an older
  tab owns the active-tab lock.
- Journal keys are not included in native backups; the materialized collection
  is.

## Failure and quota behavior

- Invalid journal bytes block editing; they are never discarded automatically.
- A full quota fails the append and retains the candidate in memory.
- A compaction failure leaves the previous snapshot and journal authoritative.
- A checksum/sequence failure is a recovery event, not a reason to clear data.
- A journal that cannot replay is retained for download; the application offers
  retry and a recovery copy.
- No automatic migration may run while a replacement journal, pending Undo or
  completion buffer is unresolved.

## Required tests before implementation

- Existing v1–v6 snapshot round trips and invalid-byte recovery.
- Add/update/delete/undo replay, duplicate operation IDs, out-of-order sequences,
  wrong base revision and checksum corruption.
- Solve-add while a session is deleted; split/transfer redirects; custom-event
  deletion/reassignment.
- Crash injection before/after append, before/after compaction commit marker,
  and failed journal cleanup.
- Cross-tab owner/waiting behavior, storage events and adoption during timing.
- Native import, csTimer import, Drive merge/conflict and replacement.
- Quota failure, oversized collection and recovery-copy download.
- 7,000–10,000-solve write/first-result benchmarks comparing whole-snapshot and
  journal appends; record median/range and long tasks.
- Offline PWA behavior and production build worker isolation.

## Decision gates

Implementation requires explicit approval and must preserve the current schema
v6/backup v1/Drive formats until migration and rollback tests pass. Do not ship
journal writes as the only copy, silently compact user data, or remove the
snapshot recovery path.
