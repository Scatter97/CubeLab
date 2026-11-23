import { useEffect, useRef, useState } from 'react'
import type { AppearanceColors, Settings } from '../types'
import { Select } from './Select'

const THEME_OPTIONS = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
] as const

const ACCENT_OPTIONS = [
  { value: 'green', label: 'Green' },
  { value: 'blue', label: 'Blue' },
  { value: 'violet', label: 'Violet' },
  { value: 'amber', label: 'Amber' },
] as const

const COLOR_FIELDS: readonly {
  key: keyof AppearanceColors
  label: string
  fallback: string
  description: string
}[] = [
  {
    key: 'accent',
    label: 'Custom accent',
    fallback: '#377632',
    description: 'Overrides the preset accent across buttons, links and highlights.',
  },
  {
    key: 'background',
    label: 'Page background',
    fallback: '#e9edf1',
    description: 'The page surface behind every panel.',
  },
  {
    key: 'timerBackground',
    label: 'Timer surface',
    fallback: '#f5faf2',
    description: 'The timer panel background in light and dark themes.',
  },
  {
    key: 'timerText',
    label: 'Timer digits',
    fallback: '#111820',
    description: 'The numerals shown on the timer.',
  },
]

const HEX_PATTERN = /^#[0-9a-fA-F]{6}$/

interface AppearanceControlsProps {
  settings: Settings
  onChange: (next: Partial<Settings>) => void
  /** Prefix for test IDs so onboarding and Settings can be tested separately. */
  testIdPrefix?: string
  themeTestId?: string
  accentTestId?: string
}

/**
 * Shared appearance editor for onboarding and Settings. Preset theme/accent
 * choices remain available; custom hex colors layer over the resolved theme.
 */
