#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  RELEASE_KINDS,
  formatReleaseVersion,
  nextReleaseVersion,
} from './release-lib.mjs'

const root = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '')
const releaseFile = 'src/release.json'
const releasePath = `${root}/${releaseFile}`

const args = process.argv.slice(2)
const kind = args.find((argument) => !argument.startsWith('--'))
const dryRun = args.includes('--dry-run')
const allowDirty = args.includes('--allow-dirty-version')
const unknown = args.filter(
  (argument) =>
    argument !== kind && argument !== '--dry-run' && argument !== '--allow-dirty-version',
)

if (!kind || !RELEASE_KINDS.includes(kind) || unknown.length > 0) {
  console.error(
    'Usage: npm run release:<patch|feature|major> -- [--dry-run] [--allow-dirty-version]',
  )
  process.exit(1)
}

function versionFileIsDirty() {
  for (const arguments_ of [
    ['diff', '--quiet', '--', releaseFile],
    ['diff', '--cached', '--quiet', '--', releaseFile],
  ]) {
    const result = spawnSync('git', arguments_, { cwd: root })
    if (result.status === 1) return true
    if (result.status !== 0) {
      throw new Error(
        `Could not inspect ${releaseFile} with git. Use --allow-dirty-version only if you have verified the release record manually.`,
      )
    }
  }
  return false
}

let current
try {
  current = JSON.parse(readFileSync(releasePath, 'utf8'))
} catch (error) {
  console.error(`Could not read ${releaseFile}: ${error.message}`)
  process.exit(1)
}

let next
try {
  next = nextReleaseVersion(current, kind)
} catch (error) {
  console.error(`Release blocked: ${error.message}`)
  process.exit(1)
}

const previousVersion = formatReleaseVersion(next.previous)
const nextVersion = formatReleaseVersion(next.value)

if (!dryRun && !allowDirty && versionFileIsDirty()) {
  console.error(
    `Release blocked: ${releaseFile} already has uncommitted release changes. Commit or revert that release before creating another one. Use --allow-dirty-version only when this is intentional.`,
  )
  process.exit(1)
}

if (dryRun) {
  console.log(
    `Dry run: ${kind} release ${previousVersion} -> ${nextVersion} (America/Toronto)`,
  )
  console.log(`Would update ${releaseFile}; no files were changed.`)
  process.exit(0)
}

writeFileSync(releasePath, `${JSON.stringify(next.value, null, 2)}\n`)
console.log(`Released ${nextVersion} (was ${previousVersion}).`)
console.log(`Updated ${releaseFile}. Commit and publish this release explicitly.`)
