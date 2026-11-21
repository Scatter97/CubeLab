import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from './storage'
import type { SessionsData, Solve } from '../types'
import { createBackup, serializeBackup } from './backup'
import {
  MAX_BACKUP_BYTES,
  MAX_PORTABLE_BACKUP_BYTES,
  MAX_PORTABLE_JSON_BYTES,
} from './backupLimits'
import {
  DEFAULT_PORTABLE_BACKUP_LIMITS,
  gzipBytes,
  isGzipBytes,
  preparePortableBackupExport,
  readPortableBackupBytes,
} from './portableBackup'

function solve(comment = ''): Solve {
  return {
    id: 'solve-1',
    event: '333',
    rawMs: 12_340,
    penalty: 'none',
    scramble: "R U R' U'",
    comment,
    createdAt: 1_700_000_000_000,
  }
}

function sessions(comment = ''): SessionsData {
  return {
    activeSessionId: 'session-1',
    sessions: [
      {
        id: 'session-1',
        name: 'Morning',
        event: '333',
        createdAt: 1_700_000_000_000,
        updatedAt: 1_700_000_001_000,
        solves: [solve(comment)],
      },
    ],
  }
}

function backupWithComment(comment = '') {
  return createBackup(
    sessions(comment),
    { ...DEFAULT_SETTINGS, inspectionEnabled: false },
    new Date('2026-11-20T00:00:00.000Z'),
  )
}

