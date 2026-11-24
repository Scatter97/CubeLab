/**
 * Lazy-route skeletons. They keep the page structure stable while the chart or
 * Training chunks load and deliberately avoid spinner-only loading text.
 */
const ANALYTICS_FILTER_FIELDS = [
  'analytics-filter-field is-event',
  'analytics-filter-field is-kind',
  'analytics-filter-field analytics-multiselect',
  'analytics-filter-field is-date',
  'analytics-filter-field is-limit',
  'analytics-filter-field is-penalty',
] as const

function SkeletonStat({ variant }: { variant: 'hero' | 'detail' }) {
  return (
    <span className={`analytics-stat is-${variant} skeleton-stat`}>
      <span className="skeleton-block is-stat-label" />
      <span className="skeleton-block is-stat-value" />
    </span>
  )
}

export function AnalyticsSkeleton() {
  return (
    <main
      className="analytics-page analytics-skeleton"
      role="status"
      aria-label="Loading analytics"
    >
      <header className="analytics-heading" aria-hidden="true">
        <div className="analytics-heading-copy">
          <span className="skeleton-block is-title" />
          <span className="skeleton-block is-count" />
        </div>
        <div className="analytics-heading-actions">
          <span className="analytics-action skeleton-action">
            <span className="skeleton-block is-action-fill" />
          </span>
          <span className="analytics-action skeleton-action">
            <span className="skeleton-block is-action-fill is-short" />
          </span>
        </div>
      </header>

      <span
        className="analytics-action analytics-filters-toggle skeleton-filters-toggle"
        aria-hidden="true"
      >
        <span className="skeleton-block is-filters-fill" />
      </span>

      <section className="analytics-filters skeleton-filters" aria-hidden="true">
        <div className="analytics-filter-controls">
          {ANALYTICS_FILTER_FIELDS.map((field) => (
            <span className={`skeleton-filter ${field}`} key={field}>
              <span className="skeleton-block is-filter-label" />
              <span className="skeleton-block is-filter-control" />
            </span>
          ))}
          <span className="analytics-reset-filters skeleton-reset">
            <span className="skeleton-block is-reset" />
          </span>
        </div>
      </section>

      <section
        className="analytics-section is-wide skeleton-overview"
        aria-hidden="true"
      >
        <header className="analytics-section-header">
          <div className="analytics-section-heading">
            <span className="skeleton-block is-section-title" />
            <span className="skeleton-block is-section-meta" />
          </div>
        </header>
        <div className="analytics-overview">
          <div className="analytics-overview-hero">
            {[0, 1, 2, 3, 4].map((index) => (
              <SkeletonStat variant="hero" key={index} />
            ))}
          </div>
          <div className="analytics-overview-detail" data-count="10">
            {Array.from({ length: 10 }, (_, index) => (
              <SkeletonStat variant="detail" key={index} />
            ))}
          </div>
        </div>
      </section>

      <div className="analytics-analysis-layout" aria-hidden="true">
        <div className="analytics-analysis-nav">
          <div className="analytics-analysis-nav-heading">
            <span className="skeleton-block is-nav-heading" />
          </div>
          <div className="analytics-analysis-tabs">
            {Array.from({ length: 9 }, (_, index) => (
              <span
                className={`skeleton-tab${index === 0 ? ' is-selected' : ''}`}
                key={index}
              >
                <span className="skeleton-block is-tab-label" />
              </span>
            ))}
          </div>
          <div className="analytics-analysis-mobile-select">
            <span className="skeleton-block is-filter-label" />
            <span className="skeleton-block is-filter-control" />
          </div>
        </div>
        <div className="analytics-analysis-content">
          <section className="analytics-section skeleton-analysis-panel">
            <header className="analytics-section-header">
              <span className="skeleton-block is-section-title" />
            </header>
            <div className="analytics-chart-stack">
              <div className="analytics-chart-toolbar skeleton-chart-toolbar">
                {Array.from({ length: 8 }, (_, index) => (
                  <span className="skeleton-block is-chip" key={index} />
                ))}
              </div>
              <div className="analytics-chart">
                <span className="skeleton-block is-chart is-analytics-chart" />
              </div>
            </div>
          </section>
        </div>
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
