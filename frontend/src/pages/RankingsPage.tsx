import { useEffect, useState } from 'react'
import { NavLink, useNavigate, useParams, useSearchParams, useLocation } from 'react-router-dom'
import { ExternalLink } from 'lucide-react'
import { api } from '../lib/api'
import posthog from '../lib/posthog'

type RankItem = {
  id: string
  primary: string
  primaryCode: string | null
  secondary: string | null
  rating: number | null
  difficulty: number | null
  workload: number | null
  reviewCount: number
  variation: number | null
}

type EntityKey = 'classes' | 'professors' | 'departments' | 'schools'

const ENTITIES: { key: EntityKey; tab: string; noun: string; primaryCol: string; secondaryCol: string | null }[] = [
  { key: 'classes', tab: 'Classes', noun: 'Classes', primaryCol: 'Course', secondaryCol: 'Department' },
  { key: 'professors', tab: 'Professors', noun: 'Professors', primaryCol: 'Professor', secondaryCol: 'Department' },
  { key: 'departments', tab: 'Departments', noun: 'Departments', primaryCol: 'Department', secondaryCol: 'School' },
  { key: 'schools', tab: 'Schools', noun: 'Schools', primaryCol: 'School', secondaryCol: null },
]

// rating/difficulty/workload are ranked by a Bayesian-adjusted score, so their
// selector/heading say "Adjusted …"; the value columns (col) still show the raw
// average. reviews/variation sort by raw values and aren't relabeled.
const METRICS: { key: string; pill: string; heading: string; col: string }[] = [
  { key: 'rating', pill: 'Adjusted Overall Rating', heading: 'Adjusted Overall Rating', col: 'Overall Rating' },
  { key: 'difficulty', pill: 'Adjusted Difficulty', heading: 'Adjusted Difficulty', col: 'Difficulty' },
  { key: 'workload', pill: 'Adjusted Workload', heading: 'Adjusted Workload', col: 'Workload' },
  { key: 'reviews', pill: 'Eval Count', heading: 'Eval Count', col: 'Evals' },
  { key: 'variation', pill: 'Rating Variation', heading: 'Rating Variation', col: 'Variation' },
]

const MIN_EVAL_OPTIONS = [
  { label: '10+ evals', value: 10 },
  { label: '15+ evals', value: 15 },
  { label: '20+ evals', value: 20 },
  { label: 'All with data', value: 0 },
]

const DEFAULT_MIN_EVALS = 10

// Credits filter (classes only). Default 3; 'all' clears it. Value matches the
// string stored in the URL ('1'..'4' or 'all').
const DEFAULT_CREDITS = 3
const CREDIT_OPTIONS = [
  { label: '1 Credit', value: '1' },
  { label: '2 Credits', value: '2' },
  { label: '3 Credits', value: '3' },
  { label: '4 Credits', value: '4' },
  { label: 'All Credits', value: 'all' },
]

// Student-level filter (classes only). Default Undergraduate; 'all' (the "Both"
// option) clears it. 'Undergraduate'/'Graduate' match that level plus
// cross-listed 'Both' sections server-side.
const DEFAULT_STUDENT_LEVEL = 'Undergraduate'
const STUDENT_LEVEL_OPTIONS = [
  { label: 'Undergraduate', value: 'Undergraduate' },
  { label: 'Graduate', value: 'Graduate' },
  { label: 'Both', value: 'all' },
]

const PAGE_SIZE = 25

const fmt2 = (v: number | null) => (v === null ? '—' : v.toFixed(2))

// Avg weekly-hours rating (1–5) → a friendly workload label.
const workloadLabel = (v: number | null) => {
  if (v === null) return '—'
  if (v >= 3.5) return 'Heavy'
  if (v >= 2.3) return 'Moderate'
  return 'Light'
}

