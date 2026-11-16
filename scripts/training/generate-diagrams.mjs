/**
 * CubeLab Training — static case-diagram generator.
 *
 * Development-time only. Usage:
 *
 *   node scripts/training/generate-diagrams.mjs --preview
 *   node scripts/training/generate-diagrams.mjs --preview --check
 *   node scripts/training/generate-diagrams.mjs --all
 *   node scripts/training/generate-diagrams.mjs --all --check
 *
 * `--preview` generates the ten owner-review diagrams. `--all` generates all 78
 * standard OLL/PLL assets after the visual style is approved. `--check` writes
 * nothing and fails if committed output differs from deterministic output.
 *
 * The generator reads the repository case table and the existing cubing.js
 * cube-state model. It never copies third-party algorithms or artwork.
 */

import fs from 'node:fs'
import path from 'node:path'
import { createServer } from 'vite'
import {
  renderContactSheet,
  renderDiagramSvg,
} from './renderDiagram.mjs'

const ROOT = process.cwd()
const CONTACT_SHEET_PATH = path.join(
  ROOT,
  'docs/training/previews/phase-2c-diagrams.html',
)
const ALL_CONTACT_SHEET_PATH = path.join(
  ROOT,
  'docs/training/previews/phase-2c-all-diagrams.html',
)

const PREVIEW_OLL_NUMBERS = [1, 27, 45, 56, 57]
const PREVIEW_PLL_IDS = ['pll:ua', 'pll:t', 'pll:gc', 'pll:h', 'pll:z']

function usage() {
  return [
    'Usage: node scripts/training/generate-diagrams.mjs [--preview|--all] [--check]',
    '',
    '  --preview   generate the ten representative diagrams (default)',
    '  --all       generate all 78 standard OLL/PLL diagrams',
    '  --check     verify committed output matches deterministic generation',
    '  --dry-run   build and render in memory without writing files',
  ].join('\n')
}

function parseArgs(argv) {
  let mode = 'preview'
  let check = false
  let dryRun = false
  for (const argument of argv) {
    if (argument === '--preview') mode = 'preview'
    else if (argument === '--all') mode = 'all'
    else if (argument === '--check') check = true
    else if (argument === '--dry-run') dryRun = true
    else if (argument === '--help' || argument === '-h') {
      console.log(usage())
      process.exit(0)
    } else {
      throw new Error(`Unknown argument "${argument}".\n\n${usage()}`)
    }
  }
  if (check && dryRun) {
    throw new Error('--check and --dry-run cannot be combined.')
  }
  return { mode, check, dryRun }
}

function previewDefinitions(standard) {
  const definitions = [
    ...PREVIEW_OLL_NUMBERS.map((number) => {
      const definition = standard.OLL_STANDARD_CASE_BY_ID.get(`oll:${number}`)
      if (!definition) throw new Error(`Missing preview OLL ${number}.`)
      return definition
    }),
    ...PREVIEW_PLL_IDS.map((id) => {
      const definition = standard.PLL_NAMED_CASE_BY_ID.get(id)
      if (!definition) throw new Error(`Missing preview PLL ${id}.`)
      return definition
    }),
  ]
  if (definitions.length !== 10) {
    throw new Error(`Preview set must contain 10 cases, found ${definitions.length}.`)
  }
  return definitions
}

function writeOrCheck(filePath, content, check, dryRun) {
  if (dryRun) return null
  if (!check) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, content)
    return null
  }
  if (!fs.existsSync(filePath)) {
    return `Missing generated file ${path.relative(ROOT, filePath)}.`
  }
  const actual = fs.readFileSync(filePath, 'utf8')
  if (actual !== content) {
    return `Generated output differs at ${path.relative(ROOT, filePath)}.`
  }
  return null
}

async function main() {
  const { mode, check, dryRun } = parseArgs(process.argv.slice(2))
  const server = await createServer({
    root: ROOT,
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'silent',
  })

  try {
    const standard = await server.ssrLoadModule(
      '/src/lib/training/catalog/standardCases.ts',
    )
    const diagrams = await server.ssrLoadModule(
      '/src/lib/training/diagrams/buildDiagramSpec.ts',
    )
    const cube = await server.ssrLoadModule('/src/lib/training/cube3.ts')

    standard.assertValidStandardCaseTable()
    const model = await cube.loadCube3Model()
    const definitions =
      mode === 'preview' ? previewDefinitions(standard) : standard.STANDARD_CASES

    const specs = definitions.map((definition) =>
      diagrams.buildDiagramSpec(model, definition),
    )

    const ids = new Set()
    const assets = new Set()
    for (const spec of specs) {
      if (ids.has(spec.caseId)) {
        throw new Error(`Duplicate diagram case ${spec.caseId}.`)
      }
      if (assets.has(spec.asset)) {
        throw new Error(`Duplicate diagram asset ${spec.asset}.`)
      }
      ids.add(spec.caseId)
      assets.add(spec.asset)
    }

    const problems = []
    for (const spec of specs) {
      const svg = renderDiagramSvg(spec)
      const outputPath = path.join(ROOT, 'src/assets', spec.asset)
      const problem = writeOrCheck(outputPath, svg, check, dryRun)
      if (problem) problems.push(problem)
    }

    if (mode === 'preview') {
      const contactSheet = renderContactSheet(specs)
      const problem = writeOrCheck(
        CONTACT_SHEET_PATH,
        contactSheet,
        check,
        dryRun,
      )
      if (problem) problems.push(problem)
    } else {
      const contactSheet = renderContactSheet(specs, { fullCollection: true })
      const problem = writeOrCheck(
        ALL_CONTACT_SHEET_PATH,
        contactSheet,
        check,
        dryRun,
      )
      if (problem) problems.push(problem)
    }

    if (problems.length > 0) {
      throw new Error(
        `Diagram ${check ? 'check' : 'generation'} failed:\n${problems.join('\n')}`,
      )
    }

    console.log(
      `${dryRun ? 'Rendered' : check ? 'Verified' : 'Generated'} ${specs.length} ${mode} diagram(s) ${dryRun ? 'in memory (no files written)' : `with a ${mode === 'preview' ? 'preview' : 'complete'} contact sheet`}.`,
    )
    console.log(
      path.relative(
        ROOT,
        mode === 'preview' ? CONTACT_SHEET_PATH : ALL_CONTACT_SHEET_PATH,
      ),
    )
  } finally {
    await server.close()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
