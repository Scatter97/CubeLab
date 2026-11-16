export async function copyText(text: string, container = document.body): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const area = document.createElement('textarea')
      area.value = text
      area.setAttribute('readonly', '')
      area.style.position = 'fixed'
      area.style.opacity = '0'
      const focused = document.activeElement
      container.append(area)
      try {
        area.select()
        return document.execCommand('copy')
      } finally {
        area.remove()
        if (focused instanceof HTMLElement) focused.focus({ preventScroll: true })
      }
    } catch {
      return false
    }
  }
}
