/**
 * Lazy-route skeletons. They keep the page structure stable while the chart or
 * Training chunks load and deliberately avoid spinner-only loading text.
 */
export function AnalyticsSkeleton() {
  return (
    <main
      className="analytics-page analytics-loading analytics-skeleton"
      role="status"
      aria-label="Loading analytics"
    >
      <div className="skeleton-heading">
        <span className="skeleton-block is-title" />
        <span className="skeleton-block is-action" />
      </div>
      <div className="skeleton-card-grid">
        {Array.from({ length: 6 }, (_, index) => (
          <span className="skeleton-block is-card" key={index} />
        ))}
      </div>
      <div className="skeleton-panel">
        <span className="skeleton-block is-chart" />
      </div>
    </main>
  )
}

export function TrainingSkeleton() {
  return (
    <main
      className="training-workspace training-skeleton"
      role="status"
      aria-label="Loading training"
    >
      <div className="primary-column">
        <div className="skeleton-panel is-timer">
          <span className="skeleton-block is-timer-readout" />
        </div>
        <span className="skeleton-block is-caption" />
      </div>
      <aside className="side-column" aria-hidden="true">
        <span className="skeleton-block is-card" />
        <span className="skeleton-block is-chart" />
      </aside>
    </main>
  )
}
