/**
 * CubeLab's displayed release version.
 *
 * Format: <major>.<two-digit minor>.YYMMDD:<patch>
 * - The base comes from package.json's 0.1.0 release: major 0, minor 01.
 * - `261104` is the display date (November 4, 2026).
 * - `1` is the first display patch for that date.
 *
 * This string is intentionally separate from storage, settings, backup and sync
 * schema versions. Update the date and patch here when publishing a new display
 * build; never change those schemas to make the label change.
 */
export const CUBELAB_VERSION = '0.01.261104:1'
