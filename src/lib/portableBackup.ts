/** Checked gzip transport for native backups that exceed the legacy reader cap. */
import {
  MAX_BACKUP_BYTES,
  MAX_PORTABLE_BACKUP_BYTES,
  MAX_PORTABLE_JSON_BYTES,
} from './backupLimits'
import {
  backupFileName,
  parseBackup,
  serializeBackup,
  type Backup,
} from './backup'

export {
  MAX_PORTABLE_BACKUP_BYTES,
  MAX_PORTABLE_JSON_BYTES,
} from './backupLimits'

export interface PortableBackupLimits {
  /** Maximum encoded bytes read from or written to a `.json.gz` file. */
  readonly encodedBytes: number
  /** Maximum decoded JSON bytes after decompression. */
  readonly decodedJsonBytes: number
  /** Maximum bytes for an uncompressed legacy `.json` file. */
  readonly legacyJsonBytes: number
}

export const DEFAULT_PORTABLE_BACKUP_LIMITS: PortableBackupLimits = {
  encodedBytes: MAX_PORTABLE_BACKUP_BYTES,
  decodedJsonBytes: MAX_PORTABLE_JSON_BYTES,
  legacyJsonBytes: MAX_BACKUP_BYTES,
}

export type PortableBackupReadResult =
  | {
      readonly ok: true
      readonly raw: string
      readonly compressed: boolean
      readonly encodedBytes: number
      readonly decodedBytes: number
    }
  | { readonly ok: false; readonly error: string }

export type PortableBackupExportResult =
  | {
      readonly ok: true
      readonly bytes: Uint8Array
      readonly fileName: string
      readonly compressed: boolean
      readonly compact: boolean
      readonly encodedBytes: number
      readonly decodedBytes: number
    }
  | {
      readonly ok: false
      readonly error: string
      readonly reason:
        | 'json-too-large'
        | 'compression-unavailable'
        | 'compressed-too-large'
        | 'invalid-readback'
        | 'compression-failed'
      readonly decodedBytes?: number
      readonly encodedBytes?: number
      readonly limit?: number
    }

type PortableErrorCode =
  | 'compression-unavailable'
  | 'decompression-unavailable'
  | 'invalid-gzip'
  | 'decoded-too-large'
  | 'invalid-utf8'

class PortableBackupError extends Error {
  readonly code: PortableErrorCode

  constructor(code: PortableErrorCode, message: string) {
    super(message)
    this.name = 'PortableBackupError'
    this.code = code
  }
}

type CompressionStreamConstructor = new (
  format: string,
) => { readable: ReadableStream<Uint8Array>; writable: WritableStream<Uint8Array> }

type DecompressionStreamConstructor = new (
  format: string,
) => { readable: ReadableStream<Uint8Array>; writable: WritableStream<Uint8Array> }

function getCompressionStream(): CompressionStreamConstructor | null {
  const ctor = (globalThis as { CompressionStream?: CompressionStreamConstructor })
    .CompressionStream
  return typeof ctor === 'function' ? ctor : null
}

function getDecompressionStream(): DecompressionStreamConstructor | null {
  const ctor = (globalThis as { DecompressionStream?: DecompressionStreamConstructor })
    .DecompressionStream
  return typeof ctor === 'function' ? ctor : null
}

function formatByteSize(bytes: number): string {
  const megabytes = bytes / (1024 * 1024)
  if (megabytes >= 10) return `${megabytes.toFixed(1)} MB`
  return `${megabytes.toFixed(2)} MB`
}

function resolveLimits(
  overrides: Partial<PortableBackupLimits> | undefined,
): PortableBackupLimits {
  return { ...DEFAULT_PORTABLE_BACKUP_LIMITS, ...overrides }
}

export function portableCompressionAvailable(): boolean {
  return getCompressionStream() !== null
}

export function portableDecompressionAvailable(): boolean {
  return getDecompressionStream() !== null
}

export function isGzipBytes(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b
}

