import { useMemo } from 'react'
import type { CompetitionFormat, StatPrecision } from '../../types'
import {
  competitionFormatLabel,
  competitionRoundResultLabel,
  getCompetitionRoundSummary,
  type CompetitionRound,
} from '../../lib/competition'

interface CompetitionRoundsProps {
  format: CompetitionFormat
  rounds: readonly CompetitionRound[]
  precision: StatPrecision
}

/**
 * Compact per-session round list for the Statistics rail. The full round
 * history stays available while the fixed Latest/Best/DNF summary keeps the
 * common comparison visible without opening another dialog.
 */
export function CompetitionRounds({
  format,
  rounds,
  precision,
}: CompetitionRoundsProps) {
  const summary = useMemo(() => getCompetitionRoundSummary(rounds), [rounds])
  if (rounds.length === 0) return null

  const latestId = summary.latest?.id
  const bestId = summary.best?.id
  const dnfIds = new Set(summary.dnfRounds.map((round) => round.id))

  return (
    <section
      className="competition-round-list"
      aria-label={`${competitionFormatLabel(format)} rounds`}
      data-testid="competition-round-list"
    >
      <div className="competition-round-heading">
        <h3>Rounds</h3>
        <span>
          {rounds.length} {rounds.length === 1 ? 'round' : 'rounds'}
        </span>
      </div>
      <ol>
        {[...rounds].reverse().map((round) => {
          const tags = [
            round.id === latestId ? 'Latest' : null,
            round.id === bestId ? 'Best' : null,
            dnfIds.has(round.id) ? 'DNF' : null,
          ].filter((tag): tag is string => tag !== null)
          return (
            <li
              key={round.id}
              data-testid={`competition-stat-round-${round.number}`}
              className={
                round.complete
                  ? 'competition-round-row'
                  : 'competition-round-row is-incomplete'
              }
            >
              <span className="competition-round-name">
                Round {round.number}
              </span>
              <span className="competition-round-result">
                {competitionRoundResultLabel(round, format, precision)}
              </span>
              <span className="competition-round-tags">
                {tags.map((tag) => (
                  <span key={tag} className={`competition-round-tag is-${tag.toLowerCase()}`}>
                    {tag}
                  </span>
                ))}
              </span>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
