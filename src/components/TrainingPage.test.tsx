import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import TrainingPage from './TrainingPage'
import { TrainingController } from '../lib/training/controller'
import { createTrainingAttempt, correctTrainingAttribution } from '../lib/training/records'
import { createEmptyTrainingData } from '../lib/training/storage'
import { calibration, NOW, setup } from '../lib/training/persistenceFixtures.test-support'
import { DEFAULT_SETTINGS } from '../lib/storage'
import type { TimerController } from '../hooks/useTimer'
import type { TrainingCustomAlgorithm, TrainingData } from '../lib/training/types'
import { useSyncExternalStore } from 'react'

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
})
afterEach(() => { cleanup(); localStorage.clear() })
function showOptions(name: string) {
  const trigger = screen.getByRole('button', { name })
  // JSDOM does not implement declarative popover activation.
  document.getElementById(trigger.getAttribute('popovertarget')!)!.style.display = 'grid'
}

function fixtureWithData(data: TrainingData) {
  let raw = JSON.stringify(data)
  const c = new TrainingController({ storage: { getItem: () => raw, setItem: (_k,v) => { raw = v } }, now: () => NOW, generate: async (_data, category) => setup(category.startsWith('oll') ? 'oll' : 'pll', category.endsWith('recognition') ? 'recognition' : 'execution') })
  const onPress = vi.fn(), modal = vi.fn()
  const timer: TimerController = { state: { status: 'idle' }, holdProgress: 0, inspectionElapsedMs: null, press: onPress, release: vi.fn(), cancel: vi.fn() }
  function View() { const state = useSyncExternalStore(c.subscribe, c.getSnapshot); return <TrainingPage controller={c} state={state} timer={timer} settings={DEFAULT_SETTINGS} onPress={onPress} onCancel={vi.fn()} onModalChange={modal} onNotify={vi.fn()} onDeleteAttempt={vi.fn()} /> }
  return { c, View, timer, modal }
}
function fixture(recognition = false) {
  return fixtureWithData({ ...createEmptyTrainingData(), calibrations: recognition ? [calibration()] : [] })
}
describe('Training interface', () => {
  it('opens mode selection without calibration and exposes a labelled shared timer', () => {
    const { View } = fixture(); render(<View />)
    expect(screen.queryByText(/0 \/ 7 accepted/)).not.toBeInTheDocument()
    expect(screen.getByTestId('timer-surface')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Begin practice' })).toBeInTheDocument()
  })
  it('shares the statistics and history surfaces, and keeps only Last Result', async () => {
    const { c, View } = fixture(true); render(<View />)
    expect(screen.getByRole('region', { name: 'Statistics' })).toHaveClass('stats-panel')
    expect(screen.getByRole('region', { name: /^Attempts/ })).toHaveClass('history-panel')
    expect(screen.queryByTestId('training-tools')).toBeNull()
    await act(async () => c.selectCategory('oll:recognition'))
    act(() => { c.beginAttempt(); c.completeAttempt(2500) })
    const stat = screen.getByTestId('training-current-single')
    expect(stat).toHaveTextContent('2.50')
    fireEvent.change(screen.getByLabelText('Timing series'), { target: { value: 'estimated' } })
    expect(stat).toHaveTextContent('1.60')
    fireEvent.click(screen.getByRole('button', { name: /#1.*OLL 27/ }))
    const menu = within(screen.getByRole('menu', { name: 'Attempt 1 actions' }))
    expect(menu.getByText('Attempt #1')).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Attempt details' })).toBeNull()
    fireEvent.click(menu.getByRole('menuitem', { name: 'Attempt details' }))
    expect(screen.getByRole('dialog', { name: 'Attempt details' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Mark as DNF' }))
    expect(stat).toHaveTextContent('DNF')
    expect(screen.getByRole('region', { name: 'Last Result' })).toBeInTheDocument()
  })
  it('persists order, visibility and columns independently in the four categories', async () => {
    const empty = createEmptyTrainingData()
    const { c, View } = fixtureWithData({ ...empty, calibrations: [calibration(), calibration('pll')] })
    const { unmount } = render(<View />)
    const visibleRows = () => Array.from(document.querySelectorAll('.stats-scroll [data-testid^="training-stat-row-"]'), row => row.getAttribute('data-testid'))
    const edit = () => {
      showOptions('Statistics options')
      fireEvent.click(screen.getByRole('button', { name: 'Customize' }))
      return within(screen.getByRole('dialog', { name: 'Customize Training statistics' }))
    }
    const options = edit()
    fireEvent.click(options.getByLabelText('Single'))
    fireEvent.click(options.getByLabelText('DNF percentage'))
    fireEvent.click(options.getByRole('button', { name: 'Move mo3 down' }))
    fireEvent.click(options.getByLabelText('Best'))
    fireEvent.click(options.getByRole('button', { name: 'Close' }))
    expect(visibleRows()).toEqual(['training-stat-row-ao5', 'training-stat-row-mo3', 'training-stat-row-ao12', 'training-stat-row-dnfRate'])
    expect(screen.queryByTestId('training-best-ao5')).toBeNull()
    for (const category of ['oll:recognition', 'pll:execution', 'pll:recognition'] as const) {
      await act(async () => c.selectCategory(category))
      expect(visibleRows()[0]).toBe('training-stat-row-single')
      expect(screen.getByTestId('training-best-ao5')).toBeInTheDocument()
      const preview = screen.getByRole('region', { name: 'Practice setup' }).querySelector('img')
      if (category.endsWith(':recognition')) expect(preview).toBeNull()
    }
    fireEvent.change(screen.getByLabelText('Timing series'), { target: { value: 'estimated' } })
    await act(async () => c.selectCategory('oll:recognition'))
    expect(screen.getByLabelText('Timing series')).toHaveValue('raw')
    await act(async () => c.selectCategory('oll:execution'))
    unmount()
    render(<View />)
    expect(visibleRows()[0]).toBe('training-stat-row-ao5')
    const restored = edit()
    fireEvent.click(restored.getByRole('button', { name: 'Restore defaults' }))
    fireEvent.click(restored.getByRole('button', { name: 'Close' }))
    expect(visibleRows()[0]).toBe('training-stat-row-single')
  })
  it('keeps unknown attribution at case level and displays each historical algorithm revision', () => {
    const make = (id: string) => createTrainingAttempt({ id, setup: setup(), rawMs: 2500, createdAt: NOW, visitId: 'v' })
    const attempts = [
      make('unknown'),
      correctTrainingAttribution(make('old'), { id: 'historical-algorithm', revision: 1, notation: 'R U' }, NOW),
      correctTrainingAttribution(make('new'), { id: 'historical-algorithm', revision: 2, notation: 'R U2' }, NOW),
    ]
    const { View } = fixtureWithData({ ...createEmptyTrainingData(), attempts, visits: [{
      version: 1, id: 'v', startedAt: NOW, endedAt: NOW, attemptIds: attempts.map(attempt => attempt.id),
      startedCategoryId: 'oll:execution', categoryIds: ['oll:execution'], summaryId: null,
    }] })
    render(<View />)
    showOptions('Statistics options')
    fireEvent.click(screen.getByRole('button', { name: 'Detailed statistics' }))
    const breakdown = within(screen.getByRole('dialog', { name: 'Detailed statistics' }))
    fireEvent.change(breakdown.getByLabelText('Filter'), { target: { value: 'practiced' } })
    expect(breakdown.getByRole('row', { name: /^OLL 27/ })).toHaveTextContent('OLL 273')
    fireEvent.click(breakdown.getByRole('tab', { name: 'By algorithm' }))
    expect(breakdown.getByText(/1 attempt.*with unknown attribution/)).toBeInTheDocument()
    expect(breakdown.getByText(/Historical · rev. 1/)).toBeInTheDocument()
    expect(breakdown.getByText(/Historical · rev. 2/)).toBeInTheDocument()
  })
  it('reports all enabled built-in defaults as verified for both sets', async () => {
    const data = createEmptyTrainingData()
    const { View } = fixtureWithData({ ...data, preferences: { ...data.preferences, algorithmTracking: true } }); render(<View />)
    expect(screen.getByRole('button', { name: /57 cases selected/ })).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: /cases selected, edit cases/i })[0]!)
    expect(screen.getByText('57 selected')).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: 'Algorithms' })[0]!)
    expect(screen.getByText('Built-in default', { selector: 'strong' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Preferred algorithm' })).toHaveValue(JSON.stringify(['oll:1:alg:default-v1', 1]))
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    fireEvent.change(screen.getByRole('combobox', { name: 'Algorithm set' }), { target: { value: 'pll' } })
    await waitFor(() => expect(screen.getByRole('button', { name: /21 cases selected/ })).toBeInTheDocument())
  })
  it('shows and switches between the built-in default and a user algorithm', async () => {
    const custom: TrainingCustomAlgorithm = {
      id: 'oll:1:user:test', version: 1, setId: 'oll', caseId: 'oll:1', source: 'user',
      notation: "R U R' U' R' F R F'", normalizedNotation: "R U R' U' R' F R F'",
      createdAt: NOW, label: 'My OLL 1', verification: { status: 'verified', method: 'cube-state', verifiedAt: '2026-11-10', frameNormalized: true, solvesCase: true, checkedAufs: [''] },
    }
    const empty = createEmptyTrainingData()
    const data: TrainingData = {
      ...empty,
      customAlgorithms: [custom],
      preferences: { ...empty.preferences, algorithmTracking: true, preferredAlgorithms: [{ caseId: 'oll:1', algorithm: { id: custom.id, revision: 1, notation: custom.notation } }] },
    }
    const { View, c } = fixtureWithData(data); render(<View />)
    fireEvent.click(screen.getAllByRole('button', { name: /cases selected, edit cases/i })[0]!)
    fireEvent.click(screen.getAllByRole('button', { name: 'Algorithms' })[0]!)
    const preferred = screen.getByRole('combobox', { name: 'Preferred algorithm' })
    expect(preferred).toHaveValue(JSON.stringify([custom.id, 1]))
    expect(screen.getByText('Preferred', { selector: 'strong' }).parentElement).toHaveTextContent('Your algorithm')
    expect(screen.getByText('My OLL 1 · revision 1')).toBeInTheDocument()
    fireEvent.change(preferred, { target: { value: JSON.stringify(['oll:1:alg:default-v1', 1]) } })
    await waitFor(() => expect(c.getSnapshot().data!.preferences.preferredAlgorithms[0]!.algorithm.id).toBe('oll:1:alg:default-v1'))
  })
  it('hides target identity, diagram and algorithm from all rendered recognition metadata until completion', async () => {
    const { c, View } = fixture(true); render(<View />)
    await act(async () => c.selectCategory('oll:recognition'))
    expect(screen.getByTestId('training-scramble')).toHaveTextContent("R U R'")
    expect(screen.getByText('Precursor after start')).toBeInTheDocument()
    expect(screen.queryByText('OLL 27')).not.toBeInTheDocument()
    expect(document.querySelector('img')).toBeNull()
    expect(document.body.innerHTML).not.toContain('oll:27')
    act(() => { c.beginAttempt(); c.completeAttempt(2500) })
    await waitFor(() => expect(screen.getByRole('region', { name: 'Last Result' })).toBeInTheDocument())
    expect(within(screen.getByRole('region', { name: 'Last Result' })).getByText('OLL 27')).toBeInTheDocument()
    expect(screen.getByText(/Raw 2.50.*Est. 1.60/)).toBeInTheDocument()
  })
  it('uses all approved diagrams in independent case selection, with presets and difficult controls', () => {
    const { View, c, modal } = fixture(); render(<View />)
    fireEvent.click(screen.getAllByRole('button', { name: /cases selected, edit cases/i })[0]!)
    expect(screen.getAllByRole('img')).toHaveLength(57)
    expect(modal).toHaveBeenLastCalledWith(true)
    fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }))
    expect(c.getSnapshot().data!.preferences.sets.oll.enabledCaseIds).toHaveLength(0)
    expect(c.getSnapshot().data!.preferences.sets.pll.enabledCaseIds).toHaveLength(21)
  })
})
