# Phase 2B Design Brief — Google Drive Backup

> **Superseded by Phase 2C.** This file is a historical design brief. The
> manual-only fixed-file path it describes was replaced by local-first
> synchronization with unique immutable snapshots, field-level merging, and
> conflict review. See `README.md`, `PATCH_LIMITATIONS.md`, and
> `PROJECT_PROGRESS.md` for current behavior.

Status: **Draft for approval before implementation**  
Last updated: 2026-10-23  
Related milestone: CubeLab Phase 2B (Google Drive backup only; no Phase 2C sync)

## Objective

Add an **optional manual backup/restore path to Google Drive** while preserving
CubeLab’s local-first behavior. Existing local sessions, solves, comments,
settings, JSON export/import, and offline timing must remain fully functional when
Drive is unavailable.

This phase is intentionally **backup-only**:
- manual **Backup now**
- manual **Restore from Drive**
- explicit conflict preview before replacing local data
- no automatic upload, background sync, refresh-token handling, or telemetry

## Approval required before implementation

This brief depends on explicit approval of:
- authentication provider and OAuth client configuration model
- Drive file layout and metadata
- privacy and data-retention language
- restore/conflict semantics
- test mocking strategy

Do not begin Google-specific code until these decisions are accepted.

## Chosen design direction (draft)

### Authentication

Use Google Identity Services (GIS) **token model** with the narrowest usable scope:

- Scope: `https://www.googleapis.com/auth/drive.appdata`
- Access token only, held in memory for the current browser session
- No refresh token and no token persistence in `localStorage`
- Re-authentication is expected after token expiry, browser restart, or revoked
  permission

Client configuration:
- Production builds use `VITE_GOOGLE_CLIENT_ID` when provided.
- If no client ID is configured, the Drive controls are disabled with a setup
  message rather than failing at runtime.
- Settings may optionally store a user-provided Google OAuth client ID as an
  advanced local preference, but it defaults to the build-time value.
- In automated tests and offline E2E, a deterministic in-memory Drive transport
  is selected through `VITE_DRIVE_MOCK=true`; production builds do not enable it.

Privacy:
- Drive is never contacted during normal timer use.
- No Google account data beyond Drive metadata required for backup is requested.
- The app does not read arbitrary Drive files outside `appDataFolder`.
- The account email, if available from the token response, may be shown locally
  to identify the connected backup, but it is not persisted beyond the current
  browser session unless explicitly approved.

### Remote file layout

One private app-data file is the source of truth for the remote backup:
- Name: `cubelab-backup.json`
- Parent: `appDataFolder`
- Media type: `application/json`
- Content: the existing versioned local backup envelope (`cubelab-backup`, version 1)
- App properties:
  - `app`: `CubeLab`
  - `format`: `cubelab-backup`
  - `backupVersion`: `1`
  - `sessionsSchemaVersion`: `2`
  - `settingsSchemaVersion`: `6`
  - `createdAt` and `updatedAt` metadata when available

Drive operations allowed in this phase:
- find the backup file in `appDataFolder`
- create it if missing
- update its media content if present
- download its media content
- optionally delete it with an explicit confirmation

No folder creation, broad Drive listing, or file-sharing operation is permitted.

### Envelope and compatibility

The Drive backup must reuse the existing local backup format exactly, including:
- app marker: `CubeLab`
- format marker: `cubelab-backup`
- backup version `1`
- sessions envelope
- settings envelope

Remote restore uses the same validation as local import:
- invalid JSON
- wrong app/format/version markers
- missing or invalid sessions/settings
- empty sessions
- unsupported schema versions
- oversized payloads above the 10 MB limit

Remote files are rejected before any local mutation if validation fails.

## Backup flow

1. User opens Settings → Data → Google Drive backup.
2. If unconfigured, show a setup-state message and disabled actions.
3. If unauthenticated, show **Connect Google Drive**.
4. On connect, request the app-data scope and establish an in-memory access
   token.
5. **Backup now**:
   - build a local backup from current sessions and settings
   - if no remote file exists, create `cubelab-backup.json`
   - if a remote file exists, update its media content
   - store local run metadata:
     - remote file ID
     - remote modified time
     - last successful backup timestamp
   - notify success/failure inline
6. Do not upload automatically after solves, settings changes, imports, or page
   load.

## Restore / conflict flow

1. User chooses **Restore from Drive**.
2. App downloads the remote file.
3. Validate it strictly.
4. If invalid, show an inline error and leave local data untouched.
5. If valid, show a confirmation dialog containing:
   - current session/solve counts
   - incoming session/solve counts
   - remote backup timestamp
   - settings restoration note
6. On confirmation, replace sessions and settings exactly as local import does.
7. On cancellation, leave local data untouched.

The same typed confirmation phrase used for destructive session actions is not
required for ordinary restore; the explicit count dialog plus confirm/cancel is
sufficient. A stronger phrase may be added later if desired.

## Local state and storage

