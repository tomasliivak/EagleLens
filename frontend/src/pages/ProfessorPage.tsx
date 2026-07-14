import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  Star,
  BadgeCheck,
  Award,
  Smile,
  Clock,
  MessageSquare,
  ArrowRight,
  MapPin,
  Calendar,
  ChevronRight,
} from 'lucide-react'
import { api } from '../lib/api'
import { supabase } from '../lib/supabase'
import { difficultyLabel } from '../lib/difficulty'

type Professor = {
  id: number
  name: string
  department: string | null
  college: string | null
  overall: number | null
  difficulty: number | null
  workload: number | null
  interest: number | null
  totalEvals: number | null
  latestSemester: string | null
}

type CurrentSection = {
  courseCode: string
  title: string | null
  credits: number | null
  meetingText: string | null
  rating: number | null
  difficulty: number | null
  workload: number | null
  evaluations: number | null
}

type CourseRow = {
  courseCode: string
  title: string | null
  rating: number | null
  difficulty: number | null
  workload: number | null
  evaluations: number | null
  responses: number | null
}

type Review = {
  id: number
  courseCode: string
  wouldRecommend: boolean
  comment: string
  source: 'user' | 'rmp'
  createdAt: string
}

const sourceLabel = (_source: 'user' | 'rmp') => 'Verified BC Student'

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
      <div className="review-card__meta">
        {sourceLabel(review.source)} · {review.courseCode}
      </div>
    </div>
  )
}

const fmt = (v: number | null) => (v === null ? '—' : v.toFixed(1))

// Avg weekly-hours rating (1–5) → workload label (matches CoursePage).
const workloadLabel = (v: number | null) => {
  if (v === null) return '—'
  if (v >= 3.5) return 'Heavy'
  if (v >= 2.3) return 'Moderate'
  return 'Light'
}

// A course with fewer than this many evals (or none) is flagged "Limited data".
const LIMITED_EVALS = 5

// meeting_text packs location + days + time (see CoursePage.parseMeeting).
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
          size={18}
          className={i < filled ? 'star filled' : 'star'}
          fill={i < filled ? 'currentColor' : 'none'}
        />
      ))}
    </div>
  )
}

type ApiResponse = {
  professor: Professor
  term: string
  currentSections: CurrentSection[]
  courses: CourseRow[]
}