export function portableBackupFileName(
  compressed: boolean,
  date = new Date(),
): string {
  return compressed
    ? `cubelab-backup-${date.toISOString().slice(0, 10)}.json.gz`
    : backupFileName(date)
}

async function collect(
  stream: ReadableStream<Uint8Array>,
  options: { limit?: number; limitMessage?: string; codecMessage: string },
): Promise<Uint8Array> {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      if (!value) continue
      total += value.byteLength
      if (options.limit !== undefined && total > options.limit) {
        await reader.cancel().catch(() => undefined)
        throw new PortableBackupError(
          'decoded-too-large',
          options.limitMessage ??
            `That backup expands beyond CubeLab's ${formatByteSize(options.limit)} limit.`,
        )
      }
      chunks.push(value)
    }
  } catch (error) {
    if (error instanceof PortableBackupError) throw error
    throw new PortableBackupError('invalid-gzip', options.codecMessage)
  }
  const output = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }
  return output
}

function streamFromBytes(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes)
      controller.close()
    },
  })
}

/** Compresses bytes with the browser codec; no base64 wrapper is involved. */
export async function gzipBytes(bytes: Uint8Array): Promise<Uint8Array> {
  const Ctor = getCompressionStream()
  if (!Ctor) {
    throw new PortableBackupError(
      'compression-unavailable',
      'This browser cannot create compressed backups.',
    )
  }
  const stream = streamFromBytes(bytes).pipeThrough(new Ctor('gzip'))
  return collect(stream, {
    codecMessage: 'The compressed backup could not be created.',
  })
}

/** Decompresses with a streaming byte counter so a bomb fails before 64 MB. */
export async function gunzipBytes(
  bytes: Uint8Array,
  limit = MAX_PORTABLE_JSON_BYTES,
): Promise<Uint8Array> {
  const Ctor = getDecompressionStream()
  if (!Ctor) {
    throw new PortableBackupError(
      'decompression-unavailable',
      'This browser cannot read compressed backups.',
    )
  }
  const stream = streamFromBytes(bytes).pipeThrough(new Ctor('gzip'))
  return collect(stream, {
    limit,
    limitMessage: `That compressed backup expands beyond CubeLab's ${formatByteSize(limit)} decoded limit.`,
    codecMessage: 'That compressed backup is corrupt or incomplete.',
  })
}

function decodeUtf8(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new PortableBackupError(
      'invalid-utf8',
      'That backup is not valid UTF-8 text.',
    )
  }
}

/**
 * Reads a native file by content, not extension. A compressed file is never
 * treated as a csTimer payload; callers run parseBackup after this returns.
 */
export async function readPortableBackupBytes(
  bytes: Uint8Array,
  limits?: Partial<PortableBackupLimits>,
): Promise<PortableBackupReadResult> {
  const resolved = resolveLimits(limits)
  if (bytes.byteLength > resolved.encodedBytes) {
    return {
      ok: false,
      error: `That backup file is ${formatByteSize(bytes.byteLength)}; CubeLab's ${formatByteSize(resolved.encodedBytes)} encoded-file limit was exceeded.`,
    }
  }

  const compressed = isGzipBytes(bytes)
  let rawBytes = bytes
  if (compressed) {
    try {
      rawBytes = await gunzipBytes(bytes, resolved.decodedJsonBytes)
    } catch (error) {
      return {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : 'That compressed backup could not be read.',
      }
    }
  } else if (bytes.byteLength > resolved.legacyJsonBytes) {
    return {
      ok: false,
      error: `That uncompressed backup is ${formatByteSize(bytes.byteLength)}; uncompressed backups are limited to ${formatByteSize(resolved.legacyJsonBytes)}. Use a compressed .json.gz backup.`,
    }
  }

  let raw: string
  try {
    raw = decodeUtf8(rawBytes)
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error ? error.message : 'That backup is not valid text.',
    }
  }
  return {
    ok: true,
    raw,
    compressed,
    encodedBytes: bytes.byteLength,
    decodedBytes: rawBytes.byteLength,
  }
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

