/**
 * Shared maximum for native backup and csTimer imports. Kept dependency-free
 * so first-run onboarding can enforce the limit without loading the full backup
 * serializer/parser chunk.
 */
export const MAX_BACKUP_BYTES = 10 * 1024 * 1024
