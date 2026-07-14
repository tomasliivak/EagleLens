import { useEffect, useState } from 'react'
import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'

/* ---------------------------------------------------------------------- *
 * Saved Courses — temporarily disabled.
 *
 * There's no "save a course" button anywhere in the app yet, so this
 * section has nothing to show. The working implementation (state, fetch
 * effect, sort logic, unsave handler, and the table JSX) is commented out
 * rather than deleted so it can be reinstated with a straight uncomment
 * once that feature ships. Needs these imports when re-enabled:
 *   import { Link } from 'react-router-dom'
 *   import { Trash2 } from 'lucide-react'
 *   import { api } from '../lib/api'
 *   import { difficultyLabel } from '../lib/difficulty'
 * and `useMemo` added back to the React import.

type SavedCourse = {
  courseCode: string
  title: string | null
  department: string | null
  college: string | null
  avgRating: number | null
  difficulty: number | null
  avgWorkload: number | null
  evaluationCount: number
}

type SortMetric = 'rating' | 'difficulty' | 'workload' | 'evals'

const SAVED_METRICS: { key: SortMetric; label: string }[] = [
  { key: 'rating', label: 'Rating' },
  { key: 'difficulty', label: 'Difficulty' },
  { key: 'workload', label: 'Workload' },
  { key: 'evals', label: 'Evaluations' },
]

const PAGE_SIZE = 10

const fmt2 = (v: number | null) => (v === null ? '—' : v.toFixed(2))

const workloadLabel = (v: number | null) => {
  if (v === null) return '—'
  if (v >= 3.5) return 'Heavy'
  if (v >= 2.3) return 'Moderate'
  return 'Light'
}
 * ---------------------------------------------------------------------- */

type MyReview = {
  id: number
  courseCode: string
  wouldRecommend: boolean
  comment: string
  instructorName: string
}

const MIN_COMMENT = 20
const MAX_COMMENT = 500

// PostgREST embeds a to-one relation as an object, but can come back as a
// single-element array depending on the relationship inference — handle both.
const one = <T,>(rel: T | T[] | null | undefined): T | null =>
  Array.isArray(rel) ? rel[0] ?? null : rel ?? null

