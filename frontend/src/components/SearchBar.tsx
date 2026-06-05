import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search } from 'lucide-react'
import { api } from '../lib/api'

type SearchResults = {
  courses: { courseCode: string; title: string | null }[]
  professors: { id: number; name: string }[]
  departments: { code: string; name: string }[]
  schools: { code: string; name: string }[]
}

const emptyResults: SearchResults = {
  courses: [],
  professors: [],
  departments: [],
  schools: [],
}

const trending = ['CSCI 1101', 'ECON 1101', 'MATH 1100', 'PHIL 1070', 'ENGL 1010']

// Course codes are stored without spaces (e.g. "CSCI1101").
const toCourseCode = (raw: string) => raw.trim().toUpperCase().replace(/\s+/g, '')

export default function SearchBar({
  variant = 'hero',
}: {
  variant?: 'hero' | 'nav'
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResults>(emptyResults)
  const debounce = useRef<ReturnType<typeof setTimeout>>()
  const navigate = useNavigate()

  function go(path: string) {
    setResults(emptyResults)
    navigate(path)
  }

  function goToCourse(courseCode: string) {
    if (!courseCode) return
    go('/courses/' + encodeURIComponent(courseCode))
  }

  function onInput(value: string) {
    setQuery(value)
    clearTimeout(debounce.current)
    const term = value.trim()
    if (!term) {
      setResults(emptyResults)
      return
    }
    debounce.current = setTimeout(async () => {
      const res = await fetch(api('/api/search?q=' + encodeURIComponent(term)))
      const data: SearchResults = await res.json()
      setResults(data)
    }, 200)
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    // Prefer the first live suggestion (courses first), else treat the input as
    // a course code.
    if (results.courses[0]) goToCourse(results.courses[0].courseCode)
    else if (results.professors[0]) go('/professors/' + results.professors[0].id)
    else if (results.departments[0])
      go('/departments/' + encodeURIComponent(results.departments[0].code))
    else if (results.schools[0])
      go('/schools/' + encodeURIComponent(results.schools[0].code))
    else goToCourse(toCourseCode(query))
  }

  const hasResults =
    results.courses.length > 0 ||
    results.professors.length > 0 ||
    results.departments.length > 0 ||
    results.schools.length > 0

  const suggestionList = hasResults && (
    <ul className="searchbar__suggestions">
      {results.courses.length > 0 && (
        <li className="searchbar__group">Courses</li>
      )}
      {results.courses.map((c) => (
        <li key={'c-' + c.courseCode} onClick={() => goToCourse(c.courseCode)}>
          <span className="code">{c.courseCode}</span>
          <span>{c.title}</span>
        </li>
      ))}

      {results.professors.length > 0 && (
        <li className="searchbar__group">Professors</li>
      )}
      {results.professors.map((p) => (
        <li key={'p-' + p.id} onClick={() => go('/professors/' + p.id)}>
          <span>{p.name}</span>
        </li>
      ))}

      {results.departments.length > 0 && (
        <li className="searchbar__group">Departments</li>
      )}
      {results.departments.map((d) => (
        <li
          key={'d-' + d.code}
          onClick={() => go('/departments/' + encodeURIComponent(d.code))}
        >
          <span className="code">{d.code}</span>
          <span>{d.name}</span>
        </li>
      ))}

      {results.schools.length > 0 && (
        <li className="searchbar__group">Schools</li>
      )}
      {results.schools.map((s) => (
        <li
          key={'s-' + s.code}
          onClick={() => go('/schools/' + encodeURIComponent(s.code))}
        >
          <span>{s.name}</span>
        </li>
      ))}
    </ul>
  )

  if (variant === 'nav') {
    return (
      <div className="searchbar searchbar--nav">
        <form className="searchbar__box" onSubmit={onSubmit}>
          <Search size={18} className="searchbar__icon" />
          <input
            className="searchbar__input"
            type="text"
            value={query}
            placeholder="Search..."
            autoComplete="off"
            onChange={(e) => onInput(e.target.value)}
          />
        </form>
        {suggestionList}
      </div>
    )
  }

  return (
    <div className="searchbar">
      <form className="searchbar__box" onSubmit={onSubmit}>
        <Search size={20} className="searchbar__icon" />
        <input
          className="searchbar__input"
          type="text"
          value={query}
          placeholder="Search by course, professor, department, or school..."
          autoComplete="off"
          onChange={(e) => onInput(e.target.value)}
        />
        <button type="submit" className="searchbar__btn">
          Search
        </button>
      </form>

      {suggestionList}

      <div className="trending">
        <span className="trending__label">Try searching:</span>
        {trending.map((t) => (
          <button
            key={t}
            className="pill"
            onClick={() => goToCourse(toCourseCode(t))}
          >
            {t}
          </button>
        ))}
      </div>
    </div>
  )
}
