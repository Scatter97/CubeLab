import { STANDARD_CASE_BY_ID } from './catalog/standardCases'
import { algorithmSnapshotFor } from './algorithmSelection'
import { builtInAlgorithmForCase } from './catalog/defaultAlgorithms'
import { appendTrainingAttempt, createTrainingAttempt, finishTrainingVisit } from './records'
import { createEmptyTrainingData } from './storage'
import { acknowledgeTrainingReport, beginTrainingSession } from './visits'
import { TRAINING_PRECURSORS, type TrainingCalibration, type TrainingData, type TrainingSetId, type TrainingSetupSnapshot, type TrainingMode } from './types'

export const NOW = 1_790_000_000_000

/** Synthetic structural persistence fixtures, not cube-verification evidence. */
export function setup(setId: TrainingSetId = 'oll', mode: TrainingMode = 'execution'): TrainingSetupSnapshot {
  const caseId = setId === 'oll' ? 'oll:27' : 'pll:ua'
  const precursor = mode === 'recognition' ? TRAINING_PRECURSORS[setId].notation : null
  return {
    version: 1, generatedAt: NOW, generatorVersion: 'fixture-v1',
    generatorAlgorithm: { id: `${caseId}:generator`, revision: 1, notation: null },
    generated: {
      setId, caseId, mode, auf: '', scramble: "R U R'", targetAlgorithmId: `${caseId}:generator`,
      targetAlgorithmNotation: "R U R'", precursor, targetHidden: mode === 'recognition',
      verification: {
        identity: caseId, canonicalSignature: STANDARD_CASE_BY_ID.get(caseId)!.canonicalSignature,
        targetF2lSolved: true, targetIsStandardFrame: true, targetMatchesCase: true,
        exactTargetReached: true, algorithmSolvesTargetUpToAuf: true,
        recognition: precursor ? {
          precursor, preStateF2lSolved: setId === 'pll', preStateThreeSlotsSolved: true,
          preStateMatchesRequiredConfiguration: true, precursorReturnsTargetExactly: true,
          preStateIsNotPllOriented: setId === 'pll' ? true : null,
        } : null,
      },
    },
  }
}

export function calibration(setId: TrainingSetId = 'oll'): TrainingCalibration {
  return {
    version: 1, protocol: 'fixed-inverse-precursor:v1', id: `calibration-${setId}`, setId,
    precursorId: TRAINING_PRECURSORS[setId].id,
    precursorNotation: TRAINING_PRECURSORS[setId].notation,
    samplesMs: [600, 700, 800, 900, 1000, 1100, 1200], medianMs: 900,
    measuredAt: NOW - 1000, recognitionAttemptsAtMeasurement: 0,
    renewal: { days: 7, recognitionAttempts: 100 }, source: 'initial', invalidSampleCount: 2,
  }
}

/**
 * Valid closed history with one saved session and one execution attempt.
 * Structural fixture only: it does not assert cube-state verification.
 */
export function closedTrainingHistory(setId: TrainingSetId = 'oll'): TrainingData {
  const caseId = setId === 'oll' ? 'oll:27' : 'pll:ua'
  const algorithm = algorithmSnapshotFor(builtInAlgorithmForCase(caseId)!)
  const categoryId = `${setId}:execution` as const
  const baseSetup = setup(setId, 'execution')
  const attemptSetup = {
    ...baseSetup,
    generatorAlgorithm: algorithm,
    generated: {
      ...baseSetup.generated,
      targetAlgorithmId: algorithm.id,
      targetAlgorithmNotation: algorithm.notation!,
    },
  }
  let data = beginTrainingSession(createEmptyTrainingData(), {
    id: 'fixture-session',
    at: NOW,
    categoryId,
    session: {
      version: 1,
      name: 'Backup fixture',
      cases: [{ caseId, algorithm }],
    },
  })
  data = appendTrainingAttempt(
    data,
    createTrainingAttempt({
      id: 'fixture-attempt',
      setup: attemptSetup,
      visitId: 'fixture-session',
      rawMs: 1_234,
      createdAt: NOW + 3_000,
    }),
  )
  data = finishTrainingVisit(data, 'fixture-session', NOW + 4_000, 'manual')
  data = acknowledgeTrainingReport(data, 'fixture-session', 'session')
  return { ...data, calibrations: [calibration(setId)] }
}
