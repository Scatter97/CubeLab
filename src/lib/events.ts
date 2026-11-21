import type {
  BuiltInPuzzleEvent,
  CustomEventDefinition,
  PuzzleEvent,
} from '../types'

/**
 * Scramble notation families. CubeLab validates each family separately because
 * WCA side events do not use N×N face-turn notation.
 */
export type ScrambleFormat =
  | 'cube'
  | 'pyraminx'
  | 'skewb'
  | 'square1'
  | 'clock'
  | 'megaminx'

export interface CubeLabEvent {
  id: BuiltInPuzzleEvent
  label: string
  /** The official `cubing.js` WCA event ID used for scramble generation. */
  scrambleEventId: string
  /** The `cubing.js` twisty-player puzzle ID used by the 3D view. */
  puzzleId: string
  /**
   * The N×N size for the scramble-derived 2D net, or `null` when CubeLab has no
   * correct 2D net for the puzzle. The panel shows an honest unavailable state
   * instead of drawing an unrelated cube.
   */
  cubeSize: number | null
  scrambleFormat: ScrambleFormat
}

export interface EventOption {
  id: PuzzleEvent
  label: string
  isCustom: boolean
  placeholder?: string
}

export const CUBELAB_EVENTS: CubeLabEvent[] = [
  { id: '333', label: '3×3', scrambleEventId: '333', puzzleId: '3x3x3', cubeSize: 3, scrambleFormat: 'cube' },
  { id: '222', label: '2×2', scrambleEventId: '222', puzzleId: '2x2x2', cubeSize: 2, scrambleFormat: 'cube' },
  { id: '444', label: '4×4', scrambleEventId: '444', puzzleId: '4x4x4', cubeSize: 4, scrambleFormat: 'cube' },
  { id: '333oh', label: '3×3 OH', scrambleEventId: '333oh', puzzleId: '3x3x3', cubeSize: 3, scrambleFormat: 'cube' },
  { id: '555', label: '5×5', scrambleEventId: '555', puzzleId: '5x5x5', cubeSize: 5, scrambleFormat: 'cube' },
  { id: '666', label: '6×6', scrambleEventId: '666', puzzleId: '6x6x6', cubeSize: 6, scrambleFormat: 'cube' },
  { id: '777', label: '7×7', scrambleEventId: '777', puzzleId: '7x7x7', cubeSize: 7, scrambleFormat: 'cube' },
  { id: 'pyram', label: 'Pyraminx', scrambleEventId: 'pyram', puzzleId: 'pyraminx', cubeSize: null, scrambleFormat: 'pyraminx' },
  { id: 'skewb', label: 'Skewb', scrambleEventId: 'skewb', puzzleId: 'skewb', cubeSize: null, scrambleFormat: 'skewb' },
  { id: 'sq1', label: 'Square-1', scrambleEventId: 'sq1', puzzleId: 'square1', cubeSize: null, scrambleFormat: 'square1' },
  { id: 'clock', label: 'Clock', scrambleEventId: 'clock', puzzleId: 'clock', cubeSize: null, scrambleFormat: 'clock' },
  { id: 'minx', label: 'Megaminx', scrambleEventId: 'minx', puzzleId: 'megaminx', cubeSize: null, scrambleFormat: 'megaminx' },
]

/**
 * The single catch-all event for puzzle types CubeLab cannot generate or draw.
 * It is available in every event picker but is not part of the official event
 * grid. Solves keep their imported scramble text or use the placeholder.
 */
export const MISC_EVENT: CubeLabEvent = {
  id: 'misc',
  label: 'MISC',
  scrambleEventId: '',
  puzzleId: '',
  cubeSize: null,
  scrambleFormat: 'cube',
}

/** Built-in events including MISC, in picker order. */
export const CUBELAB_EVENT_REGISTRY: readonly CubeLabEvent[] = [
  ...CUBELAB_EVENTS,
  MISC_EVENT,
]

export const DEFAULT_CUSTOM_EVENT_PLACEHOLDER = 'No scramble for this event'

const CUSTOM_EVENT_ID_PATTERN = /^custom:[A-Za-z0-9][A-Za-z0-9:_-]{0,119}$/

