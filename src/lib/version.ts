import release from '../release.json'

/**
 * The displayed release version is derived from the single release record in
 * `src/release.json`. Ordinary builds, tests and commits never change it; only
 * the explicit release commands in `scripts/release.mjs` update that record.
 *
 * Format: MAJOR.FEATURE.YYMMDD:PATCH, for example 0.01.261121:2.
 * The date is the last production release date in America/Toronto, not the date
 * of a commit or the start of development. A production patch increments the
 * patch on the same date or starts at 1 on a later date; a feature release
 * starts at patch 0; if no release is made, the previous record is retained.
 * This label is separate from storage, settings, backup and sync schema
 * versions.
 */
export const CUBELAB_VERSION = `${release.major}.${String(release.feature).padStart(2, '0')}.${release.date}:${release.patch}`
