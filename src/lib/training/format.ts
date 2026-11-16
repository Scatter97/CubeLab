import { formatTime } from '../format'
import type { TrainingRollingAverage } from './stats'

export const trainingTime = (ms: number | null) => ms === null ? '—' : formatTime(ms)

export function trainingWindowCell(result: TrainingRollingAverage | undefined) {
  switch (result?.status) {
    case 'value': return { text: trainingTime(result.ms) }
    case 'dnf': return { text: 'DNF', className: 'is-dnf' }
    case 'insufficient-window': return { text: '—', className: 'is-empty', title: 'Trimming leaves no results in this window.' }
    case 'unsupported-result': return { text: '—', className: 'is-empty', title: 'This window contains an unsupported legacy result.' }
    case 'unavailable-estimate': return { text: '—', className: 'is-empty', title: 'A successful attempt in this window has no stored estimate.' }
    case 'insufficient-history': return { text: '—', className: 'is-empty', title: 'More attempts are needed.' }
    default: return { text: '—', className: 'is-empty' }
  }
}

export function trainingChangeLabel(change: number | null | undefined) {
  if (change == null) return 'Insufficient matched history'
  const magnitude = Math.round(Math.abs(change) * 10) / 10
  if (magnitude === 0) return '0% change'
  return change < 0 ? `−${magnitude}% faster` : `+${magnitude}% slower`
}
