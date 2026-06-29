import type { Request, Response } from "express";
import { supabase } from "../lib/supabase.ts";
import { COLLEGE_LABELS } from "./coursesController.ts";

const DEFAULT_TERM = "2026FALL";

// numeric columns come back from PostgREST as strings.
const num = (v: string | null) => (v === null ? null : Number(v));

type HeaderRow = {
  code: string;
  overall: string | null;
  difficulty: string | null;
  workload: string | null;
  interest: string | null;
  total_evals: number | null;
  course_count: number | null;
  latest_semester: string | null;
};

type ProfessorRow = {
  instructor_id: number;
  name: string | null;
  rating: string | null;
  review_count: number | null;
};

// GET /api/schools/:code
// School profile: header aggregates plus the school's top professors
// (Bayesian-ranked). The Top Classes list is served by /api/courses/explore.
export async function getSchool(req: Request, res: Response): Promise<void> {
  const code = req.params.code;

  // The display name (and the school's existence) come from COLLEGE_LABELS.
  const name = COLLEGE_LABELS[code];
  if (!name) {
    res.status(404).json({ error: "School not found." });
    return;
  }

  const headerResult = await supabase.rpc("get_school", { p_code: code });
  if (headerResult.error) {
    console.error("School lookup failed:", headerResult.error.message);
    res.status(500).json({ error: "School lookup failed." });
    return;
  }

  const header = (headerResult.data ?? [])[0] as HeaderRow | undefined;

  const profResult = await supabase.rpc("rank_school_professors", {
    p_college: code,
    p_limit: 8,
  });
  if (profResult.error) {
    console.error("School professors lookup failed:", profResult.error.message);
    res.status(500).json({ error: "School lookup failed." });
    return;
  }

  const topProfessors = ((profResult.data ?? []) as ProfessorRow[]).map(
    (row) => ({
      id: row.instructor_id,
      name: row.name,
      rating: num(row.rating),
      reviewCount: Number(row.review_count ?? 0),
    })
  );

  res.json({
    school: {
      code,
      name,
      overall: num(header?.overall ?? null),
      difficulty: num(header?.difficulty ?? null),
      workload: num(header?.workload ?? null),
      interest: num(header?.interest ?? null),
      totalEvals: header?.total_evals ?? 0,
      courseCount: header?.course_count ?? 0,
      latestSemester: header?.latest_semester ?? null,
    },
    term: DEFAULT_TERM,
    topProfessors,
  });
}
