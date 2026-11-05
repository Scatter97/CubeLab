import release from '../release.json'

/**
 * The displayed release version is derived from the single release record in
 * `src/release.json`. Ordinary builds, tests and commits never change it; only
 * the explicit release commands in `scripts/release.mjs` update that record.
 *
 * Format: MAJOR.FEATURE.YYMMDD:PATCH, for example 0.01.261105:2.
 * The date is the intentional release date in America/Toronto, not the date of
 * a commit or the start of development. This label is separate from storage,
 * settings, backup and sync schema versions.
 */
export const CUBELAB_VERSION = `${release.major}.${String(release.feature).padStart(2, '0')}.${release.date}:${release.patch}`
