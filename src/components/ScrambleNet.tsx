import type { CubeFace, CubeNet } from '../lib/cubeNet'
import { CUBE_FACES } from '../lib/cubeNet'

const FACE_FILL: Record<CubeFace, string> = {
  U: 'var(--cube-face-u)',
  D: 'var(--cube-face-d)',
  F: 'var(--cube-face-f)',
  B: 'var(--cube-face-b)',
  R: 'var(--cube-face-r)',
  L: 'var(--cube-face-l)',
}

/** Top-left cell of each face in the standard U / L F R B / D net. */
const FACE_ORIGIN: Record<CubeFace, { col: number; row: number }> = {
  U: { col: 1, row: 0 },
  L: { col: 0, row: 1 },
  F: { col: 1, row: 1 },
  R: { col: 2, row: 1 },
  B: { col: 3, row: 1 },
  D: { col: 1, row: 2 },
}

/** Gap between faces, measured in sticker widths. */
const FACE_GAP = 0.55
const STICKER_GAP = 0.045

interface Props {
  net: CubeNet
  className?: string
}

/**
 * Compact unfolded net. Sticker colours come from the simulated scramble
 * state, while face centres keep the standard U/D/F/B/R/L colours.
 */
export function ScrambleNet({ net, className }: Props) {
  const { size, faces } = net
  const width = 4 * size + 3 * FACE_GAP
  const height = 3 * size + 2 * FACE_GAP

  return (
    <svg
      className={`scramble-net${className ? ` ${className}` : ''}`}
      viewBox={`0 0 ${width} ${height}`}
      width={width * 100}
      height={height * 100}
      role="img"
      aria-label={`2D cube net for the current ${size} by ${size} scramble`}
      data-testid="scramble-net"
      data-size={size}
    >
      {CUBE_FACES.map((face) => {
        const origin = FACE_ORIGIN[face]
        const offsetX = origin.col * (size + FACE_GAP)
        const offsetY = origin.row * (size + FACE_GAP)

        return (
          <g key={face} data-face={face}>
            {faces[face].map((row, rowIndex) =>
              row.map((sticker, colIndex) => (
                <rect
                  key={`${rowIndex}-${colIndex}`}
                  data-sticker={sticker}
                  x={offsetX + colIndex + STICKER_GAP / 2}
                  y={offsetY + rowIndex + STICKER_GAP / 2}
                  width={1 - STICKER_GAP}
                  height={1 - STICKER_GAP}
                  rx={0.08}
                  fill={FACE_FILL[sticker]}
                  stroke="var(--cube-net-line)"
                  strokeWidth={0.04}
                />
              )),
            )}
          </g>
        )
      })}
    </svg>
  )
}
