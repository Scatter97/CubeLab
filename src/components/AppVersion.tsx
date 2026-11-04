import { CUBELAB_VERSION } from '../lib/version'

export function AppVersion() {
  return (
    <span
      className="app-version"
      data-testid="app-version"
      title={`CubeLab ${CUBELAB_VERSION}`}
      aria-label={`CubeLab version ${CUBELAB_VERSION}`}
    >
      {CUBELAB_VERSION}
    </span>
  )
}
