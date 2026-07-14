import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../lib/api'
import { supabase } from '../lib/supabase'
import { difficultyLabel } from '../lib/difficulty'
import {
  Star,
  SlidersHorizontal,
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  ChevronDown,
  ChevronUp,
  ChevronRight,
} from 'lucide-react'

type Section = {
  sectionId: number
  sectionNumber: string | null
  meetingText: string | null
  instructorId: number
  name: string
  overallRating: number | null
  overallEvaluations: number | null
  courseRating: number | null
  courseEvaluations: number | null
  semestersTaught: number | null
  intellectuallyChallenging: number | null
  avgHoursWeekly: number | null
  attendanceNecessary: number | null
}

// One professor and every section they teach in this course/term. The rating
// metrics are the instructor's own and repeat across their sections.
type Professor = {
  instructorId: number
  name: string
  overallRating: number | null
  overallEvaluations: number | null
  courseRating: number | null
  courseEvaluations: number | null
  semestersTaught: number | null
  intellectuallyChallenging: number | null
  avgHoursWeekly: number | null
  attendanceNecessary: number | null
  sections: Section[]
}

type Course = {
  courseCode: string
  title: string | null
  description: string | null
  department: string | null
  college: string | null
  coreRequirements: string[]
  avgRating: number | null
  difficulty: number | null
  avgWorkload: number | null
}

type Review = {
  id: number
  instructorId: number
  wouldRecommend: boolean
  comment: string
  source: 'user' | 'rmp'
  createdAt: string
}

type SortKey = 'rating' | 'challenging' | 'hours'
type SortDir = 'desc' | 'asc'
type TabKey = 'sections' | 'comments'

const sortOptions: { key: SortKey; label: string; field: keyof Professor }[] = [
  { key: 'rating', label: 'Rating', field: 'overallRating' },
  { key: 'challenging', label: 'Difficulty', field: 'intellectuallyChallenging' },
  { key: 'hours', label: 'Hours / Week', field: 'avgHoursWeekly' },
]

const fmt = (v: number | null) => (v === null ? '—' : v.toFixed(1))
const initials = (name: string) =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('')

// Avg weekly-hours rating (1–5) → a friendly workload label.
const workloadLabel = (v: number | null) => {
  if (v === null) return '—'
  if (v >= 3.5) return 'Heavy'
  if (v >= 2.3) return 'Moderate'
  return 'Light'
}

const sourceLabel = (_source: 'user' | 'rmp') => 'Verified BC Student'

// meeting_text packs location + days + time, e.g.
// "Fulton Hall 423 WF 11:00AM-11:50AM" → location "Fulton Hall 423",
// days & time "WF 11:00AM-11:50AM".
function parseMeeting(text: string | null): { location: string; daysTime: string } {
  if (!text) return { location: 'TBA', daysTime: 'TBA' }
  const time = text.match(/\d{1,2}:\d{2}.*$/)
  if (!time) return { location: text.trim(), daysTime: 'TBA' }
  const before = text.slice(0, time.index).trim()
  const days = before.match(/(?:M|Tu|W|Th|F|Sa|Su)+$/)
  if (days) {
    return {
      location: before.slice(0, days.index).trim() || 'TBA',
      daysTime: `${days[0]} ${time[0].trim()}`,
    }
  }
  return { location: before || 'TBA', daysTime: time[0].trim() }
}

function Stars({ value }: { value: number | null }) {
  const filled = value === null ? 0 : Math.round(value)
  return (
    <div className="stars">
      {[0, 1, 2, 3, 4].map((i) => (
        <Star
          key={i}
          size={16}
          className={i < filled ? 'star filled' : 'star'}
          fill={i < filled ? 'currentColor' : 'none'}
        />
      ))}
    </div>
  )
}

