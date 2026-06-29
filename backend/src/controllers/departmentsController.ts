import type { Request, Response } from "express";
import { supabase } from "../lib/supabase.ts";
import { COLLEGE_LABELS } from "./coursesController.ts";

const DEFAULT_TERM = "2026FALL";

// numeric columns come back from PostgREST as strings.
const num = (v: string | null) => (v === null ? null : Number(v));

type HeaderRow = {
  code: string;
  name: string | null;
  college: string | null;
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

// GET /api/departments/:code
// Department profile: header aggregates plus the department's top professors
// (Bayesian-ranked). The Top Classes list is served by /api/courses/explore.
export async function getDepartment(req: Request, res: Response): Promise<void> {
  const code = req.params.code;

  const headerResult = await supabase.rpc("get_department", { p_code: code });
  if (headerResult.error) {
    console.error("Department lookup failed:", headerResult.error.message);
    res.status(500).json({ error: "Department lookup failed." });
    return;
  }

  const header = (headerResult.data ?? [])[0] as HeaderRow | undefined;
  if (!header || !header.name) {
    res.status(404).json({ error: "Department not found." });
    return;
  }

  const profResult = await supabase.rpc("rank_department_professors", {
    p_department: header.name,
    p_limit: 8,
  });
  if (profResult.error) {
    console.error("Department professors lookup failed:", profResult.error.message);
    res.status(500).json({ error: "Department lookup failed." });
    return;
  }

  const collegeCode = header.college;
  const college = collegeCode
    ? COLLEGE_LABELS[collegeCode] ?? collegeCode
    : null;

  const topProfessors = ((profResult.data ?? []) as ProfessorRow[]).map(
    (row) => ({
      id: row.instructor_id,
      name: row.name,
      rating: num(row.rating),
      reviewCount: Number(row.review_count ?? 0),
    })
  );

  res.json({
    department: {
      code: header.code,
      name: header.name,
      college,
      overall: num(header.overall),
      difficulty: num(header.difficulty),
      workload: num(header.workload),
      interest: num(header.interest),
      totalEvals: header.total_evals,
      courseCount: header.course_count,
      latestSemester: header.latest_semester,
    },
    term: DEFAULT_TERM,
    topProfessors,
  });
}
