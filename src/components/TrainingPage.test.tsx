import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import TrainingPage from './TrainingPage'
import { TrainingController } from '../lib/training/controller'
import { appendTrainingAttempt, createTrainingAttempt, finishTrainingVisit } from '../lib/training/records'
import { createEmptyTrainingData } from '../lib/training/storage'
import { calibration, NOW, setup } from '../lib/training/persistenceFixtures.test-support'
import { TRAINING_STATISTICS_KEY } from '../lib/training/statisticsPreferences'
import { beginTrainingSession } from '../lib/training/visits'
import { DEFAULT_SETTINGS } from '../lib/storage'
import type { TimerController } from '../hooks/useTimer'
import type { TrainingCategoryId, TrainingData, TrainingSetupSnapshot } from '../lib/training/types'
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

function fixtureWithData(data: TrainingData, sessionFlow = false, generate?: (data: TrainingData, category: TrainingCategoryId) => Promise<TrainingSetupSnapshot>) {
  let raw = JSON.stringify(data)
  const c = new TrainingController({ storage: { getItem: () => raw, setItem: (_k,v) => { raw = v } }, now: () => NOW,
    generate: generate ?? (async (_data, category) => setup(category.startsWith('oll') ? 'oll' : 'pll', category.endsWith('recognition') ? 'recognition' : 'execution')) })
  const onPress = vi.fn(), modal = vi.fn()
  const timer: TimerController = { state: { status: 'idle' }, holdProgress: 0, inspectionElapsedMs: null, press: onPress, release: vi.fn(), cancel: vi.fn() }
  function View() { const state = useSyncExternalStore(c.subscribe, c.getSnapshot); return <TrainingPage controller={c} state={state} timer={timer} settings={DEFAULT_SETTINGS} onPress={onPress} onCancel={vi.fn()} onModalChange={modal} onNotify={vi.fn()} onDeleteAttempt={vi.fn()} sessionFlow={sessionFlow} /> }
  return { c, View, timer, modal }
}
function fixture(recognition = false) {
  return fixtureWithData({ ...createEmptyTrainingData(), calibrations: recognition ? [calibration()] : [] })
}
function sessionSetup(): TrainingSetupSnapshot {
  const base = setup()
  return { ...base, generatorAlgorithm: { ...base.generatorAlgorithm, notation: base.generated.targetAlgorithmNotation } }
}
function sessionWithHistory(): TrainingData {
  const prior = { ...sessionSetup(), generatedAt: NOW - 9000 }
  const current = sessionSetup()
  let data = beginTrainingSession(createEmptyTrainingData(), {
    id: 'prior-session', at: NOW - 8000, categoryId: 'oll:execution',
    session: { version: 1, name: 'Prior session', cases: [{ caseId: 'oll:27', algorithm: prior.generatorAlgorithm }] },
  })
  data = appendTrainingAttempt(data, createTrainingAttempt({
    id: 'prior-attempt', setup: prior, visitId: 'prior-session', rawMs: 2000, createdAt: NOW - 7000,
    preferredAlgorithm: prior.generatorAlgorithm, algorithmTracking: true,
  }))
  data = finishTrainingVisit(data, 'prior-session', NOW - 6000, 'manual')
  data = beginTrainingSession(data, {
    id: 'current-session', at: NOW, categoryId: 'oll:execution',
    session: { version: 1, name: 'Focused session', cases: [{ caseId: 'oll:27', algorithm: current.generatorAlgorithm }] },
  })
  return appendTrainingAttempt(data, createTrainingAttempt({
    id: 'current-attempt', setup: current, visitId: 'current-session', rawMs: 1000, createdAt: NOW + 1000,
    preferredAlgorithm: current.generatorAlgorithm, algorithmTracking: true,
  }))
}
describe('Training interface', () => {
  it('opens mode selection without calibration and exposes a labelled shared timer', () => {
    const { View } = fixture(); render(<View />)
    expect(screen.queryByText(/0 \/ 7 accepted/)).not.toBeInTheDocument()
    expect(screen.getByTestId('timer-surface')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Begin training' })).toBeInTheDocument()
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
  it('compares named-session improvement with the full category history', async () => {
    localStorage.setItem(TRAINING_STATISTICS_KEY, JSON.stringify({ 'oll:execution': { visible: ['attempts', 'improvement'] } }))
    const { View, c } = fixtureWithData(sessionWithHistory(), true, async () => sessionSetup())
    render(<View />)
    await act(async () => { c.recover('unknown'); c.resumeSession() })
    expect(await screen.findByTestId('training-stat-row-improvement')).toHaveTextContent('50.0%')
    expect(screen.getByTestId('training-stat-row-attempts')).toHaveTextContent('Total attempts1')
    showOptions('Statistics options')
    fireEvent.click(screen.getByRole('button', { name: 'Detailed statistics' }))
    const breakdown = within(screen.getByRole('dialog', { name: 'Detailed statistics' }))
    const caseRow = breakdown.getByRole('row', { name: /^OLL 27/ })
    expect(caseRow.querySelectorAll('td')[0]).toHaveTextContent('1')
    expect(caseRow).toHaveTextContent('50.0%')
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
