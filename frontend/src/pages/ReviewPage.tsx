import { useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { api } from '../lib/api'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { BadgeCheck, Check, GraduationCap } from 'lucide-react'

type CourseInfo = {
  courseCode: string
  title: string | null
  department: string | null
  college: string | null
  coreRequirements: string[]
}

type ProfessorInfo = {
  id: number
  name: string
  department: string | null
  college: string | null
}

// A dropdown option, shared by both flows: course-locked (options are
// professors, grouped current/past) and professor-locked (options are
// courses, flat — no current/past distinction once the professor is fixed).
type Option = { key: string; label: string; isCurrent?: boolean }

const MIN_COMMENT = 20
const MAX_COMMENT = 500

const GUIDELINES = [
  'Be professional and objective.',
  'Focus on the course and teaching experience.',
  'Avoid personal attacks or discriminatory language.',
  'Give specific examples where helpful.',
  'Share information you would have wanted before registering.',
]

export default function ReviewPage() {
  const { courseCode, id: professorId } = useParams()
  const mode: 'course' | 'professor' = courseCode ? 'course' : 'professor'
  const [searchParams] = useSearchParams()
  const preselectKey =
    searchParams.get(mode === 'course' ? 'instructor' : 'course')
  const { session, loading: authLoading, signIn } = useAuth()

  const [lockedCourse, setLockedCourse] = useState<CourseInfo | null>(null)
  const [lockedProfessor, setLockedProfessor] = useState<ProfessorInfo | null>(null)
  const [options, setOptions] = useState<Option[]>([])
  const [selected, setSelected] = useState<Option | null>(null)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [wouldRecommend, setWouldRecommend] = useState<boolean | null>(null)
  const [comment, setComment] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    if (mode !== 'course') return
    fetch(api('/api/courses/' + encodeURIComponent(courseCode!)))
      .then((r) => r.json())
      .then((d: { course: CourseInfo }) => setLockedCourse(d.course))
      .catch(() => {})
  }, [mode, courseCode])

  useEffect(() => {
    if (mode !== 'professor') return
    fetch(api('/api/professors/' + encodeURIComponent(professorId!)))
      .then((r) => r.json())
      .then((d: { professor: ProfessorInfo }) => setLockedProfessor(d.professor))
      .catch(() => {})
  }, [mode, professorId])

  useEffect(() => {
    if (mode === 'course') {
      fetch(api('/api/courses/' + encodeURIComponent(courseCode!) + '/review-professors'))
        .then((r) => r.json())
        .then((d: { professors: { id: number; name: string; isCurrent: boolean }[] }) =>
          setOptions(
            (d.professors ?? []).map((p) => ({
              key: String(p.id),
              label: p.name,
              isCurrent: p.isCurrent,
            }))
          )
        )
        .catch(() => {})
    } else {
      fetch(api('/api/professors/' + encodeURIComponent(professorId!) + '/review-courses'))
        .then((r) => r.json())
        .then((d: { courses: { courseCode: string; title: string | null }[] }) =>
          setOptions(
            (d.courses ?? []).map((c) => ({
              key: c.courseCode,
              label: c.title ? `${c.courseCode} — ${c.title}` : c.courseCode,
            }))
          )
        )
        .catch(() => {})
    }
  }, [mode, courseCode, professorId])

  // If opened with a preselect key (e.g. ?instructor=123 or ?course=CSCI1101),
  // preselect that option once the list loads.
  useEffect(() => {
    if (!preselectKey || selected || options.length === 0) return
    const match = options.find((o) => o.key === preselectKey)
    if (match) setSelected(match)
  }, [preselectKey, options, selected])

  const grouped = mode === 'course'
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options
    if (!grouped) return { primary: list, secondary: [] as Option[] }
    return {
      primary: list.filter((o) => o.isCurrent),
      secondary: list.filter((o) => !o.isCurrent),
    }
  }, [options, query, grouped])

  const commentLen = comment.length
  const commentTrimmedLen = comment.trim().length
  const commentValid = commentTrimmedLen >= MIN_COMMENT && commentLen <= MAX_COMMENT

  const signedIn = !authLoading && !!session
  const canSubmit =
    signedIn && !!selected && wouldRecommend !== null && commentValid && confirmed && !submitting

  const handleSubmit = async () => {
    if (!canSubmit || !selected || wouldRecommend === null || !session) return
    setSubmitting(true)
    setError(null)
    const payload =
      mode === 'course'
        ? {
            course_code: courseCode,
            instructor_id: Number(selected.key),
          }
        : {
            course_code: selected.key,
            instructor_id: Number(professorId),
          }
    const { error: insertError } = await supabase.from('reviews').insert({
      ...payload,
      user_id: session.user.id,
      would_recommend: wouldRecommend,
      comment: comment.trim(),
      source: 'user',
    })
    setSubmitting(false)
    if (insertError) {
      setError(
        insertError.code === '23505'
          ? "You've already reviewed this course with this professor."
          : 'Something went wrong submitting your review. Please try again.'
      )
      return
    }
    setSuccess(true)
  }

  const heading =
    mode === 'course'
      ? lockedCourse
        ? lockedCourse.title
          ? `${lockedCourse.title} (${lockedCourse.courseCode})`
          : lockedCourse.courseCode
        : courseCode
      : lockedProfessor
        ? lockedProfessor.name
        : ''

  const backHref =
    mode === 'course'
      ? `/courses/${encodeURIComponent(courseCode ?? '')}`
      : `/professors/${encodeURIComponent(professorId ?? '')}`

  if (success) {
    return (
      <main className="page review-page">
        <div className="container review-layout">
          <div className="review-section review-form__success">
            <div className="review-form__success-title">
              Thanks! Your review has been submitted.
            </div>
            <p className="review-form__success-sub">
              It'll show up on the {mode === 'course' ? 'course' : 'professor'} page shortly.
            </p>
            <Link to={backHref} className="btn--outline">
              {mode === 'course' ? 'Back to course' : 'Back to professor'}
            </Link>
          </div>
        </div>
      </main>
    )
  }

  if (!signedIn) {
    return (
      <main className="page review-page">
        <div className="container review-layout">
          <h1 className="review-page__title">Review: {heading}</h1>
          <p className="review-page__subtitle">
            Help your fellow Eagles make informed course decisions by sharing your honest
            experience.
          </p>
          {!authLoading && (
            <div className="review-section review-signin">
              <p className="review-signin__note">
                Sign in with your BC Google account to write a review.
              </p>
              <button type="button" className="review-actions__submit" onClick={signIn}>
                Sign in with Google
              </button>
            </div>
          )}
        </div>
      </main>
    )
  }

  return (
    <main className="page review-page">
      <div className="container review-layout">
        <h1 className="review-page__title">Review: {heading}</h1>
        <p className="review-page__subtitle">
          Help your fellow Eagles make informed course decisions by sharing your honest
          experience.
        </p>

        <div className="review-layout__grid">
          <div className="review-layout__main">
            <section className="review-section">
              <h2 className="review-section__heading">
                {mode === 'course' ? '1. Professor Selection' : '1. Course Selection'}
              </h2>
              <div className="review-combo">
                {selected ? (
                  <div className="review-combo__selected">
                    <span className="review-combo__selected-name">{selected.label}</span>
                    <button
                      type="button"
                      className="review-combo__change"
                      onClick={() => {
                        setSelected(null)
                        setQuery('')
                      }}
                    >
                      Change
                    </button>
                  </div>
                ) : (
                  <>
                    <input
                      type="text"
                      className="review-combo__input"
                      placeholder={
                        mode === 'course' ? 'Search for a professor...' : 'Search for a course...'
                      }
                      value={query}
                      onChange={(e) => {
                        setQuery(e.target.value)
                        setOpen(true)
                      }}
                      onFocus={() => setOpen(true)}
                      onBlur={() => setOpen(false)}
                    />
                    {open && (
                      <ul className="review-combo__list">
                        {filtered.primary.length === 0 && filtered.secondary.length === 0 && (
                          <li className="review-combo__list-empty">
                            {mode === 'course' ? 'No professors found.' : 'No courses found.'}
                          </li>
                        )}
                        {filtered.primary.length > 0 && (
                          <>
                            {grouped && (
                              <li className="searchbar__group">Current instructors</li>
                            )}
                            {filtered.primary.map((o) => (
                              <li
                                key={o.key}
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => {
                                  setSelected(o)
                                  setQuery('')
                                  setOpen(false)
                                }}
                              >
                                {o.label}
                              </li>
                            ))}
                          </>
                        )}
                        {filtered.secondary.length > 0 && (
                          <>
                            <li className="searchbar__group">Past instructors</li>
                            {filtered.secondary.map((o) => (
                              <li
                                key={o.key}
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => {
                                  setSelected(o)
                                  setQuery('')
                                  setOpen(false)
                                }}
                              >
                                {o.label}
                              </li>
                            ))}
                          </>
                        )}
                      </ul>
                    )}
                  </>
                )}
              </div>
            </section>

            <section className="review-section">
              <h2 className="review-section__heading">2. Recommendation</h2>
              <p className="review-section__prompt">
                Would you take this course again with this professor?
              </p>
              <div className="review-segmented">
                <button
                  type="button"
                  className={
                    'review-segmented__btn' +
                    (wouldRecommend === true ? ' review-segmented__btn--active' : '')
                  }
                  onClick={() => setWouldRecommend(true)}
                  disabled={!selected}
                >
                  Yes
                </button>
                <button
                  type="button"
                  className={
                    'review-segmented__btn' +
                    (wouldRecommend === false ? ' review-segmented__btn--active' : '')
                  }
                  onClick={() => setWouldRecommend(false)}
                  disabled={!selected}
                >
                  No
                </button>
              </div>
            </section>

            <section className="review-section">
              <div className="review-section__head-row">
                <h2 className="review-section__heading">3. Student Comment</h2>
                <span className="review-section__counter">
                  {commentLen} / {MAX_COMMENT} characters
                </span>
              </div>
              <textarea
                className="review-form__textarea"
                placeholder="What was the teaching style like? How were assignments and exams? What should future students know?"
                value={comment}
                onChange={(e) => setComment(e.target.value.slice(0, MAX_COMMENT))}
                disabled={!selected}
              />
              {commentLen > 0 && commentTrimmedLen < MIN_COMMENT && (
                <p className="review-section__min-note">
                  Minimum {MIN_COMMENT} characters required.
                </p>
              )}
            </section>

            <label className="review-confirm">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              <span>
                I confirm that I took this course at Boston College and that this feedback is
                based on my personal experience. I understand that fraudulent reviews may be
                removed.
              </span>
            </label>

            <div className="review-actions">
              <Link to={backHref} className="review-actions__cancel">
                Cancel &amp; Return
              </Link>
              <button
                type="button"
                className="review-actions__submit"
                onClick={handleSubmit}
                disabled={!canSubmit}
              >
                Submit Review
              </button>
            </div>
            {error && <p className="review-form__error">{error}</p>}
          </div>

          <aside className="review-sidebar">
            <div className="review-sidebar__card">
              <h3 className="review-sidebar__heading">
                <GraduationCap size={18} />
                Guidelines
              </h3>
              <ul className="review-sidebar__list">
                {GUIDELINES.map((g) => (
                  <li key={g}>
                    <Check size={14} />
                    <span>{g}</span>
                  </li>
                ))}
              </ul>
              <hr className="review-sidebar__divider" />
              <div className="review-sidebar__verified">
                <BadgeCheck size={16} />
                <div>
                  <strong>Verified Student Body</strong>
                  <p>
                    Reviews are displayed anonymously, but the reviewer's identity as an
                    authenticated Boston College student is used to protect the integrity of
                    the platform.
                  </p>
                </div>
              </div>
            </div>

            {mode === 'course' && lockedCourse && (
              <div className="review-sidebar__card review-sidebar__course">
                <div className="review-sidebar__label">Course Code</div>
                <div className="review-sidebar__course-code">{lockedCourse.courseCode}</div>
                {lockedCourse.title && (
                  <div className="review-sidebar__course-title">{lockedCourse.title}</div>
                )}
                {(lockedCourse.coreRequirements.length > 0 ||
                  lockedCourse.department ||
                  lockedCourse.college) && <hr className="review-sidebar__divider" />}
                <div className="review-sidebar__stats">
                  {lockedCourse.coreRequirements.length > 0 && (
                    <div>
                      <div className="review-sidebar__label">Core Requirement</div>
                      <div className="review-sidebar__stat-val">
                        {lockedCourse.coreRequirements.join(', ')}
                      </div>
                    </div>
                  )}
                  {lockedCourse.department && (
                    <div>
                      <div className="review-sidebar__label">Department</div>
                      <div className="review-sidebar__stat-val">{lockedCourse.department}</div>
                    </div>
                  )}
                  {lockedCourse.college && (
                    <div>
                      <div className="review-sidebar__label">School</div>
                      <div className="review-sidebar__stat-val">{lockedCourse.college}</div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {mode === 'professor' && lockedProfessor && (
              <div className="review-sidebar__card review-sidebar__course">
                <div className="review-sidebar__label">Professor</div>
                <div className="review-sidebar__course-code">{lockedProfessor.name}</div>
                {(lockedProfessor.department || lockedProfessor.college) && (
                  <hr className="review-sidebar__divider" />
                )}
                <div className="review-sidebar__stats">
                  {lockedProfessor.department && (
                    <div>
                      <div className="review-sidebar__label">Department</div>
                      <div className="review-sidebar__stat-val">
                        {lockedProfessor.department}
                      </div>
                    </div>
                  )}
                  {lockedProfessor.college && (
                    <div>
                      <div className="review-sidebar__label">School</div>
                      <div className="review-sidebar__stat-val">{lockedProfessor.college}</div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </aside>
        </div>
      </div>
    </main>
  )
}
