import { STANDARD_CASE_BY_ID } from '../../lib/training/catalog/standardCases'
// URL imports preserve the approved SVG bytes; no runtime rendering/generation.
const assets = import.meta.glob('../../assets/training/diagrams/**/*.svg', { eager: true, query: '?url', import: 'default' }) as Record<string, string>
export function CaseDiagram({ caseId, size = 64, decorative = false }: { caseId: string; size?: number; decorative?: boolean }) {
  const definition = STANDARD_CASE_BY_ID.get(caseId)
  const src = definition?.diagramAsset ? assets[`../../assets/${definition.diagramAsset}`] : undefined
  return src ? <img src={src} width={size} height={size} alt={decorative ? '' : `${definition!.name} case diagram`} className="training-diagram" /> : null
}
