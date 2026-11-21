interface BetaBadgeProps {
  className?: string
}

export function BetaBadge({ className }: BetaBadgeProps) {
  return (
    <span className={className ? `beta-badge ${className}` : 'beta-badge'}>
      Beta
    </span>
  )
}