/**
 * Builds the exact native export the reader can consume:
 *
 * - readable JSON at or below the legacy 10 MB cap;
 * - compact JSON at or below that cap when only the compact form fits;
 * - compact JSON gzip above the cap, within the portable bounds.
 *
 * The produced file is read back before it is returned. No bytes are returned
 * on any size, codec or validation failure.
 */
export async function preparePortableBackupExport(
  backup: Backup,
  options: {
    limits?: Partial<PortableBackupLimits>
    now?: Date
  } = {},
): Promise<PortableBackupExportResult> {
  const limits = resolveLimits(options.limits)
  const pretty = serializeBackup(backup)
  const prettyBytes = byteLength(pretty)
  let raw = pretty
  let compact = false
  if (prettyBytes > limits.legacyJsonBytes) {
    raw = JSON.stringify(backup)
    compact = true
  }
  const decodedBytes = byteLength(raw)
  if (decodedBytes > limits.decodedJsonBytes) {
    return {
      ok: false,
      reason: 'json-too-large',
      decodedBytes,
      limit: limits.decodedJsonBytes,
      error: `The complete backup is ${formatByteSize(decodedBytes)} of JSON; CubeLab's ${formatByteSize(limits.decodedJsonBytes)} decoded limit was exceeded. No file was created.`,
    }
  }

  if (!parseBackup(raw).ok) {
    return {
      ok: false,
      reason: 'invalid-readback',
      decodedBytes,
      error:
        'The serialized backup could not be read back safely. No file was created.',
    }
  }

  if (decodedBytes <= limits.legacyJsonBytes) {
    return {
      ok: true,
      bytes: new TextEncoder().encode(raw),
      fileName: portableBackupFileName(false, options.now),
      compressed: false,
      compact,
      encodedBytes: decodedBytes,
      decodedBytes,
    }
  }

  if (!portableCompressionAvailable()) {
    return {
      ok: false,
      reason: 'compression-unavailable',
      decodedBytes,
      error: `The complete backup is ${formatByteSize(decodedBytes)} and needs compression, but this browser cannot create compressed backups. No file was created.`,
    }
  }

  let encoded: Uint8Array
  try {
    encoded = await gzipBytes(new TextEncoder().encode(raw))
  } catch (error) {
    return {
      ok: false,
      reason: 'compression-failed',
      decodedBytes,
      error: `${
        error instanceof Error
          ? error.message
          : 'The compressed backup could not be created.'
      } No file was created.`,
    }
  }

  if (encoded.byteLength > limits.encodedBytes) {
    return {
      ok: false,
      reason: 'compressed-too-large',
      decodedBytes,
      encodedBytes: encoded.byteLength,
      limit: limits.encodedBytes,
      error: `The compressed backup is ${formatByteSize(encoded.byteLength)}; CubeLab's ${formatByteSize(limits.encodedBytes)} compressed-file limit was exceeded. No file was created.`,
    }
  }

  // Prove the exact file can be read back, including decompression, UTF-8 and
  // full backup validation, before the caller can download it.
  try {
    const read = await readPortableBackupBytes(encoded, {
      encodedBytes: limits.encodedBytes,
      decodedJsonBytes: limits.decodedJsonBytes,
      legacyJsonBytes: limits.legacyJsonBytes,
    })
    if (!read.ok || read.raw !== raw || !parseBackup(read.raw).ok) {
      return {
        ok: false,
        reason: 'invalid-readback',
        decodedBytes,
        encodedBytes: encoded.byteLength,
        error:
          'The compressed backup could not be read back safely. No file was created.',
      }
    }
  } catch {
    return {
      ok: false,
      reason: 'invalid-readback',
      decodedBytes,
      encodedBytes: encoded.byteLength,
      error:
        'The compressed backup could not be read back safely. No file was created.',
    }
  }

  return {
    ok: true,
    bytes: encoded,
    fileName: portableBackupFileName(true, options.now),
    compressed: true,
    compact,
    encodedBytes: encoded.byteLength,
    decodedBytes,
  }
}
