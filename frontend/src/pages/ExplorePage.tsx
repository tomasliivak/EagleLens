import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../lib/api'
import {
  Star,
  SlidersHorizontal,
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
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
  credits: number | null
  studentLevel: string
}

type SortKey = 'rating' | 'challenging' | 'hours'
type SortDir = 'desc' | 'asc'

const sortOptions: { key: SortKey; label: string; field: keyof ExploreCourse }[] = [
  { key: 'rating', label: 'Adjusted Rating', field: 'avgRating' },
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

// Sentinel core value: "any course that fulfills at least one core requirement".
// Handled by the explore_courses RPC (migration 0019).
const ANY_CORE = '__any__'

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

// Credits select. Default is 3; 'all' clears the filter. Value is the string
// stored in the URL ('1'..'4' or 'all').
const DEFAULT_CREDITS = 3
const creditOptions: { label: string; value: string }[] = [
  { label: '1 Credit', value: '1' },
  { label: '2 Credits', value: '2' },
  { label: '3 Credits', value: '3' },
  { label: '4 Credits', value: '4' },
  { label: 'All Credits', value: 'all' },
]

// Student-level select. Default Undergraduate; 'all' (the "Both" option) clears
// the filter. 'Undergraduate'/'Graduate' match that level plus cross-listed
// 'Both' sections server-side.
const DEFAULT_STUDENT_LEVEL = 'Undergraduate'
const studentLevelOptions: { label: string; value: string }[] = [
  { label: 'Undergraduate', value: 'Undergraduate' },
  { label: 'Graduate', value: 'Graduate' },
  { label: 'Both', value: 'all' },
]

const DEFAULT_TERM = '2026FALL'

const emptyFilters: Filters = {
  term: DEFAULT_TERM,
  core: '',
  college: '',
  department: '',
  minReviews: 3,
  maxWorkload: null,
  credits: DEFAULT_CREDITS,
  studentLevel: DEFAULT_STUDENT_LEVEL,
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
  const [searchParams, setSearchParams] = useSearchParams()
  const [options, setOptions] = useState<FilterOptions | null>(null)
  const [courses, setCourses] = useState<ExploreCourse[]>([])
  const [resultTermLabel, setResultTermLabel] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)

  // The URL is the source of truth — every control reads from here and writes
  // back, so filters are shareable and back/forward-aware (like RankingsPage).
  const filters: Filters = {
    term: searchParams.get('term') ?? DEFAULT_TERM,
    core: searchParams.get('core') ?? '',
    college: searchParams.get('college') ?? '',
    department: searchParams.get('department') ?? '',
    minReviews: searchParams.has('minReviews') ? Number(searchParams.get('minReviews')) : 3,
    maxWorkload: searchParams.has('maxWorkload') ? Number(searchParams.get('maxWorkload')) : null,
    // Absent = default 3; 'all' = no filter (null); otherwise the number.
    credits:
      searchParams.get('credits') === null
        ? DEFAULT_CREDITS
        : searchParams.get('credits') === 'all'
        ? null
        : Number(searchParams.get('credits')),
    // Absent = default Undergraduate; 'all' = no filter (the "Both" option).
    studentLevel: searchParams.get('studentLevel') ?? DEFAULT_STUDENT_LEVEL,
  }
  const sort: SortKey = sortOptions.find((o) => o.key === searchParams.get('sort'))?.key ?? 'rating'
  const dir: SortDir = searchParams.get('order') === 'asc' ? 'asc' : 'desc'

  // Merge a patch into the URL params; null/empty values drop out so defaults
  // don't clutter the URL.
  const updateParams = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams)
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === '') next.delete(key)
      else next.set(key, value)
    }
    setSearchParams(next)
  }

  // Build the explore query string for a given page offset.
  const buildParams = (f: Filters, offset: number) => {
    const params = new URLSearchParams({ term: f.term })
    if (f.core) params.set('core', f.core)
    if (f.college) params.set('college', f.college)
    if (f.department) params.set('department', f.department)
    if (f.minReviews) params.set('minReviews', String(f.minReviews))
    if (f.maxWorkload !== null) params.set('maxWorkload', String(f.maxWorkload))
    if (f.credits !== null) params.set('credits', String(f.credits))
    if (f.studentLevel !== 'all') params.set('studentLevel', f.studentLevel)
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

  // Refetch the first page whenever any filter or the sort changes (i.e. the URL
  // changes). The server sorts and pages, so changing sort/dir refetches from
  // the top.
  useEffect(() => {
    let active = true
    setLoading(true)
    fetch(api('/api/courses/explore?' + buildParams(filters, 0).toString()))
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams.toString()])

  // Append the next page of results.
  const loadMore = () => {
    setLoadingMore(true)
    fetch(api('/api/courses/explore?' + buildParams(filters, courses.length).toString()))
      .then((r) => r.json())
      .then((data: { courses: ExploreCourse[]; hasMore: boolean }) => {
        setCourses((prev) => [...prev, ...data.courses])
        setHasMore(data.hasMore)
      })
      .finally(() => setLoadingMore(false))
  }

  // Apply a preset: replace the whole query with a fresh set (omitting defaults).
  const applyPreset = (f: Filters, s: SortKey, d: SortDir) => {
    const next = new URLSearchParams()
    if (f.term !== DEFAULT_TERM) next.set('term', f.term)
    if (f.core) next.set('core', f.core)
    if (f.college) next.set('college', f.college)
    if (f.department) next.set('department', f.department)
    if (f.minReviews !== 3) next.set('minReviews', String(f.minReviews))
    if (f.maxWorkload !== null) next.set('maxWorkload', String(f.maxWorkload))
    if (f.credits === null) next.set('credits', 'all')
    else if (f.credits !== DEFAULT_CREDITS) next.set('credits', String(f.credits))
    if (f.studentLevel !== DEFAULT_STUDENT_LEVEL) next.set('studentLevel', f.studentLevel)
    if (s !== 'rating') next.set('sort', s)
    if (d !== 'desc') next.set('order', d)
    setSearchParams(next)
  }

  const clearAll = () => setSearchParams(new URLSearchParams())

  const chips: { label: string; onRemove: () => void }[] = []
  chips.push({
    label: `Offered ${resultTermLabel || filters.term}`,
    onRemove: () => updateParams({ term: null }),
  })
  if (filters.core)
    chips.push({
      label: filters.core === ANY_CORE ? 'Any Core' : `${filters.core} Core`,
      onRemove: () => updateParams({ core: null }),
    })
  if (filters.college) {
    const c = options?.colleges.find((o) => o.value === filters.college)
    chips.push({ label: c?.label ?? filters.college, onRemove: () => updateParams({ college: null }) })
  }
  if (filters.department)
    chips.push({ label: filters.department, onRemove: () => updateParams({ department: null }) })
  if (filters.minReviews)
    chips.push({ label: `${filters.minReviews}+ evals`, onRemove: () => updateParams({ minReviews: '0' }) })
  if (filters.credits !== null)
    chips.push({
      label: `${filters.credits} credit${filters.credits === 1 ? '' : 's'}`,
      onRemove: () => updateParams({ credits: 'all' }),
    })
  if (filters.studentLevel !== 'all')
    chips.push({
      label: filters.studentLevel,
      onRemove: () => updateParams({ studentLevel: 'all' }),
    })
  if (filters.maxWorkload !== null)
    chips.push({
      label: `Under ${filters.maxWorkload} workload`,
      onRemove: () => updateParams({ maxWorkload: null }),
    })

  const heading = filters.core
    ? filters.core === ANY_CORE
      ? 'Any Core Courses'
      : `${filters.core} Core Courses`
    : filters.department
    ? `${filters.department} Courses`
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
              value={filters.core}
              onChange={(e) => updateParams({ core: e.target.value })}
            >
              <option value="">Core Requirement</option>
              <option value={ANY_CORE}>Any Core</option>
              {options?.cores.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>

            <select
              className="filters__select"
              value={filters.college}
              onChange={(e) => updateParams({ college: e.target.value })}
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
              value={filters.department}
              onChange={(e) => updateParams({ department: e.target.value })}
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
              value={filters.term}
              onChange={(e) => updateParams({ term: e.target.value === DEFAULT_TERM ? null : e.target.value })}
            >
              {options?.terms.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>

            <select
              className="filters__select"
              value={filters.minReviews}
              onChange={(e) =>
                updateParams({ minReviews: Number(e.target.value) === 3 ? null : e.target.value })
              }
            >
              {minReviewOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>

            <select
              className="filters__select"
              value={filters.maxWorkload ?? ''}
              onChange={(e) => updateParams({ maxWorkload: e.target.value === '' ? null : e.target.value })}
            >
              {maxWorkloadOptions.map((o) => (
                <option key={o.label} value={o.value ?? ''}>
                  {o.label}
                </option>
              ))}
            </select>

            <select
              className="filters__select"
              value={filters.credits === null ? 'all' : String(filters.credits)}
              onChange={(e) => updateParams({ credits: e.target.value === '3' ? null : e.target.value })}
            >
              {creditOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>

            <select
              className="filters__select"
              value={filters.studentLevel}
              onChange={(e) =>
                updateParams({
                  studentLevel: e.target.value === DEFAULT_STUDENT_LEVEL ? null : e.target.value,
                })
              }
            >
              {studentLevelOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div className="filters__popular">
            <span className="filters__popular-label">POPULAR</span>
            <button
              type="button"
              className="pill"
              onClick={() => applyPreset({ ...emptyFilters, core: 'Arts' }, 'rating', 'desc')}
            >
              Highest-Rated Arts Core
            </button>
            <button
              type="button"
              className="pill"
              onClick={() => applyPreset({ ...emptyFilters, core: 'Social Science' }, 'challenging', 'asc')}
            >
              Easiest Social Science
            </button>
            <button
              type="button"
              className="pill"
              onClick={() => applyPreset({ ...emptyFilters, core: 'Natural Science' }, 'hours', 'asc')}
            >
              Lightest Natural Science
            </button>
            <button
              type="button"
              className="pill"
              onClick={() => applyPreset({ ...emptyFilters, department: 'Finance' }, 'rating', 'desc')}
            >
              Top-Rated Finance
            </button>
            <button
              type="button"
              className="pill"
              onClick={() => applyPreset({ ...emptyFilters, department: 'Computer Science' }, 'rating', 'desc')}
            >
              Top-Rated CS
            </button>
          </div>
        </div>

        {/* Results */}
        <>
            <div className="explore__results-head">
              <div>
                <h2 className="section__title explore__h2">{heading}</h2>
                <div className="explore__count">
                  {loading
                    ? 'Loading…'
                    : `Showing ${courses.length} course${courses.length === 1 ? '' : 's'} for ${
                        resultTermLabel || filters.term
                      }`}
                </div>
              </div>
              <div className="sort">
                <SlidersHorizontal size={18} />
                <span>Sort by</span>
                <select
                  value={sort}
                  onChange={(e) =>
                    updateParams({ sort: e.target.value === 'rating' ? null : e.target.value })
                  }
                >
                  {sortOptions.map((o) => (
                    <option key={o.key} value={o.key}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="sort__dir"
                  onClick={() => updateParams({ order: dir === 'desc' ? 'asc' : null })}
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
                          {resultTermLabel || filters.term}
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
      </div>
    </main>
  )
}
