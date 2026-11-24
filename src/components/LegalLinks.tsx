interface LegalLinksProps {
  className?: string
}

/**
 * Shared legal destinations. The pages are standalone static HTML; opening them
 * in a new tab never loads the app or takes its single-active-tab lock.
 */
export function LegalLinks({ className }: LegalLinksProps) {
  return (
    <nav
      className={className ? `legal-links ${className}` : 'legal-links'}
      aria-label="Legal"
    >
      <a href="/privacy" target="_blank" rel="noopener noreferrer">
        Privacy Policy
      </a>
      <span className="legal-links-separator" aria-hidden="true">
        ·
      </span>
      <a href="/terms" target="_blank" rel="noopener noreferrer">
        Terms of Service
      </a>
    </nav>
  )
}
