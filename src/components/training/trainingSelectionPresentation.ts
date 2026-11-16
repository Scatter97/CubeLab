export function selectedTrainingCasesLabel(count: number) {
  return `${count} ${count === 1 ? 'case' : 'cases'} selected`
}

export function trainingSelectionMessage(count: number, eligible: number, recognition: boolean) {
  const required = recognition ? 2 : 1
  return count < required
    ? (required === 2 ? 'Select at least two cases for recognition.' : 'Select a case for execution.')
    : eligible < required ? 'Select more cases with usable algorithms.'
    : eligible < count ? 'Some selected cases need an algorithm.' : null
}
