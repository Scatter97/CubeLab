import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/jetbrains-mono'
import './index.css'
import Bootstrap from './bootstrap'
import { SingleTabGate } from './components/SingleTabGate'

// Ownership precedes recovery and all application hooks. Bootstrap then
// resolves interrupted replacements before exposing editable data.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SingleTabGate>
      <Bootstrap />
    </SingleTabGate>
  </StrictMode>,
)
