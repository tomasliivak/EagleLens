// Difficulty = course_intellectually_challenging (1–5, higher = harder). Raw data is
// skewed high (mean ~4.4), so cutoffs are data-derived terciles of the professor
// difficulty distribution, not naive 1–5 thirds. Recompute: percentile_cont(0.3333 /
// 0.6667) of ranking_professors.difficulty.
export const DIFFICULTY_HARD_MIN = 4.5
export const DIFFICULTY_EASY_MAX = 4.25

export const difficultyLabel = (v: number | null): string => {
  if (v === null) return '—'
  if (v >= DIFFICULTY_HARD_MIN) return 'Hard'
  if (v >= DIFFICULTY_EASY_MAX) return 'Moderate'
  return 'Easy'
}
