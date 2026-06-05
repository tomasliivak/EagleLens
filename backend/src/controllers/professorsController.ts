import type { Request, Response } from "express";
import { supabase } from "../lib/supabase.ts";
import { COLLEGE_LABELS } from "./coursesController.ts";

const DEFAULT_TERM = "2026FALL";

// numeric columns come back from PostgREST as strings.
const num = (v: string | null) => (v === null ? null : Number(v));

type HeaderRow = {
  id: number;
  name: string;
  overall: string | null;
  difficulty: string | null;
  workload: string | null;
  interest: string | null;
  total_evals: number | null;
  department: string | null;
  college: string | null;
  latest_semester: string | null;
};

type SectionRow = {
  course_code: string;
  title: string | null;
  credits: number | null;
  meeting_text: string | null;
  rating: string | null;
  difficulty: string | null;
  workload: string | null;
  evaluation_count: number | null;
};

type CourseRow = {
  course_code: string;
  title: string | null;
  rating: string | null;
  difficulty: string | null;
  workload: string | null;
  evaluation_count: number | null;
  total_responses: number | null;
};

// GET /api/professors/:id
// Professor profile: header aggregates, courses taught this term, and the full
// historical catalog (also the source for the highlights shown on the page).
export async function getProfessor(req: Request, res: Response): Promise<void> {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(404).json({ error: "Professor not found." });
    return;
  }

  const [headerResult, sectionsResult, coursesResult] = await Promise.all([
    supabase.rpc("get_professor", { p_id: id }),
    supabase.rpc("get_professor_sections", { p_id: id, p_term: DEFAULT_TERM }),
    supabase.rpc("get_professor_courses", { p_id: id }),
  ]);

  const error =
    headerResult.error ?? sectionsResult.error ?? coursesResult.error;
  if (error) {
    console.error("Professor lookup failed:", error.message);
    res.status(500).json({ error: "Professor lookup failed." });
    return;
  }

  const header = (headerResult.data ?? [])[0] as HeaderRow | undefined;
  if (!header) {
    res.status(404).json({ error: "Professor not found." });
    return;
  }

  const collegeCode = header.college;
  const college = collegeCode
    ? COLLEGE_LABELS[collegeCode] ?? collegeCode
    : null;

  const currentSections = ((sectionsResult.data ?? []) as SectionRow[]).map(
    (row) => ({
      courseCode: row.course_code,
      title: row.title,
      credits: row.credits,
      meetingText: row.meeting_text,
      rating: num(row.rating),
      difficulty: num(row.difficulty),
      workload: num(row.workload),
      evaluations: row.evaluation_count,
    })
  );

  const courses = ((coursesResult.data ?? []) as CourseRow[]).map((row) => ({
    courseCode: row.course_code,
    title: row.title,
    rating: num(row.rating),
    difficulty: num(row.difficulty),
    workload: num(row.workload),
    evaluations: row.evaluation_count,
    responses: row.total_responses,
  }));

  res.json({
    professor: {
      id: header.id,
      name: header.name,
      department: header.department,
      college,
      overall: num(header.overall),
      difficulty: num(header.difficulty),
      workload: num(header.workload),
      interest: num(header.interest),
      totalEvals: header.total_evals,
      latestSemester: header.latest_semester,
    },
    term: DEFAULT_TERM,
    currentSections,
    courses,
  });
}