function Metric({ label, value }: { label: string; value: number | null }) {
  const pct = value === null ? 0 : Math.max(0, Math.min(100, (value / 5) * 100))
  return (
    <div className="metric">
      <div className="metric__head">
        <span>{label}</span>
        <span className="metric__val">{fmt(value)} / 5</span>
      </div>
      <div className="metric__bar">
        <div className="metric__fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

// Comments past this length are unlikely to fit the 4-line clamp, so they
// get a "Read more" toggle; shorter ones just render in full.
const LONG_COMMENT_THRESHOLD = 240

function ReviewCard({ review }: { review: Review }) {
  const [expanded, setExpanded] = useState(false)
  const needsTruncation = review.comment.length > LONG_COMMENT_THRESHOLD

  return (
    <div className="review-card">
      <div className="review-card__head">
        <span
          className={
            'review-card__badge ' +
            (review.wouldRecommend ? 'review-card__badge--yes' : 'review-card__badge--no')
          }
        >
          Would take again: {review.wouldRecommend ? 'Yes' : 'No'}
        </span>
      </div>
      <p
        className={
          'review-card__text' +
          (needsTruncation && !expanded ? ' review-card__text--clamped' : '')
        }
      >
        {review.comment}
      </p>
      {needsTruncation && (
        <button
          type="button"
          className="review-card__toggle"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? 'Read less' : 'Read more'}
        </button>
      )}
      <div className="review-card__meta">{sourceLabel(review.source)}</div>
    </div>
  )
}

export default function CoursePage() {
  const { courseCode = '' } = useParams()
  const [course, setCourse] = useState<Course | null>(null)
  const [sections, setSections] = useState<Section[]>([])
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [sort, setSort] = useState<SortKey>('rating')
  const [dir, setDir] = useState<SortDir>('desc')
  const [activeTab, setActiveTab] = useState<Map<number, TabKey>>(new Map())
  const [reviews, setReviews] = useState<Review[]>([])
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
    fetch(
      api(
        '/api/courses/' +
          encodeURIComponent(courseCode) +
          (selectedTerm ? '?term=' + encodeURIComponent(selectedTerm) : '')
      )
    )
      .then((res) => {
        if (res.status === 404) {
          setNotFound(true)
          return null
        }
        return res.json()
      })
      .then((data: { course: Course; sections: Section[] } | null) => {
        if (!active || !data) return
        setCourse(data.course)
        setSections(data.sections)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [courseCode, selectedTerm])

  // Reviews aren't term-scoped, so they're fetched once per course, separate
  // from the sections effect above.
  useEffect(() => {
    let active = true
    supabase
      .from('reviews')
      .select('id, instructor_id, would_recommend, comment, source, created_at')
      .eq('course_code', courseCode)
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (!active || error || !data) return
        setReviews(
          data.map((r) => ({
            id: r.id,
            instructorId: r.instructor_id,
            wouldRecommend: r.would_recommend,
            comment: r.comment,
            source: r.source,
            createdAt: r.created_at,
          }))
        )
      })
    return () => {
      active = false
    }
  }, [courseCode])

  const reviewsByInstructor = useMemo(() => {
    const map = new Map<number, Review[]>()
    for (const r of reviews) {
      const list = map.get(r.instructorId)
      if (list) list.push(r)
      else map.set(r.instructorId, [r])
    }
    return map
  }, [reviews])

  // Collapse one professor's section rows into a single card.
  const professors = useMemo(() => {
    const map = new Map<number, Professor>()
    for (const s of sections) {
      let p = map.get(s.instructorId)
      if (!p) {
        p = {
          instructorId: s.instructorId,
          name: s.name,
          overallRating: s.overallRating,
          overallEvaluations: s.overallEvaluations,
          courseRating: s.courseRating,
          courseEvaluations: s.courseEvaluations,
          semestersTaught: s.semestersTaught,
          intellectuallyChallenging: s.intellectuallyChallenging,
          avgHoursWeekly: s.avgHoursWeekly,
          attendanceNecessary: s.attendanceNecessary,
          sections: [],
        }
        map.set(s.instructorId, p)
      }
      p.sections.push(s)
    }
    for (const p of map.values()) {
      p.sections.sort((a, b) =>
        (a.sectionNumber ?? '').localeCompare(b.sectionNumber ?? '', undefined, {
          numeric: true,
        })
      )
    }
    return [...map.values()]
  }, [sections])

  const sorted = useMemo(() => {
    const field = sortOptions.find((o) => o.key === sort)!.field
    const mult = dir === 'desc' ? 1 : -1
    return [...professors].sort((a, b) => {
      const av = a[field] as number | null
      const bv = b[field] as number | null
      // Missing values always sort to the bottom, regardless of direction.
      if (av === null && bv === null) return 0
      if (av === null) return 1
      if (bv === null) return -1
      return (bv - av) * mult
    })
  }, [professors, sort, dir])

  const setTab = (id: number, tab: TabKey) =>
    setActiveTab((prev) => {
      const next = new Map(prev)
      next.get(id) === tab ? next.delete(id) : next.set(id, tab)
      return next
    })

  if (loading) {
    return (
      <main className="course">
        <div className="container--fluid">
          <p className="placeholder-note">Loading…</p>
        </div>
      </main>
    )
  }

  if (notFound || !course) {
    return (
      <main className="course">
        <div className="container--fluid">
          <h1 className="course__title">{courseCode}</h1>
          <p className="placeholder-note">We couldn't find this course.</p>
        </div>
      </main>
    )
  }

  const currentTermLabel =
    terms.find((t) => t.value === (selectedTerm || terms[0]?.value))?.label ?? ''

  const hasRatingData =
    course.avgRating !== null ||
    course.difficulty !== null ||
    course.avgWorkload !== null

  const eyebrow = [
    course.courseCode,
    [course.college, course.coreRequirements.length ? 'Core' : null]
      .filter(Boolean)
      .join(' '),
  ]
    .filter(Boolean)
    .join(' • ')

  return (
    <main className="course">
      <div className="container--fluid">
        {/* Header */}
        <div className="course__eyebrow-row">
          <div className="course__eyebrow">{eyebrow.toUpperCase()}</div>
          <Link
            to={`/courses/${encodeURIComponent(course.courseCode)}/review`}
            className="course__review-cta"
          >
            Taken this course? Leave a review
            <ChevronRight size={14} />
          </Link>
        </div>

        <div className="course__head">
          <h1 className="course__title">{course.title ?? course.courseCode}</h1>
          <div className="course__stats-side">
            <div className="course__stats">
              <div className="stat-box">
                <div className="stat-box__num">{fmt(course.avgRating)}</div>
                <div className="stat-box__label">Avg. Rating</div>
              </div>
              <div className="stat-box">
                <div className="stat-box__num">
                  {fmt(course.difficulty)}{' '}
                  <span className="stat-box__suffix">({difficultyLabel(course.difficulty)})</span>
                </div>
                <div className="stat-box__label">Difficulty</div>
              </div>
              <div className="stat-box">
                <div className="stat-box__num stat-box__num--word">
                  {workloadLabel(course.avgWorkload)}
                </div>
                <div className="stat-box__label">Workload</div>
              </div>
            </div>
            {!hasRatingData && (
              <p className="course__stats-note">
                No student evaluation data for this course yet.
              </p>
            )}
          </div>
        </div>

        <p className="course__desc">{course.description}</p>

        {/* Sections */}
        <div className="course__instructors-head">
          <h2 className="section__title course__h2">
            Sections &amp; Instructors{' '}
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

        {sorted.length === 0 && (
          <p className="placeholder-note">
            No sections are listed for this course this semester.
          </p>
        )}

        {sorted.map((prof) => {
          const profReviews = reviewsByInstructor.get(prof.instructorId) ?? []
          const tab = activeTab.get(prof.instructorId)
          return (
            <article className="pcard" key={prof.instructorId}>
              <div className="pcard__main">
                <div className="pcard__left">
                  <div className="avatar">{initials(prof.name)}</div>
                  <Stars value={prof.overallRating} />
                  <div className="pcard__overall">{fmt(prof.overallRating)}</div>
                  <div className="pcard__overall-cap">
                    Overall · {prof.overallEvaluations ?? 0}{' '}
                    {prof.overallEvaluations === 1 ? 'eval' : 'evals'}
                  </div>
                </div>

                <div className="pcard__body">
                  <div className="pcard__name">{prof.name}</div>
                  <div className="pcard__sub pcard__sub--course">
                    In this course: <strong>{fmt(prof.courseRating)}</strong>
                    {' · '}
                    {prof.semestersTaught
                      ? `taught ${prof.semestersTaught} ${
                          prof.semestersTaught === 1 ? 'semester' : 'semesters'
                        }`
                      : 'first time teaching it'}
                  </div>

                  <div className="pcard__metrics">
                    <div className="metric-col">
                      <div className="metric">
                        <div className="metric__head">
                          <span>Workload</span>
                          <span className="metric__val">
                            {workloadLabel(prof.avgHoursWeekly)}
                          </span>
                        </div>
                        <div className="metric__bar">
                          <div
                            className="metric__fill"
                            style={{
                              width: `${
                                prof.avgHoursWeekly === null
                                  ? 0
                                  : (prof.avgHoursWeekly / 5) * 100
                              }%`,
                            }}
                          />
                        </div>
                      </div>
                      <Metric label="Attendance" value={prof.attendanceNecessary} />
                    </div>

                    <div className="metric-col">
                      <Metric label="Difficulty" value={prof.intellectuallyChallenging} />
                    </div>
                  </div>
                </div>
              </div>

              <nav className="pcard-tabs">
                <button
                  type="button"
                  className={'pcard-tab' + (tab === 'sections' ? ' active' : '')}
                  onClick={() => setTab(prof.instructorId, 'sections')}
                >
                  Sections ({prof.sections.length})
                  {tab === 'sections' ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>
                <button
                  type="button"
                  className={'pcard-tab' + (tab === 'comments' ? ' active' : '')}
                  onClick={() => setTab(prof.instructorId, 'comments')}
                  disabled={profReviews.length === 0}
                >
                  {profReviews.length === 0
                    ? 'No Student Comments'
                    : `Student Comments (${profReviews.length})`}
                  {profReviews.length > 0 &&
                    (tab === 'comments' ? <ChevronUp size={14} /> : <ChevronDown size={14} />)}
                </button>
              </nav>

              {tab === 'sections' && (
                <div className="pcard__panel">
                  <table className="sections-table">
                    <thead>
                      <tr>
                        <th>Section</th>
                        <th>Days &amp; Time</th>
                        <th>Location</th>
                      </tr>
                    </thead>
                    <tbody>
                      {prof.sections.map((s) => {
                        const { location, daysTime } = parseMeeting(s.meetingText)
                        return (
                          <tr key={s.sectionId}>
                            <td className="sections-table__sec">
                              Section {s.sectionNumber ?? '—'}
                            </td>
                            <td>{daysTime}</td>
                            <td>{location}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {tab === 'comments' && (
                <div className="pcard__panel pcard__panel--comments">
                  {profReviews.length === 0 ? (
                    <div className="pcard__panel-empty">
                      No comments yet. Be the first to review.
                    </div>
                  ) : (
                    <div className="pcard__reviews-list">
                      {profReviews.map((r) => (
                        <ReviewCard key={r.id} review={r} />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </article>
          )
        })}
      </div>
    </main>
  )
}
