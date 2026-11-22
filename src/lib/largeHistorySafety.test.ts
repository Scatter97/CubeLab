import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SETTINGS,
  loadSessionsChecked,
  serializeSessionsData,
  SESSIONS_STORAGE_KEY,
  type StorageLike,
} from './storage'
import { createUpgradeArchive } from './upgradeArchive'
import { createMemoryUpgradeArchiveStore } from './upgradeArchive'
import { createRecoveryPackage } from './recoveryPackage'
import { createBackup, serializeBackupChecked } from './backup'
import type { Session, SessionsData } from '../types'

class MemoryStorage implements StorageLike {
  readonly values = new Map<string, string>()
  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }
  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
}

const NOW = Date.UTC(2026, 10, 21, 12)

function fixture(count: number): SessionsData {
  const sessionCount = 100
  const perSession = Math.ceil(count / sessionCount)
  const sessions: Session[] = []
  let created = 0
  for (let sessionIndex = 0; sessionIndex < sessionCount; sessionIndex += 1) {
    const solves = []
    for (let index = 0; index < perSession && created < count; index += 1, created += 1) {
      solves.push({
        id: `solve-${sessionIndex}-${index}`,
        event: '333' as const,
        rawMs: 8_000 + ((created * 37) % 12_000),
        penalty:
          created % 97 === 0
            ? ('dnf' as const)
            : created % 41 === 0
              ? ('+2' as const)
              : ('none' as const),
        scramble: "R U R' U' F2 D L2 B' R2 U2",
        comment: '',
        createdAt: NOW - (count - created) * 1_000,
        updatedAt: NOW,
      })
    }
    sessions.push({
      id: `session-${sessionIndex}`,
      name: `Session ${sessionIndex + 1}`,
      event: '333',
      createdAt: NOW - 300_000_000,
      updatedAt: NOW,
      solves,
    })
  }
  return {
    activeSessionId: sessions[0]!.id,
    sessions,
    sessionOrder: {
      ids: sessions.map((session) => session.id),
      updatedAt: NOW,
      editorId: 'large-history-safety',
    },
  }
}

function observe(label: string, run: () => void): number {
  const start = performance.now()
  run()
  const elapsed = performance.now() - start
  console.info(`[data-safety-large] ${label}: ${elapsed.toFixed(1)} ms`)
  return elapsed
}

describe.each([10_000, 250_000])(
  'data-safety at %i solves',
  (count) => {
    it(
      'preserves functional integrity through strict validation, archive and recovery export',
      { timeout: 180_000 },
      async () => {
        const data = fixture(count)
        const raw = serializeSessionsData(data)
        const storage = new MemoryStorage()
        storage.setItem(SESSIONS_STORAGE_KEY, raw)

        let checked: ReturnType<typeof loadSessionsChecked> | undefined
        observe(`strict validation ${count}`, () => {
          checked = loadSessionsChecked(storage)
        })
        expect(checked?.ok).toBe(true)
        if (!checked?.ok) return
        expect(
          checked.data.sessions.reduce(
            (total, session) => total + session.solves.length,
            0,
          ),
        ).toBe(count)

        const archiveStore = createMemoryUpgradeArchiveStore()
        await observeAsync(`verified archive ${count}`, async () => {
          const archive = await createUpgradeArchive(
            {
              reason: 'normalization',
              sources: [
                {
                  key: SESSIONS_STORAGE_KEY,
                  raw,
                  sourceVersion: 7,
                },
              ],
            },
            archiveStore,
          )
          expect(archive.entries[SESSIONS_STORAGE_KEY]?.raw).toBe(raw)
        })

        let pkgSize = 0
        observe(`recovery export ${count}`, () => {
          const pkg = createRecoveryPackage(storage, {
            now: new Date(NOW),
          })
          pkgSize = JSON.stringify(pkg).length
          expect(
            pkg.records.find((record) => record.key === SESSIONS_STORAGE_KEY)?.raw,
          ).toBe(raw)
        })
        console.info(
          `[data-safety-large] recovery package ${count}: ${(pkgSize / 1024 / 1024).toFixed(1)} MiB`,
        )

        const backup = createBackup(
          data,
          DEFAULT_SETTINGS,
          new Date(NOW),
        )
        const checkedBackup = serializeBackupChecked(backup)
        if (checkedBackup.ok) {
          expect(checkedBackup.bytes).toBeLessThanOrEqual(10 * 1024 * 1024)
        } else {
          // The native backup cap must reject explicitly and non-destructively,
          // never truncate the collection.
          expect(checkedBackup.error).toMatch(/limit was exceeded/)
          expect(checkedBackup.bytes).toBeGreaterThan(10 * 1024 * 1024)
        }
        expect(storage.getItem(SESSIONS_STORAGE_KEY)).toBe(raw)
      },
    )
  },
)

async function observeAsync(label: string, run: () => Promise<void>): Promise<void> {
  const start = performance.now()
  await run()
  console.info(`[data-safety-large] ${label}: ${(performance.now() - start).toFixed(1)} ms`)
}