function bytes(raw: string): Uint8Array {
  return new TextEncoder().encode(raw)
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('portable backup export', () => {
  it('keeps the legacy .json format exactly at the 10 MB boundary', async () => {
    const empty = serializeBackup(backupWithComment(''))
    const emptyBytes = bytes(empty).byteLength
    const comment = 'a'.repeat(MAX_BACKUP_BYTES - emptyBytes)
    const result = await preparePortableBackupExport(backupWithComment(comment))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.compressed).toBe(false)
    expect(result.compact).toBe(false)
    expect(result.encodedBytes).toBe(MAX_BACKUP_BYTES)
    expect(result.decodedBytes).toBe(MAX_BACKUP_BYTES)
    expect(result.fileName).toMatch(/^cubelab-backup-\d{4}-\d{2}-\d{2}\.json$/)
    expect(parseRaw(result.bytes)).toContain(comment)
  })

  it('uses compact .json when only the compact form fits at 10 MB', async () => {
    const compactEmptyBytes = bytes(
      JSON.stringify(backupWithComment('')),
    ).byteLength
    const comment = 'a'.repeat(MAX_BACKUP_BYTES - compactEmptyBytes)
    const result = await preparePortableBackupExport(backupWithComment(comment))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.compressed).toBe(false)
    expect(result.compact).toBe(true)
    expect(result.decodedBytes).toBe(MAX_BACKUP_BYTES)
    expect(result.fileName).toMatch(/\.json$/)
  })

  it('compresses compact JSON one byte above the legacy boundary and reads it back', async () => {
    const compactEmptyBytes = bytes(
      JSON.stringify(backupWithComment('')),
    ).byteLength
    const comment = 'a'.repeat(MAX_BACKUP_BYTES - compactEmptyBytes + 1)
    const backup = backupWithComment(comment)
    const result = await preparePortableBackupExport(backup)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.compressed).toBe(true)
    expect(result.compact).toBe(true)
    expect(isGzipBytes(result.bytes)).toBe(true)
    expect(result.encodedBytes).toBeLessThan(result.decodedBytes)
    expect(result.fileName).toMatch(
      /^cubelab-backup-\d{4}-\d{2}-\d{2}\.json\.gz$/,
    )

    const read = await readPortableBackupBytes(result.bytes)
    expect(read.ok).toBe(true)
    if (!read.ok) return
    expect(read.compressed).toBe(true)
    expect(read.raw).toBe(JSON.stringify(backup))
    expect(read.raw).toContain(comment)
  })

  it('validates its own readback and creates no file for invalid backup data', async () => {
    const backup = backupWithComment()
    const invalid = {
      ...backup,
      training: {
        version: 1,
        data: { ...backup.sessions, version: 2 },
      },
    }
    const result = await preparePortableBackupExport(invalid as never)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('invalid-readback')
    expect(result.error).toContain('No file was created')
  })

  it('rejects decoded JSON above the portable cap', async () => {
    const backup = backupWithComment()
    const rawBytes = bytes(serializeBackup(backup)).byteLength
    const result = await preparePortableBackupExport(backup, {
      limits: { decodedJsonBytes: rawBytes - 1 },
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('json-too-large')
    expect(result.decodedBytes).toBe(rawBytes)
    expect(result.error).toContain('decoded limit was exceeded')
    expect(result.error).toContain('No file was created')
  })

  it('rejects compressed output above the encoded cap', async () => {
    const backup = backupWithComment()
    const result = await preparePortableBackupExport(backup, {
      limits: { legacyJsonBytes: 10, encodedBytes: 4 },
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('compressed-too-large')
    expect(result.encodedBytes!).toBeGreaterThan(4)
    expect(result.error).toContain('compressed-file limit was exceeded')
    expect(result.error).toContain('No file was created')
  })

  it('reports missing CompressionStream without creating a file', async () => {
    vi.stubGlobal('CompressionStream', undefined)
    const result = await preparePortableBackupExport(backupWithComment(), {
      limits: { legacyJsonBytes: 1 },
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('compression-unavailable')
    expect(result.error).toContain('cannot create compressed backups')
    expect(result.error).toContain('No file was created')
  })

  it('uses the documented default limits', () => {
    expect(DEFAULT_PORTABLE_BACKUP_LIMITS).toEqual({
      encodedBytes: 16 * 1024 * 1024,
      decodedJsonBytes: 64 * 1024 * 1024,
      legacyJsonBytes: MAX_BACKUP_BYTES,
    })
    expect(MAX_PORTABLE_BACKUP_BYTES).toBe(16 * 1024 * 1024)
    expect(MAX_PORTABLE_JSON_BYTES).toBe(64 * 1024 * 1024)
  })
})

describe('portable backup read', () => {
  it('gzip round-trips a checked backup', async () => {
    const backup = backupWithComment('round trip')
    const raw = serializeBackup(backup)
    const compressed = await gzipBytes(bytes(raw))
    expect(isGzipBytes(compressed)).toBe(true)
    const read = await readPortableBackupBytes(compressed)
    expect(read).toEqual({
      ok: true,
      raw,
      compressed: true,
      encodedBytes: compressed.byteLength,
      decodedBytes: bytes(raw).byteLength,
    })
  })

  it('still reads an uncompressed legacy .json file', async () => {
    const raw = serializeBackup(backupWithComment('legacy'))
    const read = await readPortableBackupBytes(bytes(raw))
    expect(read.ok).toBe(true)
    if (!read.ok) return
    expect(read.compressed).toBe(false)
    expect(read.raw).toBe(raw)
  })

  it('rejects an uncompressed file above the legacy 10 MB cap', async () => {
    const oversized = new Uint8Array(MAX_BACKUP_BYTES + 1)
    const read = await readPortableBackupBytes(oversized)
    expect(read.ok).toBe(false)
    if (read.ok) return
    expect(read.error).toContain('uncompressed backups are limited to 10.0 MB')
  })

  it('rejects any encoded file above the 16 MB cap before decoding', async () => {
    const oversized = new Uint8Array(MAX_PORTABLE_BACKUP_BYTES + 1)
    const read = await readPortableBackupBytes(oversized)
    expect(read.ok).toBe(false)
    if (read.ok) return
    expect(read.error).toContain('encoded-file limit was exceeded')
  })

  it('stops a gzip bomb at the decoded cap', async () => {
    const bomb = await gzipBytes(new Uint8Array(2 * 1024 * 1024))
    const read = await readPortableBackupBytes(bomb, {
      decodedJsonBytes: 1024 * 1024,
    })
    expect(read.ok).toBe(false)
    if (read.ok) return
    expect(read.error).toContain('decoded limit')
  })

  it('rejects truncated and corrupt gzip data', async () => {
    const raw = serializeBackup(backupWithComment('truncated'))
    const compressed = await gzipBytes(bytes(raw))
    const truncated = compressed.slice(0, Math.max(2, Math.floor(compressed.byteLength / 2)))
    const truncatedRead = await readPortableBackupBytes(truncated)
    expect(truncatedRead.ok).toBe(false)
    if (!truncatedRead.ok) {
      expect(truncatedRead.error).toContain('corrupt or incomplete')
    }

    const corrupt = compressed.slice()
    corrupt[Math.floor(corrupt.byteLength / 2)]! ^= 0xff
    const corruptRead = await readPortableBackupBytes(corrupt)
    expect(corruptRead.ok).toBe(false)
    if (!corruptRead.ok) {
      expect(corruptRead.error).toContain('corrupt or incomplete')
    }
  })

  it('rejects invalid UTF-8 and non-JSON content', async () => {
    const invalidUtf8 = await readPortableBackupBytes(
      new Uint8Array([0xff, 0xfe, 0xfd]),
    )
    expect(invalidUtf8.ok).toBe(false)
    if (!invalidUtf8.ok) expect(invalidUtf8.error).toContain('UTF-8')

    const nonJson = await readPortableBackupBytes(bytes('not a backup'))
    expect(nonJson.ok).toBe(true)
    if (nonJson.ok) expect(nonJson.raw).toBe('not a backup')
  })

  it('reports missing DecompressionStream instead of guessing', async () => {
    const compressed = await gzipBytes(bytes('{}'))
    vi.stubGlobal('DecompressionStream', undefined)
    const read = await readPortableBackupBytes(compressed)
    expect(read.ok).toBe(false)
    if (read.ok) return
    expect(read.error).toContain('cannot read compressed backups')
  })

  it('rejects a valid gzip containing a csTimer-shaped payload only at parseBackup', async () => {
    const compressed = await gzipBytes(bytes('{"session1":[]}'))
    const read = await readPortableBackupBytes(compressed)
    expect(read.ok).toBe(true)
    if (read.ok) expect(read.raw).toBe('{"session1":[]}')
  })
})

function parseRaw(value: Uint8Array): string {
  return new TextDecoder().decode(value)
}
