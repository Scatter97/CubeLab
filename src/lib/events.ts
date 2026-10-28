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
  { id: '555', label: '5×5', scrambleEventId: '555' },
  { id: '666', label: '6×6', scrambleEventId: '666' },
  { id: '777', label: '7×7', scrambleEventId: '777' },
]

export function getEventDefinition(id: string): CubeLabEvent | undefined {
  return CUBELAB_EVENTS.find((event) => event.id === id)
}

export function isPuzzleEventValue(value: unknown): value is PuzzleEvent {
  return (
    typeof value === 'string' &&
    CUBELAB_EVENTS.some((event) => event.id === value)
  )
}
