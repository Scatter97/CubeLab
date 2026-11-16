/** Runtime chooses read-only built-in defaults or user algorithms and verifies every setup. */
import { STANDARD_CASE_BY_ID } from './catalog/standardCases'
import type { TrainingAlgorithmRecord } from './catalog/types'
import type {
  TrainingCaseId,
  TrainingCategoryId,
  TrainingCustomAlgorithm,
  TrainingData,
  TrainingSetupSnapshot,
} from './types'
import { createId } from '../id'
import { loadCube3Model, AUF_ALGS } from './cube3'
import { normalizeCatalogAlgorithm } from './notation'
import {
  algorithmSnapshotFor,
  availableAlgorithm,
  customAlgorithmRecord,
  resolveCapturedAlgorithm,
  resolvePreferredAlgorithm,
} from './algorithmSelection'
import { activeTrainingSession } from './visits'

export { algorithmSnapshotFor, availableAlgorithm } from './algorithmSelection'

export function algorithmSnapshot(a: TrainingCustomAlgorithm) {
  return algorithmSnapshotFor(a)
}

/** Converts a verified user record for the unchanged catalog setup generator. */
export function algorithmRecord(
  a: TrainingCustomAlgorithm,
): TrainingAlgorithmRecord {
  return customAlgorithmRecord(a)
}

export async function verifyCustomAlgorithm(
  caseId: TrainingCaseId,
  notation: string,
  previous?: Pick<TrainingCustomAlgorithm, 'id' | 'version'>,
): Promise<TrainingCustomAlgorithm> {
  const definition = STANDARD_CASE_BY_ID.get(caseId)
  if (!definition) throw Error('Unknown Training case.')
  const { verifyAlgorithmForCase } = await import('./algorithms')
  const verified = verifyAlgorithmForCase({
    model: await loadCube3Model(),
    caseDefinition: definition,
    notation,
    verifiedAt: new Date().toISOString(),
    checkedAufs: [''],
  })
  // Detach optional metadata so persisted JSON never contains undefined values.
  return JSON.parse(
    JSON.stringify({
      id: `${caseId}:user:${createId()}`,
      version: (previous?.version ?? 0) + 1,
      setId: definition.setId,
      caseId,
      source: 'user',
      notation,
      normalizedNotation: normalizeCatalogAlgorithm(notation),
      createdAt: Date.now(),
      label: 'My algorithm',
      verification: verified.verification,
      ...(previous ? { replacesAlgorithmId: previous.id } : {}),
    }),
  ) as TrainingCustomAlgorithm
}

export async function prepareTrainingSetup(
  data: TrainingData,
  category: TrainingCategoryId,
  previousCase: string | null,
  retryCase?: TrainingCaseId,
): Promise<TrainingSetupSnapshot> {
  const setId = category.startsWith('oll') ? 'oll' : 'pll'
  const mode = category.endsWith('recognition') ? 'recognition' : 'execution'
  const session = activeTrainingSession(data)?.session
  const enabled = session?.cases.map(choice => choice.caseId) ?? data.preferences.sets[setId].enabledCaseIds
  // Missing generators constrain eligibility explicitly; never substitute a different case after a verification failure.
  const available = session ? enabled : enabled.filter((id) => availableAlgorithm(data, id))
  if (available.length < (mode === 'recognition' ? 2 : 1)) {
    throw Error(
      mode === 'recognition'
        ? 'Recognition needs verified algorithms for at least two enabled cases. Enable two cases in Edit cases.'
        : 'Enable at least one case with a verified algorithm in Edit cases to generate a setup.',
    )
  }
  const pool = retryCase
    ? available.filter((id) => id === retryCase)
    : available.filter(
        (id) => id !== previousCase || available.length === 1,
      )
  if (!pool.length) {
    throw Error(
      'This case is disabled or has no verified algorithm. Enable it in Edit cases before retrying.',
    )
  }
  const caseId = pool[Math.floor(Math.random() * pool.length)]!
  const captured = session?.cases.find(choice => choice.caseId === caseId)?.algorithm
  const selected = captured ? resolveCapturedAlgorithm(data, caseId, captured) : resolvePreferredAlgorithm(data, caseId)
  if (!selected) throw Error('This case has no usable verified algorithm.')
  const caseDefinition = STANDARD_CASE_BY_ID.get(caseId)!
  const { generateTrainingSetup } = await import('./setupGeneration')
  const generated = generateTrainingSetup({
    model: await loadCube3Model(),
    caseDefinition: {
      ...caseDefinition,
      defaultAlgorithmId: selected.record.id,
      generatorAlgorithmId: selected.record.id,
    },
    algorithms: [selected.record],
    mode,
    auf: AUF_ALGS[Math.floor(Math.random() * AUF_ALGS.length)],
  })
  return {
    version: 1,
    generatedAt: Date.now(),
    generatorVersion:
      selected.source === 'built-in'
        ? 'verified-built-in-algorithm:v1'
        : 'verified-user-algorithm:v2',
    generatorAlgorithm: selected.snapshot,
    generated,
  }
}
