import type { PuzzleEvent } from '../types'

export interface CubeLabEvent {
  id: PuzzleEvent
  label: string
  scrambleEventId: string
}

export const CUBELAB_EVENTS: CubeLabEvent[] = [
  { id: '333', label: '3×3', scrambleEventId: '333' },
  { id: '222', label: '2×2', scrambleEventId: '222' },
  { id: '444', label: '4×4', scrambleEventId: '444' },
  { id: '333oh', label: '3×3 OH', scrambleEventId: '333oh' },
]

export function getEventDefinition(id: string): CubeLabEvent | undefined {
  return CUBELAB_EVENTS.find((event) => event.id === id)
}

export function isPuzzleEventValue(value: unknown): value is PuzzleEvent {
  return (
    value === '333' ||
    value === '222' ||
    value === '444' ||
    value === '333oh'
  )
}