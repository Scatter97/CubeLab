import type { TrainingController } from '../../lib/training/controller'

export function downloadTrainingRecovery(controller: TrainingController) {
  const url = URL.createObjectURL(new Blob([controller.exportRecovery()], { type: 'application/json' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = 'cubelab-training-recovery.json'
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