export default function AccountPage() {
  const { session, loading, signIn, signOut } = useAuth()

  const [reviews, setReviews] = useState<MyReview[]>([])
  const [reviewsLoading, setReviewsLoading] = useState(true)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editWouldRecommend, setEditWouldRecommend] = useState<boolean | null>(null)
  const [editComment, setEditComment] = useState('')
  const [editSaving, setEditSaving] = useState(false)

  /* Saved Courses fetch effect — disabled, see block above.
  useEffect(() => {
    if (!session) return
    let active = true
    setSavedLoading(true)
    supabase
      .from('saved_courses')
      .select('course_code')
      .eq('user_id', session.user.id)
      .then(({ data, error }) => {
        if (!active) return
        const codes = !error && data ? data.map((r) => r.course_code as string) : []
        if (codes.length === 0) {
          setSavedCourses([])
          setSavedLoading(false)
          return
        }
        fetch(api('/api/courses/by-codes?codes=' + encodeURIComponent(codes.join(','))))
          .then((r) => r.json())
          .then((d: { courses: SavedCourse[] }) => {
            if (active) setSavedCourses(d.courses ?? [])
          })
          .finally(() => {
            if (active) setSavedLoading(false)
          })
      })
    return () => {
      active = false
    }
  }, [session])
  */

  useEffect(() => {
    if (!session) return
    let active = true
    setReviewsLoading(true)
    supabase
      .from('reviews')
      .select('id, course_code, would_recommend, comment, created_at, instructors(canonical_name)')
      .eq('user_id', session.user.id)
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (!active) return
        if (!error && data) {
          setReviews(
            data.map((r) => ({
              id: r.id,
              courseCode: r.course_code,
              wouldRecommend: r.would_recommend,
              comment: r.comment,
              instructorName:
                one(r.instructors as { canonical_name: string } | { canonical_name: string }[] | null)
                  ?.canonical_name ?? 'Unknown Professor',
            }))
          )
        }
        setReviewsLoading(false)
      })
    return () => {
      active = false
    }
  }, [session])

  /* Saved Courses derived state + unsave handler — disabled, see block above.
  const sortedSaved = useMemo(() => {
    const pick = (c: SavedCourse) => {
      switch (sortMetric) {
        case 'rating':
          return c.avgRating
        case 'difficulty':
          return c.difficulty
        case 'workload':
          return c.avgWorkload
        case 'evals':
          return c.evaluationCount
      }
    }
    return [...savedCourses].sort((a, b) => {
      const av = pick(a)
      const bv = pick(b)
      if (av === null && bv === null) return 0
      if (av === null) return 1
      if (bv === null) return -1
      return (bv as number) - (av as number)
    })
  }, [savedCourses, sortMetric])

  const visibleSaved = sortedSaved.slice(0, visibleCount)
  const hasMoreSaved = visibleCount < sortedSaved.length

  const unsave = (courseCode: string) => {
    if (!session) return
    setSavedCourses((prev) => prev.filter((c) => c.courseCode !== courseCode))
    supabase
      .from('saved_courses')
      .delete()
      .eq('user_id', session.user.id)
      .eq('course_code', courseCode)
      .then()
  }
  */

  const startEdit = (r: MyReview) => {
    setEditingId(r.id)
    setEditWouldRecommend(r.wouldRecommend)
    setEditComment(r.comment)
  }

  const cancelEdit = () => setEditingId(null)

  const editCommentValid =
    editComment.trim().length >= MIN_COMMENT && editComment.length <= MAX_COMMENT

  const saveEdit = async (id: number) => {
    if (editWouldRecommend === null || !editCommentValid) return
    setEditSaving(true)
    const trimmed = editComment.trim()
    const { error } = await supabase
      .from('reviews')
      .update({ would_recommend: editWouldRecommend, comment: trimmed })
      .eq('id', id)
    setEditSaving(false)
    if (!error) {
      setReviews((prev) =>
        prev.map((r) =>
          r.id === id ? { ...r, wouldRecommend: editWouldRecommend, comment: trimmed } : r
        )
      )
      setEditingId(null)
    }
  }

  const removeReview = (id: number) => {
    if (!window.confirm('Remove this review? This cannot be undone.')) return
    setReviews((prev) => prev.filter((r) => r.id !== id))
    supabase.from('reviews').delete().eq('id', id).then()
  }

  if (loading) return null

  if (!session) {
    return (
      <main className="page">
        <div className="container">
          <h1 className="page__heading">Account</h1>
          <p className="placeholder-note">Sign in with your BC Google account.</p>
          <button className="review-actions__submit" onClick={signIn}>
            Sign in with Google
          </button>
        </div>
      </main>
    )
  }

  return (
    <main className="page">
      <div className="container">
        <div className="account-header">
          <h1 className="account-header__title">My Account</h1>
          <button className="btn--outline" onClick={signOut}>
            Sign Out
          </button>
        </div>

        <section className="account-reviews">
          <h2>My Reviews</h2>

          {reviewsLoading && <p className="placeholder-note">Loading…</p>}
          {!reviewsLoading && reviews.length === 0 && (
            <p className="placeholder-note">You haven't written any reviews yet.</p>
          )}

          <div className="account-reviews__grid">
            {reviews.map((r) => (
              <div className="account-review-card" key={r.id}>
                {editingId === r.id ? (
                  <>
                    <div className="account-review-card__head">
                      <div>
                        <div className="account-review-card__name">{r.instructorName}</div>
                        <div className="account-review-card__course">{r.courseCode}</div>
                      </div>
                    </div>
                    <div className="review-segmented" style={{ margin: '10px 0' }}>
                      <button
                        type="button"
                        className={
                          'review-segmented__btn' +
                          (editWouldRecommend === true ? ' review-segmented__btn--active' : '')
                        }
                        onClick={() => setEditWouldRecommend(true)}
                      >
                        Yes
                      </button>
                      <button
                        type="button"
                        className={
                          'review-segmented__btn' +
                          (editWouldRecommend === false ? ' review-segmented__btn--active' : '')
                        }
                        onClick={() => setEditWouldRecommend(false)}
                      >
                        No
                      </button>
                    </div>
                    <textarea
                      className="review-form__textarea"
                      value={editComment}
                      onChange={(e) => setEditComment(e.target.value.slice(0, MAX_COMMENT))}
                    />
                    <div className="review-section__counter">
                      {editComment.length} / {MAX_COMMENT} characters
                    </div>
                    <div className="account-review-card__actions">
                      <button
                        type="button"
                        className="review-actions__cancel"
                        onClick={cancelEdit}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="review-actions__submit"
                        onClick={() => saveEdit(r.id)}
                        disabled={editWouldRecommend === null || !editCommentValid || editSaving}
                      >
                        {editSaving ? 'Saving…' : 'Save'}
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="account-review-card__head">
                      <div>
                        <div className="account-review-card__name">{r.instructorName}</div>
                        <div className="account-review-card__course">{r.courseCode}</div>
                      </div>
                      <span
                        className={
                          'account-review-card__badge ' +
                          (r.wouldRecommend
                            ? 'account-review-card__badge--yes'
                            : 'account-review-card__badge--no')
                        }
                      >
                        {r.wouldRecommend ? 'Would Recommend' : 'Would Not Recommend'}
                      </span>
                    </div>
                    <p className="account-review-card__quote">&ldquo;{r.comment}&rdquo;</p>
                    <div className="account-review-card__actions">
                      <button type="button" onClick={() => startEdit(r)}>
                        Edit
                      </button>
                      <button type="button" onClick={() => removeReview(r.id)}>
                        Remove
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  )
}
