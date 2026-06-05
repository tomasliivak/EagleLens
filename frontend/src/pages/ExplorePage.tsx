import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import {
  Star,
  SlidersHorizontal,
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  Search,
  X,
} from 'lucide-react'

type ExploreCourse = {
  courseCode: string
  title: string | null
  bestInstructorName: string | null
  bestInstructorRating: number | null
  avgRating: number | null
  reviewCount: number
  difficulty: number | null
  avgWorkload: number | null
  coreRequirements: string[]
  source: 'current' | 'historical' | 'limited'
}

type FilterOptions = {
  terms: { value: string; label: string }[]
  colleges: { value: string; label: string }[]
  departments: string[]
  cores: string[]
}

type Filters = {
  term: string
  core: string
  college: string
  department: string
  minReviews: number
  maxWorkload: number | null
}

type SortKey = 'rating' | 'challenging' | 'hours'
type SortDir = 'desc' | 'asc'

const sortOptions: { key: SortKey; label: string; field: keyof ExploreCourse }[] = [
  { key: 'rating', label: 'Rating', field: 'avgRating' },
  { key: 'challenging', label: 'Intellectually Challenging', field: 'difficulty' },
  { key: 'hours', label: 'Hours / Week', field: 'avgWorkload' },
]

const minReviewOptions = [
  { label: '3+ evals', value: 3 },
  { label: '5+ evals', value: 5 },
  { label: '10+ evals', value: 10 },
  { label: '25+ evals', value: 25 },
  { label: '50+ evals', value: 50 },
  { label: 'All', value: 0 },
]

const PAGE_SIZE = 25

// Maps the UI sort key to the explore_courses RPC's p_sort value.
const sortFieldParam: Record<SortKey, string> = {
  rating: 'rating',
  challenging: 'difficulty',
  hours: 'workload',
}

const maxWorkloadOptions: { label: string; value: number | null }[] = [
  { label: 'Max Workload', value: null },
  { label: 'Light (≤ 2)', value: 2 },
  { label: 'Moderate (≤ 3)', value: 3 },
  { label: 'Heavy (≤ 4)', value: 4 },
]

const DEFAULT_TERM = '2026FALL'

const emptyFilters: Filters = {
  term: DEFAULT_TERM,
  core: '',
  college: '',
  department: '',
  minReviews: 3,
  maxWorkload: null,
}

const fmt = (v: number | null) => (v === null ? '—' : v.toFixed(1))

// Avg weekly-hours rating (1–5) → a friendly workload label.
const workloadLabel = (v: number | null) => {
  if (v === null) return '—'
  if (v >= 3.5) return 'Heavy'
  if (v >= 2.3) return 'Moderate'
  return 'Light'
}

