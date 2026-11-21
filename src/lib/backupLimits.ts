/**
 * Shared maximum for native backup and csTimer imports. Kept dependency-free
 * so first-run onboarding can enforce the limit without loading the full backup
 * serializer/parser chunk.
 */
export const MAX_BACKUP_BYTES = 10 * 1024 * 1024

/**
 * Portable native-backup bounds. These are safety limits for compressed files,
 * not product claims. Drive and csTimer continue to use MAX_BACKUP_BYTES.
 */
export const MAX_PORTABLE_BACKUP_BYTES = 16 * 1024 * 1024
export const MAX_PORTABLE_JSON_BYTES = 64 * 1024 * 1024
