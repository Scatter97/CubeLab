# CubeLab synchronization hardening patch — limitations

This patch is deliberately **not** a claim that all 13 audit findings are fixed.

Included: compatible solve owner selection, preservation of local data while a sync request is in flight, a hard stop before upload if manual conflicts are unresolved, directional count accuracy, and clearer pending-new-solves text.

**Important unresolved items:** The Google Drive transport still does not offer a verified atomic compare-and-swap update. Two independent devices can still overwrite a remote backup in a write race. The manual-conflict-review mode now blocks cloud publication, but there is still no full user-facing conflict-resolution workflow to approve and resume. The sync-on-exit limitation, deletion-vs-offline-edit rescue, field-level session preferences, concurrent redirect approvals, and global settings provenance need further engineering. Do not deploy this as a complete data-loss-proof fix.

To validate after applying, run npm ci, npm run typecheck, npm run lint, npm test, npm run build, npm run test:e2e; use an isolated mock cloud for concurrency scenarios.
