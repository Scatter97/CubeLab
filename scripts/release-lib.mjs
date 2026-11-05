export const RELEASE_TIME_ZONE = 'America/Toronto'
export const RELEASE_KINDS = ['patch', 'feature', 'major']

function assertReleaseInteger(value, name) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer.`)
  }
}

export function parseReleaseRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Release record must be an object.')
  }
  assertReleaseInteger(value.major, 'major')
  assertReleaseInteger(value.feature, 'feature')
  assertReleaseInteger(value.patch, 'patch')
  if (typeof value.date !== 'string' || !/^\d{6}$/.test(value.date)) {
    throw new Error('date must use the YYMMDD format.')
  }
  return {
    major: value.major,
    feature: value.feature,
    date: value.date,
    patch: value.patch,
  }
}

export function formatTorontoDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: RELEASE_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const part = (type) => parts.find((entry) => entry.type === type)?.value
  const year = part('year')
  const month = part('month')
  const day = part('day')
  if (!year || !month || !day) {
    throw new Error('Could not determine the Toronto release date.')
  }
  return `${year.slice(-2)}${month}${day}`
}

export function formatReleaseVersion(value) {
  const release = parseReleaseRecord(value)
  return `${release.major}.${String(release.feature).padStart(2, '0')}.${release.date}:${release.patch}`
}

export function nextReleaseVersion(currentValue, kind, now = new Date()) {
  const current = parseReleaseRecord(currentValue)
  if (!RELEASE_KINDS.includes(kind)) {
    throw new Error(`Release kind must be one of: ${RELEASE_KINDS.join(', ')}.`)
  }

  const date = formatTorontoDate(now)
  if (date < current.date) {
    throw new Error(
      `Release date ${date} is earlier than the current release date ${current.date}. Check the system clock.`,
    )
  }

  if (kind === 'major') {
    return {
      value: {
        major: current.major + 1,
        feature: 0,
        date,
        patch: 0,
      },
      previous: current,
    }
  }

  if (kind === 'feature') {
    return {
      value: {
        major: current.major,
        feature: current.feature + 1,
        date,
        patch: 0,
      },
      previous: current,
    }
  }

  return {
    value: {
      major: current.major,
      feature: current.feature,
      date,
      patch: current.patch + 1,
    },
    previous: current,
  }
}
