import { useRef, useState } from 'react'
import './App.css'

type CourseSuggestion = { courseCode: string; title: string | null }

type SectionRow = {
  sectionId: number
  sectionNumber: string | null
  meetingText: string | null
  instructorId: number
  name: string
  overallRating: string | null
  overallEvaluations: number | null
  courseRating: string | null
  courseEvaluations: number | null
}

const fmt = (v: string | null) =>
  v === null || v === undefined ? null : Number(v).toFixed(2)

function App() {
  const [query, setQuery] = useState('')
  const [suggestions, setSuggestions] = useState<CourseSuggestion[]>([])
  const [selected, setSelected] = useState<CourseSuggestion | null>(null)
  const [sections, setSections] = useState<SectionRow[]>([])
  const [loading, setLoading] = useState(false)
  const debounce = useRef<ReturnType<typeof setTimeout>>()

  function onInput(value: string) {
    setQuery(value)
    clearTimeout(debounce.current)
    const term = value.trim()
    if (!term) {
      setSuggestions([])
      return
    }
    debounce.current = setTimeout(async () => {
      const res = await fetch('/api/courses/search?q=' + encodeURIComponent(term))
      const data: { courses: CourseSuggestion[] } = await res.json()
      setSuggestions(data.courses)
    }, 200)
  }

  async function selectCourse(course: CourseSuggestion) {
    setSelected(course)
    setQuery(`${course.courseCode} — ${course.title ?? ''}`)
    setSuggestions([])
    setLoading(true)
    const res = await fetch(
      '/api/courses/' + encodeURIComponent(course.courseCode) + '/professors',
    )
    const data: { sections: SectionRow[] } = await res.json()
    setSections(data.sections)
    setLoading(false)
  }

  return (
    <main className="page">
      <h1>PlanUrBC</h1>

      <div className="search">
        <input
          type="text"
          value={query}
          placeholder="Search a course (e.g. Computer Science I or CSCI1101)"
          autoComplete="off"
          onChange={(e) => onInput(e.target.value)}
        />
        {suggestions.length > 0 && (
          <ul className="suggestions">
            {suggestions.map((c) => (
              <li key={c.courseCode} onClick={() => selectCourse(c)}>
                <span className="code">{c.courseCode}</span>
                <span>{c.title}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {loading && <p className="muted">Loading…</p>}

      {!loading && selected && sections.length === 0 && (
        <p className="muted">No sections found for this course in the fall.</p>
      )}

      {!loading && sections.length > 0 && (
        <section className="results">
          <h2>
            Sections of {selected?.courseCode} this fall ({sections.length})
          </h2>
          {sections.map((s) => {
            const overall = fmt(s.overallRating)
            const courseRating = fmt(s.courseRating)
            return (
              <div className="section-card" key={s.sectionId}>
                <div className="info">
                  <div className="name">{s.name}</div>
                  <div className="meeting">
                    <span className="sec">Section {s.sectionNumber}</span>
                    {s.meetingText}
                  </div>
                  <div className="sub">
                    {courseRating !== null
                      ? `In this class: ${courseRating} (${s.courseEvaluations} evals)`
                      : 'No evaluations for this class'}
                    {' · '}
                    {s.overallEvaluations ?? 0} total evals
                  </div>
                </div>
                {overall !== null ? (
                  <div className="rating" title="Overall rating across all classes">
                    {overall}
                  </div>
                ) : (
                  <div className="rating na">no rating</div>
                )}
              </div>
            )
          })}
        </section>
      )}
    </main>
  )
}

export default App
