import type { Request, Response } from "express";
import { supabase } from "../lib/supabase.ts";

const DEFAULT_TERM = "2026FALL";

// numeric columns come back from PostgREST as strings; counts as numbers.
type SectionRow = {
  section_id: number;
  section_number: string | null;
  meeting_text: string | null;
  instructor_id: number;
  instructor_name: string;
  overall_rating: string | null;
  overall_evaluations: number | null;
  course_rating: string | null;
  course_evaluations: number | null;
};

// GET /api/courses/search?q=...
// Autocomplete: matches the query against course code or title.
export async function searchCourses(
  req: Request,
  res: Response
): Promise<void> {
  const q = req.query.q;

  if (typeof q !== "string" || !q.trim()) {
    res.json({ courses: [] });
    return;
  }

  const term = q.trim();
  const { data, error } = await supabase
    .from("courses")
    .select("course_code, title")
    .or(`course_code.ilike.%${term}%,title.ilike.%${term}%`)
    .order("course_code")
    .limit(10);

  if (error) {
    console.error("Course search failed:", error.message);
    res.status(500).json({ error: "Course search failed." });
    return;
  }

  res.json({
    courses: (data ?? []).map((c) => ({
      courseCode: c.course_code,
      title: c.title,
    })),
  });
}

// GET /api/courses/:courseCode/professors?term=2026FALL
// Every section of the course in the term (repeat professors included), with
// meeting text and ratings, sorted by overall rating (desc).
export async function getCourseProfessors(
  req: Request,
  res: Response
): Promise<void> {
  const courseCode = req.params.courseCode;
  const term =
    typeof req.query.term === "string" && req.query.term.trim()
      ? req.query.term.trim()
      : DEFAULT_TERM;

  const { data, error } = await supabase.rpc("get_course_professors", {
    p_course_code: courseCode,
    p_term: term,
  });

  if (error) {
    console.error("Professor lookup failed:", error.message);
    res.status(500).json({ error: "Professor lookup failed." });
    return;
  }

  res.json({
    courseCode,
    term,
    sections: ((data ?? []) as SectionRow[]).map((row) => ({
      sectionId: row.section_id,
      sectionNumber: row.section_number,
      meetingText: row.meeting_text,
      instructorId: row.instructor_id,
      name: row.instructor_name,
      overallRating: row.overall_rating,
      overallEvaluations: row.overall_evaluations,
      courseRating: row.course_rating,
      courseEvaluations: row.course_evaluations,
    })),
  });
}
