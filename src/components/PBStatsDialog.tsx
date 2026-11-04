import { createPortal } from 'react-dom'
import { useId } from 'react'
import { useModalDialog } from '../hooks/useModalDialog'
import { formatTime, formatStatValue } from '../lib/format'
import { getEventLabel } from '../lib/events'
import { averageTrimmingLabel } from '../lib/averageTrimming'
import type { buildPBStats } from '../lib/timeTrend'

interface Props {
  id: string
  stats: ReturnType<typeof buildPBStats>
  onClose: () => void
}

/** Read-only details for a selected historical single PB. */
export function PBStatsDialog({ id, stats, onClose }: Props) {
  const { dialogRef, handleKeyDown } = useModalDialog(stats !== null)
  const titleId = useId()
  const descriptionId = useId()
  return createPortal(
    <dialog id={id} ref={dialogRef} className="time-trend-dialog time-trend-pb-dialog" aria-labelledby={titleId} aria-describedby={descriptionId} data-testid="pb-stats-dialog"
      onKeyDown={(event) => { event.stopPropagation(); handleKeyDown(event) }} onKeyUp={(event) => event.stopPropagation()}
      onCancel={(event) => { event.preventDefault(); onClose() }}
      onClick={(event) => { if (event.target === event.currentTarget) onClose() }}>
      {stats && <div className="time-trend-pb-content">
        <header className="time-trend-modal-header">
          <div><h2 id={titleId}>Personal best</h2><p id={descriptionId}>Single PB · Solve #{stats.point.index} · {getEventLabel(stats.point.solve.event)}</p></div>
          <button type="button" className="time-trend-button" onClick={onClose} aria-label="Close PB stats">Close</button>
        </header>
        <div className="time-trend-pb-result">
          <strong data-testid="pb-stats-time">{formatTime(stats.point.singleMs!)}</strong>
          <span>{new Date(stats.point.solve.createdAt).toLocaleString()}</span>
          {stats.improvementMs !== null ? <p data-testid="pb-stats-improvement">{formatTime(stats.improvementMs)} faster than the previous PB{stats.improvementPercent !== null ? ` (${stats.improvementPercent.toFixed(1)}%)` : ''}</p> : <p>First valid solve — the starting PB.</p>}
        </div>
        <dl className="time-trend-pb-summary">
          <div><dt>Previous PB</dt><dd>{stats.previousPB?.singleMs !== null && stats.previousPB?.singleMs !== undefined ? `${formatTime(stats.previousPB.singleMs)} · #${stats.previousPB.index}` : '—'}</dd></div>
          <div><dt>Raw time</dt><dd>{formatTime(stats.point.solve.rawMs)}</dd></div>
          <div><dt>Penalty</dt><dd>{stats.point.solve.penalty === 'none' ? 'None' : stats.point.solve.penalty}</dd></div>
        </dl>
        <section aria-label="Rolling statistics at this solve">
          <h3>Rolling results at this solve</h3>
          <dl className="time-trend-pb-averages">
            {stats.results.map((result) => <div key={result.label}><dt>{result.label}</dt><dd data-testid={`pb-stats-${result.label}`}>{formatStatValue(result.value)}</dd></div>)}
          </dl>
          <p className="time-trend-pb-note">Trim {averageTrimmingLabel(stats.trimming)}. Each window ends at this solve. — means there are not enough solves yet.</p>
        </section>
        <section className="time-trend-pb-solve" aria-label="Solve details">
          <h3>Scramble</h3><p className="time-trend-scramble">{stats.point.solve.scramble || 'No scramble recorded.'}</p>
          {stats.point.solve.comment && <><h3>Notes</h3><p>{stats.point.solve.comment}</p></>}
        </section>
      </div>}
    </dialog>, document.body,
  )
}