export default function ExplorePage() {
  const navigate = useNavigate()
  const [options, setOptions] = useState<FilterOptions | null>(null)
  const [draft, setDraft] = useState<Filters>(emptyFilters)
  const [applied, setApplied] = useState<Filters | null>(null)
  const [courses, setCourses] = useState<ExploreCourse[]>([])
  const [resultTermLabel, setResultTermLabel] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [sort, setSort] = useState<SortKey>('rating')
  const [dir, setDir] = useState<SortDir>('desc')

  // Build the explore query string for a given page offset.
  const buildParams = (f: Filters, offset: number) => {
    const params = new URLSearchParams({ term: f.term })
    if (f.core) params.set('core', f.core)
    if (f.college) params.set('college', f.college)
    if (f.department) params.set('department', f.department)
    if (f.minReviews) params.set('minReviews', String(f.minReviews))
    if (f.maxWorkload !== null) params.set('maxWorkload', String(f.maxWorkload))
    params.set('sort', sortFieldParam[sort])
    params.set('order', dir)
    params.set('limit', String(PAGE_SIZE))
    params.set('offset', String(offset))
    return params
  }

  useEffect(() => {
    fetch(api('/api/courses/filters'))
      .then((r) => r.json())
      .then((data: FilterOptions) => setOptions(data))
      .catch(() => {})
  }, [])

  // Fetch the first page whenever the applied filters or the sort change. The
  // server sorts and pages, so changing sort/dir refetches from the top.
  useEffect(() => {
    if (!applied) {
      setCourses([])
      setHasMore(false)
      return
    }
    let active = true
    setLoading(true)
    fetch(api('/api/courses/explore?' + buildParams(applied, 0).toString()))
      .then((r) => r.json())
      .then((data: { courses: ExploreCourse[]; termLabel: string; hasMore: boolean }) => {
        if (!active) return
        setCourses(data.courses)
        setResultTermLabel(data.termLabel)
        setHasMore(data.hasMore)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [applied, sort, dir])

  // Append the next page of results.
  const loadMore = () => {
    if (!applied) return
    setLoadingMore(true)
    fetch(api('/api/courses/explore?' + buildParams(applied, courses.length).toString()))
      .then((r) => r.json())
      .then((data: { courses: ExploreCourse[]; hasMore: boolean }) => {
        setCourses((prev) => [...prev, ...data.courses])
        setHasMore(data.hasMore)
      })
      .finally(() => setLoadingMore(false))
  }

  // Apply a complete filter set (Search button or a preset pill).
  const run = (next: Filters) => {
    setDraft(next)
    setApplied(next)
  }

  const clearAll = () => {
    setDraft(emptyFilters)
    setApplied(null)
    setSort('rating')
    setDir('desc')
  }

  // Drop a single applied filter (chip ×) and re-run.
  const removeFilter = (patch: Partial<Filters>) => {
    if (!applied) return
    run({ ...applied, ...patch })
  }

  const chips: { label: string; onRemove: () => void }[] = []
  if (applied) {
    chips.push({
      label: `Offered ${resultTermLabel || applied.term}`,
      onRemove: () => removeFilter({ term: DEFAULT_TERM }),
    })
    if (applied.core)
      chips.push({ label: `${applied.core} Core`, onRemove: () => removeFilter({ core: '' }) })
    if (applied.college) {
      const c = options?.colleges.find((o) => o.value === applied.college)
      chips.push({ label: c?.label ?? applied.college, onRemove: () => removeFilter({ college: '' }) })
    }
    if (applied.department)
      chips.push({ label: applied.department, onRemove: () => removeFilter({ department: '' }) })
    if (applied.minReviews)
      chips.push({ label: `${applied.minReviews}+ evals`, onRemove: () => removeFilter({ minReviews: 0 }) })
    if (applied.maxWorkload !== null)
      chips.push({
        label: `Under ${applied.maxWorkload} workload`,
        onRemove: () => removeFilter({ maxWorkload: null }),
      })
  }

  const heading = applied?.core
    ? `${applied.core} Core Courses`
    : applied?.department
    ? `${applied.department} Courses`
    : 'Courses'

  return (
    <main className="explore">
      <div className="container--fluid">
        <h1 className="explore__title">Explore Classes</h1>
        <p className="explore__sub">
          Discover courses that fit your requirements, interests, and schedule.
        </p>

        {/* Filter card */}
        <div className="filters">
          <div className="filters__grid">
            <select
              className="filters__select"
              value={draft.core}
              onChange={(e) => setDraft({ ...draft, core: e.target.value })}
            >
              <option value="">Core Requirement</option>
              {options?.cores.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>

            <select
              className="filters__select"
              value={draft.college}
              onChange={(e) => setDraft({ ...draft, college: e.target.value })}
            >
              <option value="">School</option>
              {options?.colleges.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>

            <select
              className="filters__select"
              value={draft.department}
              onChange={(e) => setDraft({ ...draft, department: e.target.value })}
            >
              <option value="">Department</option>
              {options?.departments.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>

            <select
              className="filters__select"
              value={draft.term}
              onChange={(e) => setDraft({ ...draft, term: e.target.value })}
            >
              {options?.terms.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>

            <select
              className="filters__select"
              value={draft.minReviews}
              onChange={(e) => setDraft({ ...draft, minReviews: Number(e.target.value) })}
            >
              {minReviewOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>

            <select
              className="filters__select"
              value={draft.maxWorkload ?? ''}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  maxWorkload: e.target.value === '' ? null : Number(e.target.value),
                })
              }
            >
              {maxWorkloadOptions.map((o) => (
                <option key={o.label} value={o.value ?? ''}>
                  {o.label}
                </option>
              ))}
            </select>

            <button type="button" className="filters__search" onClick={() => run(draft)}>
              <Search size={16} />
              Search
            </button>
          </div>

          <div className="filters__popular">
            <span className="filters__popular-label">POPULAR</span>
            <button
              type="button"
              className="pill"
              onClick={() => {
                setSort('rating')
                setDir('desc')
                run({ ...emptyFilters, core: 'Arts' })
              }}
            >
              Highest-Rated Arts Core
            </button>
            <button
              type="button"
              className="pill"
              onClick={() => {
                setSort('challenging')
                setDir('asc')
                run({ ...emptyFilters, core: 'Social Science' })
              }}
            >
              Easiest Social Science
            </button>
          </div>
        </div>

        {/* Results */}
        {!applied ? (
          <p className="placeholder-note explore__empty">
            Choose your filters above and hit Search to explore courses.
          </p>
        ) : (
          <>
            <div className="explore__results-head">
              <div>
                <h2 className="section__title explore__h2">{heading}</h2>
                <div className="explore__count">
                  {loading
                    ? 'Loading…'
                    : `Showing ${courses.length} course${courses.length === 1 ? '' : 's'} for ${
                        resultTermLabel || applied.term
                      }`}
                </div>
              </div>
              <div className="sort">
                <SlidersHorizontal size={18} />
                <span>Sort by</span>
                <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
                  {sortOptions.map((o) => (
                    <option key={o.key} value={o.key}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="sort__dir"
                  onClick={() => setDir((d) => (d === 'desc' ? 'asc' : 'desc'))}
                  title={dir === 'desc' ? 'Highest first' : 'Lowest first'}
                >
                  {dir === 'desc' ? (
                    <ArrowDownWideNarrow size={16} />
                  ) : (
                    <ArrowUpNarrowWide size={16} />
                  )}
                  {dir === 'desc' ? 'Highest' : 'Lowest'}
                </button>
              </div>
            </div>

            <div className="explore__chips">
              {chips.map((chip, i) => (
                <button key={i} type="button" className="fchip" onClick={chip.onRemove}>
                  {chip.label}
                  <X size={14} />
                </button>
              ))}
              <button type="button" className="fchip__clear" onClick={clearAll}>
                Clear filters
              </button>
            </div>

            {!loading && courses.length === 0 && (
              <p className="placeholder-note">No courses match these filters.</p>
            )}

            {courses.map((course) => (
              <article className="ecard" key={course.courseCode}>
                <div className="ecard__head">
                  <div>
                    <div className="ecard__code">{course.courseCode}</div>
                    <h3 className="ecard__title">{course.title ?? course.courseCode}</h3>
                    {course.bestInstructorName && (
                      <div className="ecard__prof">
                        Best current section: Prof. {course.bestInstructorName}
                      </div>
                    )}
                    {course.source === 'historical' && (
                      <div className="ecard__source-note">Based on past sections</div>
                    )}
                  </div>
                  <div className="ecard__rating">
                    <div className="ecard__rating-num">
                      {fmt(course.avgRating)} <Star size={16} fill="currentColor" />
                    </div>
                    <div className="ecard__rating-cap">{course.reviewCount} evals</div>
                    {course.source === 'limited' && (
                      <span className="ecard__limited">Limited data</span>
                    )}
                  </div>
                </div>

                <div className="ecard__lower">
                  <div className="ecard__main">
                    <div className="ecard__metrics">
                      <div className="ecard__metric">
                        <div className="ecard__metric-label">Difficulty</div>
                        <div className="ecard__metric-row">
                          <div className="metric__bar">
                            <div
                              className="metric__fill"
                              style={{
                                width: `${
                                  course.difficulty === null ? 0 : (course.difficulty / 5) * 100
                                }%`,
                              }}
                            />
                          </div>
                          <span className="ecard__metric-val">{fmt(course.difficulty)}</span>
                        </div>
                      </div>
                      <div className="ecard__metric">
                        <div className="ecard__metric-label">Workload</div>
                        <div className="ecard__metric-val ecard__metric-val--word">
                          {workloadLabel(course.avgWorkload)}
                        </div>
                      </div>
                      <div className="ecard__metric">
                        <div className="ecard__metric-label">Offered</div>
                        <div className="ecard__metric-val ecard__metric-val--word">
                          {resultTermLabel || applied.term}
                        </div>
                      </div>
                    </div>

                    {course.coreRequirements.length > 0 && (
                      <div className="ecard__tags">
                        {course.coreRequirements.map((c) => (
                          <span key={c} className="tag">
                            {c} Core
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <button
                    type="button"
                    className="ecard__view"
                    onClick={() => navigate('/courses/' + encodeURIComponent(course.courseCode))}
                  >
                    View Course
                  </button>
                </div>
              </article>
            ))}

            {hasMore && (
              <div className="explore__more">
                <button
                  type="button"
                  className="btn--outline"
                  onClick={loadMore}
                  disabled={loadingMore}
                >
                  {loadingMore ? 'Loading…' : 'Load More Courses'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  )
}
