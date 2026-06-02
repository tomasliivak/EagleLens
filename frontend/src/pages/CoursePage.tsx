import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Star, SlidersHorizontal, ArrowDownWideNarrow, ArrowUpNarrowWide } from 'lucide-react'

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

type SortKey = 'rating' | 'challenging' | 'hours'
type SortDir = 'desc' | 'asc'

const sortOptions: { key: SortKey; label: string; field: keyof Section }[] = [
  { key: 'rating', label: 'Rating', field: 'overallRating' },
  { key: 'challenging', label: 'Intellectually Challenging', field: 'intellectuallyChallenging' },
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

export default function CoursePage() {
  const { courseCode = '' } = useParams()
  const [course, setCourse] = useState<Course | null>(null)
  const [sections, setSections] = useState<Section[]>([])
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [sort, setSort] = useState<SortKey>('rating')
  const [dir, setDir] = useState<SortDir>('desc')

  useEffect(() => {
    let active = true
    setLoading(true)
    setNotFound(false)
    fetch('/api/courses/' + encodeURIComponent(courseCode))
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
  }, [courseCode])

  const sorted = useMemo(() => {
    const field = sortOptions.find((o) => o.key === sort)!.field
    const mult = dir === 'desc' ? 1 : -1
    return [...sections].sort((a, b) => {
      const av = a[field] as number | null
      const bv = b[field] as number | null
      // Missing values always sort to the bottom, regardless of direction.
      if (av === null && bv === null) return 0
      if (av === null) return 1
      if (bv === null) return -1
      return (bv - av) * mult
    })
  }, [sections, sort, dir])

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
        <div className="course__eyebrow">{eyebrow.toUpperCase()}</div>
        <h1 className="course__title">{course.title ?? course.courseCode}</h1>

        <div className="course__overview">
          <p className="course__desc">{course.description}</p>
          <div className="course__stats">
            <div className="stat-box">
              <div className="stat-box__num">{fmt(course.avgRating)}</div>
              <div className="stat-box__label">Avg. Rating</div>
            </div>
            <div className="stat-box">
              <div className="stat-box__num">{fmt(course.difficulty)}</div>
              <div className="stat-box__label">Difficulty</div>
            </div>
            <div className="stat-box">
              <div className="stat-box__num stat-box__num--word">
                {workloadLabel(course.avgWorkload)}
              </div>
              <div className="stat-box__label">Avg. Workload</div>
            </div>
          </div>
        </div>

        {/* Sections */}
        <div className="course__instructors-head">
          <h2 className="section__title course__h2">Sections &amp; Instructors</h2>
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

        {sorted.length === 0 && (
          <p className="placeholder-note">
            No sections are listed for this course this semester.
          </p>
        )}

        {sorted.map((sec, idx) => (
          <article className="icard" key={sec.sectionId}>
            <div className="icard__left">
              <div className="avatar">{initials(sec.name)}</div>
              <Stars value={sec.overallRating} />
              <div className="icard__overall">{fmt(sec.overallRating)}</div>
              <div className="icard__overall-cap">
                Overall · {sec.overallEvaluations ?? 0} evals
              </div>
            </div>

            <div className="icard__body">
              <div className="icard__name">{sec.name}</div>
              <div className="icard__sub">
                {sec.sectionNumber ? `Section ${sec.sectionNumber}` : 'Section —'}
                {sec.meetingText ? ` · ${sec.meetingText}` : ''}
              </div>
              <div className="icard__sub icard__sub--course">
                In this course: <strong>{fmt(sec.courseRating)}</strong>
                {' · '}
                {sec.semestersTaught
                  ? `taught ${sec.semestersTaught} ${
                      sec.semestersTaught === 1 ? 'semester' : 'semesters'
                    }`
                  : 'first time teaching it'}
              </div>

              <div className="icard__metrics">
                <div className="metric">
                  <div className="metric__head">
                    <span>Workload</span>
                    <span className="metric__val">
                      {workloadLabel(sec.avgHoursWeekly)}
                    </span>
                  </div>
                  <div className="metric__bar">
                    <div
                      className="metric__fill"
                      style={{
                        width: `${
                          sec.avgHoursWeekly === null
                            ? 0
                            : (sec.avgHoursWeekly / 5) * 100
                        }%`,
                      }}
                    />
                  </div>
                </div>
                <Metric label="Difficulty" value={sec.intellectuallyChallenging} />
                <Metric label="Attendance" value={sec.attendanceNecessary} />
              </div>
            </div>

            <div className="icard__rank">#{idx + 1}</div>
          </article>
        ))}
      </div>
    </main>
  )
}