export function AppearanceControls({
  settings,
  onChange,
  testIdPrefix = 'appearance',
  themeTestId = `${testIdPrefix}-theme`,
  accentTestId = `${testIdPrefix}-accent`,
}: AppearanceControlsProps) {
  const updateColor = (key: keyof AppearanceColors, value: string | null) => {
    onChange({
      appearance: {
        ...settings.appearance,
        [key]: value,
      },
    })
  }

  return (
    <div className="appearance-controls">
      <div className="appearance-presets">
        <label className="settings-field">
          <span className="settings-field-label">Theme</span>
          <Select
            testId={themeTestId}
            value={settings.theme}
            options={THEME_OPTIONS}
            onChange={(value) =>
              onChange({ theme: value as Settings['theme'] })
            }
          />
        </label>

        <label className="settings-field">
          <span className="settings-field-label">Accent preset</span>
          <Select
            testId={accentTestId}
            value={settings.accentColor}
            options={ACCENT_OPTIONS}
            onChange={(value) =>
              onChange({ accentColor: value as Settings['accentColor'] })
            }
          />
        </label>
      </div>

      <div className="appearance-color-list">
        {COLOR_FIELDS.map((field) => {
          const value = settings.appearance[field.key]
          return (
            <div className="appearance-color-row" key={field.key}>
              <div className="appearance-color-copy">
                <label
                  className="settings-field-label"
                  htmlFor={`${testIdPrefix}-color-${field.key}`}
                >
                  {field.label}
                </label>
                <span className="settings-row-description">
                  {field.description}
                </span>
              </div>
              <div className="appearance-color-inputs">
                <input
                  id={`${testIdPrefix}-color-${field.key}`}
                  type="color"
                  className="appearance-color-swatch"
                  aria-label={field.label}
                  value={value ?? field.fallback}
                  data-testid={`${testIdPrefix}-color-input-${field.key}`}
                  onChange={(event) => updateColor(field.key, event.target.value)}
                />
                <HexColorInput
                  label={field.label}
                  value={value}
                  testId={`${testIdPrefix}-color-hex-${field.key}`}
                  onCommit={(next) => updateColor(field.key, next)}
                />
                {value ? (
                  <button
                    type="button"
                    className="text-button"
                    data-testid={`${testIdPrefix}-color-reset-${field.key}`}
                    onClick={() => updateColor(field.key, null)}
                  >
                    Reset
                  </button>
                ) : (
                  <span className="appearance-color-default">Default</span>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <TimerColorPreview holdDurationMs={settings.holdDurationMs} />
    </div>
  )
}

/**
 * Keep the text field editable while a hex value is incomplete. Committing only
 * validated values directly from the controlled prop would reject each
 * intermediate keystroke and make the field impossible to type into.
 */
function HexColorInput({
  label,
  value,
  testId,
  onCommit,
}: {
  label: string
  value: string | null
  testId: string
  onCommit: (value: string | null) => void
}) {
  const [draft, setDraft] = useState(value ?? '')
  const committedRef = useRef(value)

  useEffect(() => {
    if (committedRef.current === value) return
    committedRef.current = value
    setDraft(value ?? '')
  }, [value])

  const commit = (next: string | null) => {
    committedRef.current = next
    onCommit(next)
  }

  return (
    <input
      type="text"
      className="appearance-color-hex"
      aria-label={`${label} hex value`}
      value={draft}
      placeholder="Theme default"
      pattern="^#[0-9a-fA-F]{6}$"
      maxLength={7}
      spellCheck={false}
      data-testid={testId}
      onChange={(event) => {
        const raw = event.target.value
        setDraft(raw)
        const trimmed = raw.trim()
        if (!trimmed) {
          if (value !== null) commit(null)
          return
        }
        if (HEX_PATTERN.test(trimmed)) {
          const normalized = trimmed.toLocaleLowerCase()
          if (normalized !== value) commit(normalized)
        }
      }}
      onBlur={() => {
        const trimmed = draft.trim()
        if (!trimmed) {
          setDraft('')
          if (value !== null) commit(null)
          return
        }
        const normalized = trimmed.toLocaleLowerCase()
        if (!HEX_PATTERN.test(normalized)) {
          // An incomplete value is not a color choice. Restore the last
          // committed value instead of leaving invalid text in the field.
          setDraft(value ?? '')
          return
        }
        setDraft(normalized)
        if (normalized !== value) commit(normalized)
      }}
    />
  )
}

function TimerColorPreview({ holdDurationMs }: { holdDurationMs: number }) {
  const [status, setStatus] = useState<'idle' | 'holding' | 'ready' | 'done'>(
    'idle',
  )
  const timeoutRef = useRef<number | null>(null)
  const doneTimeoutRef = useRef<number | null>(null)
  const activeRef = useRef(false)

  const clearTimers = () => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
    if (doneTimeoutRef.current !== null) {
      window.clearTimeout(doneTimeoutRef.current)
      doneTimeoutRef.current = null
    }
  }

  useEffect(
    () => () => {
      clearTimers()
    },
    [],
  )

  const begin = () => {
    if (activeRef.current) return
    activeRef.current = true
    clearTimers()
    setStatus('holding')
    timeoutRef.current = window.setTimeout(() => {
      timeoutRef.current = null
      if (activeRef.current) setStatus('ready')
    }, Math.max(0, holdDurationMs))
  }

  const end = () => {
    if (!activeRef.current) return
    activeRef.current = false
    clearTimers()
    setStatus((current) => (current === 'ready' ? 'done' : 'idle'))
    doneTimeoutRef.current = window.setTimeout(() => {
      doneTimeoutRef.current = null
      if (!activeRef.current) setStatus('idle')
    }, 900)
  }

  const className =
    status === 'holding'
      ? 'is-holding'
      : status === 'ready'
        ? 'is-ready'
        : status === 'done'
          ? 'is-done'
          : ''

  return (
    <div className="appearance-preview-wrap">
      <span className="settings-field-label">Timer colors</span>
      <button
        type="button"
        className={`appearance-preview ${className}`}
        aria-label="Hold to preview timer colors"
        onPointerDown={(event) => {
          if (event.pointerType === 'mouse' && event.button !== 0) return
          event.currentTarget.setPointerCapture?.(event.pointerId)
          begin()
        }}
        onPointerUp={end}
        onPointerCancel={end}
        onKeyDown={(event) => {
          if (event.key !== ' ') return
          event.preventDefault()
          if (!event.repeat) begin()
        }}
        onKeyUp={(event) => {
          if (event.key !== ' ') return
          event.preventDefault()
          end()
        }}
        onBlur={end}
      >
        <span aria-hidden="true">12.34</span>
        <small>
          {status === 'holding'
            ? 'Holding…'
            : status === 'ready'
              ? 'Ready — release'
              : status === 'done'
                ? 'Started'
                : 'Hold to preview'}
        </small>
      </button>
    </div>
  )
}
