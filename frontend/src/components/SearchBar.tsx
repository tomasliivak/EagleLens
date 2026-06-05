import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search } from 'lucide-react'
import { api } from '../lib/api'

type CourseSuggestion = { courseCode: string; title: string | null }

const trending = ['CSCI 1101', 'ECON 1101']

// Course codes are stored without spaces (e.g. "CSCI1101").
const toCourseCode = (raw: string) => raw.trim().toUpperCase().replace(/\s+/g, '')

export default function SearchBar({
  variant = 'hero',
}: {
  variant?: 'hero' | 'nav'
}) {
  const [query, setQuery] = useState('')
  const [suggestions, setSuggestions] = useState<CourseSuggestion[]>([])
  const debounce = useRef<ReturnType<typeof setTimeout>>()
  const navigate = useNavigate()

  function goToCourse(courseCode: string) {
    if (!courseCode) return
    setSuggestions([])
    navigate('/courses/' + encodeURIComponent(courseCode))
  }

  function onInput(value: string) {
    setQuery(value)
    clearTimeout(debounce.current)
    const term = value.trim()
    if (!term) {
      setSuggestions([])
      return
    }
    debounce.current = setTimeout(async () => {
      const res = await fetch(api('/api/courses/search?q=' + encodeURIComponent(term)))
      const data: { courses: CourseSuggestion[] } = await res.json()
      setSuggestions(data.courses)
    }, 200)
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    goToCourse(toCourseCode(query))
  }

  const suggestionList = suggestions.length > 0 && (
    <ul className="searchbar__suggestions">
      {suggestions.map((c) => (
        <li key={c.courseCode} onClick={() => goToCourse(c.courseCode)}>
          <span className="code">{c.courseCode}</span>
          <span>{c.title}</span>
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
            placeholder="Search courses..."
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
          placeholder="Search by course code, professor, or topic..."
          autoComplete="off"
          onChange={(e) => onInput(e.target.value)}
        />
        <button type="submit" className="searchbar__btn">
          Search
        </button>
      </form>

      {suggestionList}

      <div className="trending">
        <span className="trending__label">Trending:</span>
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
