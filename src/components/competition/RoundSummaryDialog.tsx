import type {
  CompetitionFormat,
  StatPrecision,
} from '../../types'
import {
  competitionFormatLabel,
  competitionRoundResultLabel,
  getCompetitionRoundSummary,
  type CompetitionRound,
} from '../../lib/competition'
import { formatSolveTime, formatStatValue } from '../../lib/format'
import { useModalDialog } from '../../hooks/useModalDialog'
import { CloseIcon } from '../Icons'

interface RoundSummaryDialogProps {
  round: CompetitionRound | null
  rounds: readonly CompetitionRound[]
  format: CompetitionFormat
  precision: StatPrecision
  onClose: () => void
}

function signedDelta(ms: number): string {
  const seconds = (Math.abs(ms) / 1_000).toFixed(2)
  return `${ms >= 0 ? '+' : '−'}${seconds}`
}

/**
 * Post-round summary. It is presentation only: the saved solve remains the
 * source of truth and the dialog never triggers another write.
 */
export function RoundSummaryDialog({
  round,
  rounds,
  format,
  precision,
  onClose,
}: RoundSummaryDialogProps) {
  const { dialogRef, handleKeyDown } = useModalDialog(round !== null)
  const summary = getCompetitionRoundSummary(rounds)
  const best = summary.best
  const currentMs =
    round?.result?.status === 'value' ? round.result.ms : null
  const bestMs = best?.result?.status === 'value' ? best.result.ms : null
  const delta =
    currentMs !== null && bestMs !== null ? currentMs - bestMs : null

  return (
    <dialog
      ref={dialogRef}
      className="confirm-dialog competition-round-dialog"
      aria-labelledby="competition-round-summary-title"
      aria-describedby="competition-round-summary-description"
      data-testid="competition-round-summary"
      onKeyDown={handleKeyDown}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      onClick={(event) => {
        if (event.target === dialogRef.current) onClose()
      }}
    >
      {round ? (
        <div className="dialog-content competition-round-summary-content">
          <header className="settings-header">
            <div>
              <p className="competition-round-eyebrow">
                {competitionFormatLabel(format)} round complete
              </p>
              <h2 id="competition-round-summary-title">
                Round {round.number}
              </h2>
              <p
                id="competition-round-summary-description"
                className="session-settings-meta"
              >
                {competitionRoundResultLabel(round, format, precision)}
                {delta !== null
                  ? delta === 0
                    ? ' · Matches the session best'
                    : ` · ${signedDelta(delta)} vs session best`
                  : ''}
              </p>
            </div>
            <button
              type="button"
              className="icon-button settings-close"
              aria-label="Close round summary"
              title="Close round summary"
              onClick={onClose}
            >
              <CloseIcon size={16} />
            </button>
          </header>

          <div className="competition-round-summary-body">
            <table className="competition-attempt-table">
              <caption className="sr-only">
                Attempts in Round {round.number}
              </caption>
              <thead>
                <tr>
                  <th scope="col">Attempt</th>
                  <th scope="col">Result</th>
                  <th scope="col">Note</th>
                </tr>
              </thead>
              <tbody>
                {round.attempts.map((attempt, index) => {
                  const time = formatSolveTime(
                    attempt.solve.rawMs,
                    attempt.solve.penalty,
                  )
                  const note = attempt.best
                    ? 'Best'
                    : attempt.trimmed === 'better'
                      ? 'Trimmed best'
                      : attempt.trimmed === 'worse'
                        ? 'Trimmed worst'
                        : ''
                  const comment = attempt.solve.comment
                  return (
                    <tr
                      key={attempt.solve.id}
                      data-testid={`competition-summary-attempt-${index + 1}`}
                    >
                      <th scope="row">
                        {attempt.solve.roundIndex !== undefined
                          ? attempt.solve.roundIndex + 1
                          : index + 1}
                      </th>
                      <td>
                        {time.display}
                        {time.suffix ? (
                          <span className="time-suffix">{time.suffix}</span>
                        ) : null}
                      </td>
                      <td>
                        <span className="competition-attempt-note">
                          {comment ? (
                            <span
                              className="competition-attempt-comment"
                              title={comment}
                            >
                              {comment}
                            </span>
                          ) : null}
                          {note ? (
                            <span className="competition-attempt-flag">
                              {note}
                            </span>
                          ) : null}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>

            <div className="competition-round-comparison" role="status">
              <span>This round</span>
              <strong>{competitionRoundResultLabel(round, format, precision)}</strong>
              <span>
                Session best
                {best ? ` · Round ${best.number}` : ''}
              </span>
              <strong>
                {best
                  ? formatStatValue(best.result, precision)
                  : '—'}
              </strong>
            </div>
          </div>

          <footer className="session-settings-footer">
            <button
              type="button"
              className="button button-primary"
              autoFocus
              onClick={onClose}
            >
              Done
            </button>
          </footer>
        </div>
      ) : null}
    </dialog>
  )
}
