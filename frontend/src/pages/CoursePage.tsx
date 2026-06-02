import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  Star,
  SlidersHorizontal,
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  ChevronDown,
  ChevronUp,
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

type SortKey = 'rating' | 'challenging' | 'hours'
type SortDir = 'desc' | 'asc'

const sortOptions: { key: SortKey; label: string; field: keyof Professor }[] = [
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

export default function CoursePage() {
  const { courseCode = '' } = useParams()
  const [course, setCourse] = useState<Course | null>(null)
  const [sections, setSections] = useState<Section[]>([])
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [sort, setSort] = useState<SortKey>('rating')
  const [dir, setDir] = useState<SortDir>('desc')
  const [expanded, setExpanded] = useState<Set<number>>(new Set())

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

  const toggle = (id: number) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
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
              <div className="stat-box__label">Workload</div>
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

        {sorted.map((prof, idx) => {
          const open = expanded.has(prof.instructorId)
          return (
            <article className="pcard" key={prof.instructorId}>
              <div className="pcard__main">
                <div className="pcard__rank">#{idx + 1}</div>

                <div className="pcard__left">
                  <div className="avatar">{initials(prof.name)}</div>
                  <Stars value={prof.overallRating} />
                  <div className="pcard__overall">{fmt(prof.overallRating)}</div>
                  <div className="pcard__overall-cap">
                    Overall · {prof.overallEvaluations ?? 0} evals
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
                      <button
                        type="button"
                        className="pcard__toggle"
                        onClick={() => toggle(prof.instructorId)}
                      >
                        {open ? 'Hide Sections' : 'Show Sections'}
                        {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {open && (
                <div className="pcard__sections">
                  <div className="pcard__sections-title">Available Sections</div>
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
            </article>
          )
        })}
      </div>
    </main>
  )
}