Add a small versioned local store, separate from sessions/settings:
- Key: `cubelab:drive:v1`
- Schema: version 1
- Contents:
  - `remoteFileId`
  - `remoteModifiedTime`
  - `lastBackupAt`
  - `lastRestoreAt`
  - `configuredClientIdSource`: `build`, `settings`, or `none`
  - `connectedAccountLabel` (session-only if not explicitly approved for
    persistence)

This store must be validated with field-level fallback, matching the existing
settings storage pattern. It is excluded from backup envelopes: backup includes
sessions and settings only.

## Settings UI changes

Add a dedicated Data subsection rather than overloading the existing local backup
dialog:
- **Google Drive backup** section in Settings → Data
- status row: `Not configured`, `Disconnected`, `Connected`, `Backing up`,
  `Restoring`, or `Error`
- connected account label when available
- remote backup timestamp when available
- actions:
  - **Connect Google Drive**
  - **Disconnect**
  - **Backup now**
  - **Restore from Drive**
  - **Delete remote backup** (optional, behind confirmation)
- Inline validation/error text
- All controls disabled when:
  - Drive is unconfigured
  - timer is active
  - auth lacks the required scope
  - network is unavailable

## Offline behavior

- Offline reload and timing remain fully functional.
- Drive actions fail quickly and safely when offline.
- No request is retried automatically.
- Backup/restore never blocks the timer or mutates data on partial failure.
- A network failure during upload does not claim success.

## Failure states that must be handled explicitly

- missing/unconfigured client ID
- GIS/account script unavailable
- user cancels OAuth consent
- expired or invalid access token
- revoked permission
- network/DNS/offline failure
- quota or Drive API rejection
- remote file missing on restore (treat as invalid/empty)
- remote file invalid or unsupported
- remote update conflict or stale metadata
- local storage failure while recording drive metadata
- Drive button disabled while timer active

Every failure must leave:
- local sessions intact
- local settings intact
- local data storage valid
- UI in a recoverable state

## Security notes

- Use app-data scope only.
- Do not store access tokens in long-lived browser storage.
- Client ID may be public; it is not a secret.
- No CORS credential tricks or proxy backend.
- Backup files are JSON containing user solves and comments; users must be told
  that Google Drive stores that file in their app-data area.
- Privacy/data-retention documentation must describe encryption in transit,
  Google Drive’s storage behavior, and how to disconnect/delete the remote file.

## Testing strategy

### Unit tests

Mock the Drive transport and test:
- client construction/config detection
- OAuth connect/disconnect states
- backup create vs. update
- restore validation and replacement
- conflict dialog data
- metadata persistence
- every failure path
- version compatibility

### Production E2E

Use a deterministic mock Drive transport enabled only by
`VITE_DRIVE_MOCK=true` for the Playwright build. E2E covers:
- configured/unconfigured Drive controls
- connect flow
- backup now creates a remote file and records metadata
- backup now updates an existing remote file
- restore valid remote data
- invalid remote file rejection
- user cancellation
- failure state
- timer-disable behavior
- offline behavior for Drive controls

Real Google endpoints are never required in CI.

## Documentation and release requirements

Before Phase 2B is complete:
- update `README.md` with setup/configuration and privacy notes
- update `PROJECT_PROGRESS.md` with verification evidence
- update `AGENTS.md` invariants for remote data handling
- add the Drive setup instructions for developers
- refresh screenshots if the Settings/Data UI changes materially
- run `npm run check` (or explicitly document when E2E strategy differs)

## Open questions for approval

1. Should the user be able to supply their own Google OAuth client ID in Settings,
   or should the build-time `VITE_GOOGLE_CLIENT_ID` be the only supported path?
2. Should **Delete remote backup** be included in Phase 2B, or deferred?
3. Should remote restore require a typed phrase in addition to the confirmation
   dialog?
4. Should the connected account label be persisted across browser sessions, or kept
   session-only for privacy?
5. Should the Drive backup file name remain fixed, or allow custom file names?

## Non-goals (explicitly not included)

- multi-device merge or conflict resolution beyond replace-only restore
- background sync
- automatic backup after solve/settings/import
- refresh tokens
- telemetry
- non-Google providers
- public sharing or Drive folder browsing
- encryption-at-rest beyond Google Drive’s platform behavior

## Acceptance gate (Phase 2B)

- [ ] Explicit user approval of this brief’s open questions.
- [ ] Local-only behavior remains fully functional when Drive is unavailable.
- [ ] Drive controls are disabled and explain the reason when unconfigured.
- [ ] Valid remote backups replace local data only after explicit confirmation.
- [ ] Invalid remote files never mutate local data.
- [ ] OAuth, upload, download, cancellation, conflict, and failure paths have tests.
- [ ] Drive API calls are mocked in automated tests.
- [ ] Privacy and data-retention behavior is documented.
- [ ] Offline E2E remains green.
- [ ] `README.md`, `PROJECT_PROGRESS.md`, and `AGENTS.md` are updated.
- [ ] `npm run check` passes, or a documented equivalent is recorded.