export default function ProfessorPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const [data, setData] = useState<ApiResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  // Semester selector. terms[0] is the latest (server default); '' = use default.
  const [terms, setTerms] = useState<{ value: string; label: string }[]>([])
  const [selectedTerm, setSelectedTerm] = useState('')
  const [reviews, setReviews] = useState<Review[]>([])

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
        '/api/professors/' +
          encodeURIComponent(id) +
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
  }, [id, selectedTerm])

  // Reviews aren't term-scoped, so they're fetched once per professor,
  // separate from the sections effect above.
  useEffect(() => {
    let active = true
    supabase
      .from('reviews')
      .select('id, course_code, would_recommend, comment, source, created_at')
      .eq('instructor_id', Number(id))
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (!active || error || !data) return
        setReviews(
          data.map((r) => ({
            id: r.id,
            courseCode: r.course_code,
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
  }, [id])

  // Collapse the per-section rows of the current term into one card per course.
  const currentCourses = useMemo(() => {
    if (!data) return []
    const map = new Map<string, CurrentSection>()
    for (const s of data.currentSections) {
      if (!map.has(s.courseCode)) map.set(s.courseCode, s)
    }
    return [...map.values()]
  }, [data])

  // Highlights derived from the historical catalog (courses with rating data).
  const highlights = useMemo(() => {
    if (!data) return null
    const rated = data.courses.filter((c) => c.rating !== null)
    if (rated.length === 0) return null
    const min = <T,>(arr: T[], pick: (x: T) => number | null) =>
      arr.reduce((best, x) => {
        const v = pick(x)
        if (v === null) return best
        const bv = pick(best)
        return bv === null || v < bv ? x : best
      })
    const max = <T,>(arr: T[], pick: (x: T) => number | null) =>
      arr.reduce((best, x) => {
        const v = pick(x)
        if (v === null) return best
        const bv = pick(best)
        return bv === null || v > bv ? x : best
      })
    return {
      bestRated: max(rated, (c) => c.rating),
      mostApproachable: min(rated, (c) => c.difficulty),
      lowestWorkload: min(rated, (c) => c.workload),
      mostReviewed: max(data.courses, (c) => c.responses),
    }
  }, [data])

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
          <h1 className="course__title">Professor</h1>
          <p className="placeholder-note">We couldn't find this professor.</p>
        </div>
      </main>
    )
  }

  const p = data.professor
  const currentTermLabel =
    terms.find((t) => t.value === (selectedTerm || terms[0]?.value))?.label ?? ''

  return (
    <main className="course">
      <div className="container--fluid">
        {/* Header */}
        <div className="course__eyebrow-row">
          <div className="prof-header__eyebrow">
            <span className="prof-badge">Professor Profile</span>
            {p.latestSemester && (
              <span className="prof-updated">Updated {p.latestSemester}</span>
            )}
          </div>
          <Link to={`/professors/${p.id}/review`} className="course__review-cta">
            Had this professor? Leave a review
            <ChevronRight size={14} />
          </Link>
        </div>

        <div className="prof-header">
          <div className="prof-header__left">
            <h1 className="course__title prof-name">{p.name}</h1>
            {(p.department || p.college) && (
              <div className="prof-meta">
                {p.department && <>{p.department} Department</>}
                {p.department && p.college && (
                  <span className="prof-meta__sep">|</span>
                )}
                {p.college && <strong>{p.college}</strong>}
              </div>
            )}
            <div className="prof-based">
              <BadgeCheck size={15} />
              Based on {p.totalEvals ?? 0} class evaluations
            </div>
          </div>

          <div className="prof-overall">
            <div className="prof-overall__label">Overall Rating</div>
            <div className="prof-overall__num">
              {fmt(p.overall)}
              <span> / 5.0</span>
            </div>
            <Stars value={p.overall} />
          </div>
        </div>

        {/* Stat boxes */}
        <div className="course__stats prof-stats">
          <div className="stat-box">
            <div className="stat-box__label">Overall</div>
            <div className="stat-box__num">{fmt(p.overall)}</div>
          </div>
          <div className="stat-box">
            <div className="stat-box__label">Difficulty</div>
            <div className="stat-box__num">
              {fmt(p.difficulty)}{' '}
              <span className="stat-box__suffix">({difficultyLabel(p.difficulty)})</span>
            </div>
          </div>
          <div className="stat-box">
            <div className="stat-box__label">Workload</div>
            <div className="stat-box__num">
              {fmt(p.workload)}{' '}
              <span className="stat-box__suffix">({workloadLabel(p.workload)})</span>
            </div>
          </div>
          <div className="stat-box">
            <div className="stat-box__label">Interest</div>
            <div className="stat-box__num">{fmt(p.interest)}</div>
          </div>
          <div className="stat-box">
            <div className="stat-box__label">Total Evals</div>
            <div className="stat-box__num">{p.totalEvals ?? 0}</div>
          </div>
        </div>

        {/* Body */}
        <div className="prof-body">
          <div className="prof-body__main">
            <div className="explore__results-head">
              <h2 className="section__title course__h2 prof-teaching-head">
                Teaching This Semester{' '}
                {currentTermLabel && (
                  <span className="prof-teaching-head__term">({currentTermLabel})</span>
                )}
              </h2>
              <div className="sort">
                <Calendar size={18} />
                <span>Semester</span>
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

            {currentCourses.length === 0 && (
              <p className="placeholder-note">
                Not teaching any courses this semester.
              </p>
            )}

            {currentCourses.map((c) => {
              const { location, daysTime } = parseMeeting(c.meetingText)
              const limited =
                c.evaluations === null || c.evaluations < LIMITED_EVALS
              return (
                <article className="prof-course" key={c.courseCode}>
                  <div className="prof-course__info">
                    <div className="prof-course__eyebrow">
                      <span className="prof-course__code">{c.courseCode}</span>
                      {c.credits != null && (
                        <span className="prof-course__credits">
                          · {c.credits} Credits
                        </span>
                      )}
                      {limited && <span className="tag prof-course__limited">Limited data</span>}
                    </div>
                    <div className="prof-course__title">{c.title ?? c.courseCode}</div>
                    <div className="prof-course__meeting">
                      <span className="prof-course__meeting-item">
                        <Clock size={14} />
                        {daysTime}
                      </span>
                      <span className="prof-course__meeting-item">
                        <MapPin size={14} />
                        {location}
                      </span>
                    </div>
                  </div>

                  <div className="prof-course__metrics">
                    <div className="prof-course__metric">
                      <span className="prof-course__metric-label">Rating</span>
                      <span className="prof-course__metric-val">{fmt(c.rating)}</span>
                    </div>
                    <div className="prof-course__metric">
                      <span className="prof-course__metric-label">Diff</span>
                      <span className="prof-course__metric-val">{fmt(c.difficulty)}</span>
                    </div>
                    <div className="prof-course__metric">
                      <span className="prof-course__metric-label">Work</span>
                      <span className="prof-course__metric-val">{fmt(c.workload)}</span>
                    </div>
                  </div>

                  <div className="prof-course__foot">
                    <span className="prof-course__evals">
                      {c.evaluations ?? 0} Evaluations
                    </span>
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

            <h2 className="section__title course__h2 prof-teaching-head prof-comments-head">
              Professor Comments
            </h2>

            {reviews.length === 0 ? (
              <p className="placeholder-note">No comments yet. Be the first to review.</p>
            ) : (
              <div className="pcard__reviews-list">
                {reviews.map((r) => (
                  <ReviewCard key={r.id} review={r} />
                ))}
              </div>
            )}
          </div>

          <aside className="prof-body__side">
            {highlights && (
              <div className="prof-highlights">
                <h3 className="prof-highlights__title">Professor Highlights</h3>
                <ul className="prof-highlights__list">
                  <li>
                    <Award size={16} />
                    <div>
                      <div className="prof-highlights__label">Best Rated Course</div>
                      <div className="prof-highlights__val">
                        {highlights.bestRated.courseCode} ({fmt(highlights.bestRated.rating)}/5.0)
                      </div>
                    </div>
                  </li>
                  <li>
                    <Smile size={16} />
                    <div>
                      <div className="prof-highlights__label">Most Approachable</div>
                      <div className="prof-highlights__val">
                        {highlights.mostApproachable.courseCode} ({fmt(highlights.mostApproachable.difficulty)} Difficulty)
                      </div>
                    </div>
                  </li>
                  <li>
                    <Clock size={16} />
                    <div>
                      <div className="prof-highlights__label">Lowest Workload</div>
                      <div className="prof-highlights__val">
                        {highlights.lowestWorkload.courseCode} ({fmt(highlights.lowestWorkload.workload)} Scale)
                      </div>
                    </div>
                  </li>
                  <li>
                    <MessageSquare size={16} />
                    <div>
                      <div className="prof-highlights__label">Most Reviewed</div>
                      <div className="prof-highlights__val">
                        {highlights.mostReviewed.courseCode} ({(highlights.mostReviewed.responses ?? 0).toLocaleString()} Lifetime)
                      </div>
                    </div>
                  </li>
                </ul>
              </div>
            )}

            {data.courses.length > 0 && (
              <div className="prof-catalog">
                <h3 className="prof-catalog__title">Historical Catalog</h3>
                <ul className="prof-catalog__list">
                  {data.courses.map((c) => (
                    <li
                      key={c.courseCode}
                      className="prof-catalog__item"
                      onClick={() => navigate('/courses/' + encodeURIComponent(c.courseCode))}
                    >
                      <div>
                        <div className="prof-catalog__name">
                          {c.courseCode} {c.title}
                        </div>
                        <div className="prof-catalog__evals">{c.evaluations ?? 0} evals</div>
                      </div>
                      <div className="prof-catalog__rating">{fmt(c.rating)}</div>
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
