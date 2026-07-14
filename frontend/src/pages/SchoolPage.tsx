import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  Star,
  BadgeCheck,
  ArrowRight,
  SlidersHorizontal,
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
} from 'lucide-react'
import { api } from '../lib/api'
import { difficultyLabel } from '../lib/difficulty'

type School = {
  code: string
  name: string
  overall: number | null
  difficulty: number | null
  workload: number | null
  interest: number | null
  totalEvals: number | null
  courseCount: number | null
  latestSemester: string | null
}

type TopProfessor = {
  id: number
  name: string | null
  rating: number | null
  reviewCount: number
}

type ApiResponse = {
  school: School
  term: string
  topProfessors: TopProfessor[]
}

// Top Classes come straight from the Explore endpoint (scoped to this school).
type ExploreCourse = {
  courseCode: string
  title: string | null
  bestInstructorName: string | null
  avgRating: number | null
  reviewCount: number
  difficulty: number | null
  avgWorkload: number | null
  source: 'current' | 'historical' | 'limited'
}

const fmt = (v: number | null) => (v === null ? '—' : v.toFixed(1))

// Avg weekly-hours rating (1–5) → workload label (matches CoursePage).
const workloadLabel = (v: number | null) => {
  if (v === null) return '—'
  if (v >= 3.5) return 'Heavy'
  if (v >= 2.3) return 'Moderate'
  return 'Light'
}

// Sort keys map to the explore_courses RPC's p_sort values.
type SortKey = 'rating' | 'difficulty' | 'workload'
type SortDir = 'desc' | 'asc'
const sortOptions: { key: SortKey; label: string }[] = [
  { key: 'rating', label: 'Top Rated' },
  { key: 'difficulty', label: 'Difficulty' },
  { key: 'workload', label: 'Workload' },
]

const PAGE_SIZE = 25
const LIMITED_EVALS = 5

function Stars({ value }: { value: number | null }) {
  const filled = value === null ? 0 : Math.round(value)
  return (
    <div className="stars">
      {[0, 1, 2, 3, 4].map((i) => (
        <Star
          key={i}
          size={18}
          className={i < filled ? 'star filled' : 'star'}
          fill={i < filled ? 'currentColor' : 'none'}
        />
      ))}
    </div>
  )
}