/**
 * The active custom event definitions are application state, but labels are
 * needed in deeply nested presentation code that already receives only an
 * event ID. `useSessions` publishes the current definitions here before every
 * committed render so those components can resolve custom names without
 * threading a prop through every layer.
 */
let customEventRegistry: readonly CustomEventDefinition[] = []

export function setCustomEventDefinitions(
  definitions: readonly CustomEventDefinition[] | undefined,
): void {
  customEventRegistry = definitions ?? []
}

/** Test-only: clear module state between isolated render cases. */
export function resetCustomEventDefinitionsForTests(): void {
  customEventRegistry = []
}

export function getCustomEventDefinitions(): readonly CustomEventDefinition[] {
  return customEventRegistry
}

export function isCustomEventId(value: unknown): value is string {
  return typeof value === 'string' && CUSTOM_EVENT_ID_PATTERN.test(value)
}

/** Events that have no official generator: MISC and legacy custom IDs. */
export function isUnscrambledEvent(value: unknown): boolean {
  return value === 'misc' || isCustomEventId(value)
}

export function isCustomEvent(value: unknown): boolean {
  return isCustomEventId(value) &&
    customEventRegistry.some((definition) => definition.id === value)
}

export function getCustomEventDefinition(
  id: string | undefined,
): CustomEventDefinition | undefined {
  if (!id) return undefined
  return customEventRegistry.find((definition) => definition.id === id)
}

export function getEventDefinition(id: string): CubeLabEvent | undefined {
  return CUBELAB_EVENT_REGISTRY.find((event) => event.id === id)
}

export function isPuzzleEventValue(value: unknown): value is BuiltInPuzzleEvent {
  return (
    typeof value === 'string' &&
    CUBELAB_EVENT_REGISTRY.some((event) => event.id === value)
  )
}

/**
 * Folds every unsupported or legacy custom event ID into the MISC category.
 * Missing values are handled by the caller so legacy records can still fall
 * back to 3×3 without relabeling a present unknown.
 */
export function normalizeStoredEvent(value: unknown): PuzzleEvent | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 200) {
    return null
  }
  return isPuzzleEventValue(value) ? value : 'misc'
}

/**
 * Storage accepts built-in IDs and well-formed custom IDs. It deliberately does
 * not require the matching definition to be present: losing a definition must
 * never turn a saved custom-event solve into a 3×3 solve.
 */
export function isStoredEventValue(value: unknown): value is PuzzleEvent {
  // Preserve any present, non-empty event classification, even when this build
  // does not recognize it. Missing fields are handled separately so legacy
  // records can still fall back to 3×3 without relabeling present unknowns.
  return typeof value === 'string' && value.length > 0 && value.length <= 200
}

export function getEventLabel(id: string | undefined): string {
  if (!id) return '3×3'
  return (
    getEventDefinition(id)?.label ??
    getCustomEventDefinition(id)?.name ??
    id
  )
}

export function getEventOption(id: string): EventOption | undefined {
  const builtIn = getEventDefinition(id)
  if (builtIn) {
    return { id: builtIn.id, label: builtIn.label, isCustom: false }
  }
  if (id === 'misc') {
    return { id: 'misc', label: MISC_EVENT.label, isCustom: false }
  }
  const custom = getCustomEventDefinition(id)
  if (custom) {
    return {
      id: custom.id,
      label: custom.name,
      isCustom: true,
      placeholder: custom.placeholder,
    }
  }
  return undefined
}

/** Built-ins (including MISC) in registry order. Custom events are retired. */
export function getEventOptions(): EventOption[] {
  return CUBELAB_EVENT_REGISTRY.map((event) => ({
    id: event.id as PuzzleEvent,
    label: event.label,
    isCustom: false,
  }))
}

/** Selected event labels no longer carry a custom-event marker. */
export function formatEventOptionLabel(option: {
  label: string
  isCustom: boolean
}): string {
  return option.label
}

export function customEventPlaceholder(
  id: string | undefined,
): string | undefined {
  if (id === 'misc') return DEFAULT_CUSTOM_EVENT_PLACEHOLDER
  const definition = getCustomEventDefinition(id)
  if (!definition) return undefined
  return definition.placeholder.trim() || DEFAULT_CUSTOM_EVENT_PLACEHOLDER
}