export default function RankingsPage() {
  const { entity: entityParam } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()

  const entity = (ENTITIES.find((e) => e.key === entityParam) ?? ENTITIES[0])

  // Professors hide the difficulty/workload metrics and can't reverse the order
  // (always highest-first). Other entities keep the full set of controls.
  const visibleMetrics =
    entity.key === 'professors'
      ? METRICS.filter((m) => m.key !== 'difficulty' && m.key !== 'workload')
      : METRICS
  const requestedMetric = METRICS.find((m) => m.key === searchParams.get('metric'))?.key ?? 'rating'
  const metricKey = visibleMetrics.some((m) => m.key === requestedMetric) ? requestedMetric : 'rating'
  const order = entity.key === 'professors' ? 'desc' : searchParams.get('order') === 'asc' ? 'asc' : 'desc'
  const minEvals = Number(searchParams.get('minEvals') ?? DEFAULT_MIN_EVALS)
  const metric = METRICS.find((m) => m.key === metricKey)!

  // Credits filter applies to the classes ranking only. Absent = default 3;
  // 'all' = no filter (null); otherwise the number.
  const credits: number | null =
    searchParams.get('credits') === null
      ? DEFAULT_CREDITS
      : searchParams.get('credits') === 'all'
      ? null
      : Number(searchParams.get('credits'))

  // Student-level filter (classes only). Absent = default Undergraduate; 'all' =
  // no filter (the "Both" option).
  const studentLevel = searchParams.get('studentLevel') ?? DEFAULT_STUDENT_LEVEL

  const [items, setItems] = useState<RankItem[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)

  const apiUrl = (offset: number) => {
    const creditsQ = entity.key === 'classes' && credits !== null ? `&credits=${credits}` : ''
    const levelQ =
      entity.key === 'classes' && studentLevel !== 'all' ? `&studentLevel=${studentLevel}` : ''
    return api(
      `/api/rankings/${entity.key}?metric=${metricKey}&order=${order}&minEvals=${minEvals}${creditsQ}${levelQ}&limit=${PAGE_SIZE}&offset=${offset}`
    )
  }

  // Refetch from scratch whenever the entity or any ranking control changes.
  useEffect(() => {
    let active = true
    setLoading(true)
    fetch(apiUrl(0))
      .then((r) => r.json())
      .then((data: { items: RankItem[]; hasMore: boolean }) => {
        if (!active) return
        setItems(data.items)
        setHasMore(data.hasMore)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [entity.key, metricKey, order, minEvals, credits, studentLevel])

  const loadMore = () => {
    setLoadingMore(true)
    fetch(apiUrl(items.length))
      .then((r) => r.json())
      .then((data: { items: RankItem[]; hasMore: boolean }) => {
        setItems((prev) => [...prev, ...data.items])
        setHasMore(data.hasMore)
      })
      .finally(() => setLoadingMore(false))
  }

  // Update one query param, keeping the rest.
  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams)
    next.set(key, value)
    setSearchParams(next)
  }

  const hrefFor = (item: RankItem): string => {
    switch (entity.key) {
      case 'classes':
        return '/courses/' + encodeURIComponent(item.primaryCode ?? item.id)
      case 'professors':
        return '/professors/' + encodeURIComponent(item.id)
      case 'departments':
        return '/departments/' + encodeURIComponent(item.id)
      case 'schools':
        return '/schools/' + encodeURIComponent(item.id)
    }
  }

  const metricCell = (item: RankItem) => {
    switch (metricKey) {
      case 'rating':
        return <span className="rank-badge">{fmt2(item.rating)}</span>
      case 'difficulty':
        return <span className="rank-badge">{fmt2(item.difficulty)}</span>
      case 'variation':
        return (
          <span className="rank-badge">
            {item.variation === null ? '—' : `±${item.variation.toFixed(2)}`}
          </span>
        )
      case 'workload':
        return <span className="rank-badge">{workloadLabel(item.workload)}</span>
      case 'reviews':
        return <span className="rank-badge">{item.reviewCount.toLocaleString()}</span>
      default:
        return null
    }
  }

  return (
    <main className="rankings">
      <div className="container--fluid">
        <h1 className="rankings__title">Rankings &amp; Insights</h1>
        <p className="rankings__sub">
          Explore how BC classes, professors, departments, and schools compare based on
          student course evaluations.
        </p>

        {/* Entity tabs — keep the current query string when switching */}
        <nav className="rtabs">
          {ENTITIES.map((e) => (
            <NavLink
              key={e.key}
              to={`/rankings/${e.key}${location.search}`}
              className={'rtab' + (e.key === entity.key ? ' active' : '')}
            >
              {e.tab}
            </NavLink>
          ))}
        </nav>

        {/* Metric pills */}
        <div className="rpills">
          {visibleMetrics.map((m) => (
            <button
              key={m.key}
              type="button"
              className={'pill' + (m.key === metricKey ? ' pill--active' : '')}
              onClick={() => {
                posthog.capture('ranking_metric_selected', {
                  entity_type: entity.key,
                  metric: m.key,
                })
                setParam('metric', m.key)
              }}
            >
              {m.pill}
            </button>
          ))}
        </div>

        {/* Results card */}
        <div className="card rankings__card">
          <div className="rankings__head">
            <div>
              <h2 className="rankings__h2">
                {entity.noun} by {metric.heading}
              </h2>
              <div className="rankings__count">
                Showing {order === 'desc' ? 'highest' : 'lowest'} {metric.heading.toLowerCase()} first
              </div>
            </div>
            <div className="rankings__controls">
              {entity.key === 'classes' && (
                <select
                  className="rankings__select"
                  value={credits === null ? 'all' : String(credits)}
                  onChange={(e) => setParam('credits', e.target.value)}
                >
                  {CREDIT_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              )}
              {entity.key === 'classes' && (
                <select
                  className="rankings__select"
                  value={studentLevel}
                  onChange={(e) => setParam('studentLevel', e.target.value)}
                >
                  {STUDENT_LEVEL_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              )}
              <select
                className="rankings__select"
                value={minEvals}
                onChange={(e) => setParam('minEvals', e.target.value)}
              >
                {MIN_EVAL_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              {entity.key !== 'professors' && (
                <select
                  className="rankings__select"
                  value={order}
                  onChange={(e) => setParam('order', e.target.value)}
                >
                  <option value="desc">Order: Highest to Lowest</option>
                  <option value="asc">Order: Lowest to Highest</option>
                </select>
              )}
            </div>
          </div>

          <div className="rank-table-wrap">
            <table className="rank-table">
              <thead>
                <tr>
                  <th>Rank</th>
                  <th>{entity.primaryCol}</th>
                  {entity.secondaryCol && <th>{entity.secondaryCol}</th>}
                  <th>{metric.col}</th>
                  <th>{metricKey === 'rating' ? 'Workload' : 'Overall Rating'}</th>
                  <th>Evaluations</th>
                  <th className="rank-table__action">Action</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, i) => (
                  <tr key={item.id}>
                    <td className="rank-num">{String(i + 1).padStart(2, '0')}</td>
                    <td>
                      {entity.key === 'classes' && item.primaryCode && (
                        <div className="rank-code">{item.primaryCode}</div>
                      )}
                      <div className="rank-primary">{item.primary}</div>
                    </td>
                    {entity.secondaryCol && <td className="rank-secondary">{item.secondary ?? '—'}</td>}
                    <td>{metricCell(item)}</td>
                    <td className="rank-secondary">
                      {metricKey === 'rating' ? workloadLabel(item.workload) : fmt2(item.rating)}
                    </td>
                    <td className="rank-secondary">{item.reviewCount.toLocaleString()}</td>
                    <td className="rank-table__action">
                      <button type="button" className="rank-view" onClick={() => navigate(hrefFor(item))}>
                        View <ExternalLink size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {loading && <p className="placeholder-note">Loading…</p>}
            {!loading && items.length === 0 && (
              <p className="placeholder-note">No rankings match these filters.</p>
            )}
          </div>

          {hasMore && (
            <div className="rankings__more">
              <button type="button" className="btn--outline" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? 'Loading…' : 'Load More Rankings'}
              </button>
            </div>
          )}
        </div>
      </div>
    </main>
  )
}