export default function SchoolPage() {
  const { code = '' } = useParams()
  const navigate = useNavigate()
  const [data, setData] = useState<ApiResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  // Top Classes list + its sort controls (local state — refetches on change).
  const [classes, setClasses] = useState<ExploreCourse[]>([])
  const [classesLoading, setClassesLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [sort, setSort] = useState<SortKey>('rating')
  const [dir, setDir] = useState<SortDir>('desc')
  // Semester selector. terms[0] is the latest (server default); '' = use default.
  const [terms, setTerms] = useState<{ value: string; label: string }[]>([])
  const [selectedTerm, setSelectedTerm] = useState('')

  useEffect(() => {
    fetch(api('/api/courses/filters'))
      .then((r) => r.json())
      .then((d: { terms: { value: string; label: string }[] }) => setTerms(d.terms))
      .catch(() => {})
  }, [])

  useEffect(() => {
    let active = true
    setLoading(true)
    setNotFound(false)
    fetch(api('/api/schools/' + encodeURIComponent(code)))
      .then((res) => {
        if (res.status === 404) {
          setNotFound(true)
          return null
        }
        return res.json()
      })
      .then((d: ApiResponse | null) => {
        if (!active || !d) return
        setData(d)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [code])

  const term = selectedTerm || data?.term || ''

  const classesUrl = (offset: number) =>
    api(
      '/api/courses/explore?' +
        new URLSearchParams({
          term,
          college: code,
          minReviews: '0',
          sort,
          order: dir,
          limit: String(PAGE_SIZE),
          offset: String(offset),
        }).toString()
    )

  // (Re)fetch the first page of classes once we know the school code or the sort
  // changes. The college code comes straight from the route param, so this can
  // fetch immediately — no need to wait on the header response. The server does
  // the Bayesian ordering and paging.
  useEffect(() => {
    if (!code) return
    let active = true
    setClassesLoading(true)
    fetch(classesUrl(0))
      .then((r) => r.json())
      .then((d: { courses: ExploreCourse[]; hasMore: boolean }) => {
        if (!active) return
        setClasses(d.courses)
        setHasMore(d.hasMore)
      })
      .finally(() => {
        if (active) setClassesLoading(false)
      })
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, sort, dir, selectedTerm])

  const loadMore = () => {
    setLoadingMore(true)
    fetch(classesUrl(classes.length))
      .then((r) => r.json())
      .then((d: { courses: ExploreCourse[]; hasMore: boolean }) => {
        setClasses((prev) => [...prev, ...d.courses])
        setHasMore(d.hasMore)
      })
      .finally(() => setLoadingMore(false))
  }

  if (loading) {
    return (
      <main className="course">
        <div className="container--fluid">
          <p className="placeholder-note">Loading…</p>
        </div>
      </main>
    )
  }

  if (notFound || !data) {
    return (
      <main className="course">
        <div className="container--fluid">
          <h1 className="course__title">School</h1>
          <p className="placeholder-note">We couldn't find this school.</p>
        </div>
      </main>
    )
  }

  const s = data.school
  const currentTermLabel =
    terms.find((t) => t.value === (selectedTerm || terms[0]?.value))?.label ?? ''

  return (
    <main className="course">
      <div className="container--fluid">
        {/* Header */}
        <div className="prof-header">
          <div className="prof-header__left">
            <div className="prof-header__eyebrow">
              <span className="prof-badge">School Profile</span>
              {s.latestSemester && (
                <span className="prof-updated">Updated {s.latestSemester}</span>
              )}
            </div>
            <h1 className="course__title prof-name">{s.name}</h1>
            <div className="prof-based">
              <BadgeCheck size={15} />
              Based on {s.totalEvals ?? 0} class evaluations across{' '}
              {s.courseCount ?? 0} courses
            </div>
          </div>

          <div className="prof-overall">
            <div className="prof-overall__label">Overall Rating</div>
            <div className="prof-overall__num">
              {fmt(s.overall)}
              <span> / 5.0</span>
            </div>
            <Stars value={s.overall} />
          </div>
        </div>

        {/* Stat boxes */}
        <div className="course__stats prof-stats">
          <div className="stat-box">
            <div className="stat-box__label">Overall</div>
            <div className="stat-box__num">{fmt(s.overall)}</div>
          </div>
          <div className="stat-box">
            <div className="stat-box__label">Difficulty</div>
            <div className="stat-box__num">
              {fmt(s.difficulty)}{' '}
              <span className="stat-box__suffix">({difficultyLabel(s.difficulty)})</span>
            </div>
          </div>
          <div className="stat-box">
            <div className="stat-box__label">Workload</div>
            <div className="stat-box__num">
              {fmt(s.workload)}{' '}
              <span className="stat-box__suffix">({workloadLabel(s.workload)})</span>
            </div>
          </div>
          <div className="stat-box">
            <div className="stat-box__label">Interest</div>
            <div className="stat-box__num">{fmt(s.interest)}</div>
          </div>
          <div className="stat-box">
            <div className="stat-box__label">Total Evals</div>
            <div className="stat-box__num">{s.totalEvals ?? 0}</div>
          </div>
        </div>

        {/* Body */}
        <div className="prof-body">
          <div className="prof-body__main">
            <div className="explore__results-head">
              <h2 className="section__title course__h2 prof-teaching-head">
                Top Classes This Semester{' '}
                {currentTermLabel && (
                  <span className="prof-teaching-head__term">({currentTermLabel})</span>
                )}
              </h2>
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
                  onClick={() => setDir((p) => (p === 'desc' ? 'asc' : 'desc'))}
                  title={dir === 'desc' ? 'Highest first' : 'Lowest first'}
                >
                  {dir === 'desc' ? (
                    <ArrowDownWideNarrow size={16} />
                  ) : (
                    <ArrowUpNarrowWide size={16} />
                  )}
                  {dir === 'desc' ? 'Highest' : 'Lowest'}
                </button>
                <select
                  value={selectedTerm || terms[0]?.value || ''}
                  onChange={(e) => setSelectedTerm(e.target.value)}
                >
                  {terms.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {classesLoading && <p className="placeholder-note">Loading…</p>}
            {!classesLoading && classes.length === 0 && (
              <p className="placeholder-note">
                No classes offered this semester for this school.
              </p>
            )}

            {!classesLoading &&
              classes.map((c) => {
                const limited =
                  c.source === 'limited' || c.reviewCount < LIMITED_EVALS
                return (
                  <article className="prof-course" key={c.courseCode}>
                    <div className="prof-course__info">
                      <div className="prof-course__eyebrow">
                        <span className="prof-course__code">{c.courseCode}</span>
                        {limited && (
                          <span className="tag prof-course__limited">Limited data</span>
                        )}
                      </div>
                      <div className="prof-course__title">{c.title ?? c.courseCode}</div>
                      {c.bestInstructorName && (
                        <div className="prof-course__meeting">
                          <span className="prof-course__meeting-item">
                            Best current section: Prof. {c.bestInstructorName}
                          </span>
                        </div>
                      )}
                    </div>

                    <div className="prof-course__metrics">
                      <div className="prof-course__metric">
                        <span className="prof-course__metric-label">Rating</span>
                        <span className="prof-course__metric-val">{fmt(c.avgRating)}</span>
                      </div>
                      <div className="prof-course__metric">
                        <span className="prof-course__metric-label">Diff</span>
                        <span className="prof-course__metric-val">{fmt(c.difficulty)}</span>
                      </div>
                      <div className="prof-course__metric">
                        <span className="prof-course__metric-label">Work</span>
                        <span className="prof-course__metric-val">
                          {workloadLabel(c.avgWorkload)}
                        </span>
                      </div>
                    </div>

                    <div className="prof-course__foot">
                      <span className="prof-course__evals">{c.reviewCount} Evaluations</span>
                      <button
                        className="prof-course__link"
                        onClick={() => navigate('/courses/' + encodeURIComponent(c.courseCode))}
                      >
                        View Course Details <ArrowRight size={15} />
                      </button>
                    </div>
                  </article>
                )
              })}

            {hasMore && !classesLoading && (
              <div className="explore__more">
                <button
                  type="button"
                  className="btn--outline"
                  onClick={loadMore}
                  disabled={loadingMore}
                >
                  {loadingMore ? 'Loading…' : 'Load More Classes'}
                </button>
              </div>
            )}
          </div>

          <aside className="prof-body__side">
            {data.topProfessors.length > 0 && (
              <div className="prof-catalog">
                <h3 className="prof-catalog__title">Top Professors</h3>
                <ul className="prof-catalog__list">
                  {data.topProfessors.map((prof) => (
                    <li
                      key={prof.id}
                      className="prof-catalog__item"
                      onClick={() => navigate('/professors/' + encodeURIComponent(prof.id))}
                    >
                      <div>
                        <div className="prof-catalog__name">{prof.name}</div>
                        <div className="prof-catalog__evals">{prof.reviewCount} evals</div>
                      </div>
                      <div className="prof-catalog__rating">{fmt(prof.rating)}</div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </aside>
        </div>
      </div>
    </main>
  )
}
