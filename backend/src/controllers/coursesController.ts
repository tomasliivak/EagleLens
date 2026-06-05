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

// GET /api/search?q=...
// Multi-entity autocomplete: courses, professors, departments, and schools.
export async function search(req: Request, res: Response): Promise<void> {
  const q = req.query.q;
  const empty = { courses: [], professors: [], departments: [], schools: [] };

  if (typeof q !== "string" || !q.trim()) {
    res.json(empty);
    return;
  }

  const term = q.trim();

  const [courseResult, profResult, deptResult] = await Promise.all([
    supabase
      .from("courses")
      .select("course_code, title")
      .or(`course_code.ilike.%${term}%,title.ilike.%${term}%`)
      .order("course_code")
      .limit(5),
    supabase
      .from("instructors")
      .select("id, canonical_name")
      .ilike("canonical_name", `%${term}%`)
      .order("canonical_name")
      .limit(5),
    supabase
      .from("departments")
      .select("code, name")
      .or(`name.ilike.%${term}%,code.ilike.%${term}%`)
      .not("name", "is", null)
      .order("name")
      .limit(5),
  ]);

  const error = courseResult.error ?? profResult.error ?? deptResult.error;
  if (error) {
    console.error("Search failed:", error.message);
    res.status(500).json({ error: "Search failed." });
    return;
  }

  const courses = (courseResult.data ?? []).map((c) => ({
    courseCode: c.course_code,
    title: c.title,
  }));

  const professors = (profResult.data ?? []).map((p) => ({
    id: p.id,
    name: p.canonical_name,
  }));

  // Dedupe departments by code (codes can repeat across colleges).
  const deptByCode = new Map<string, string>();
  for (const d of deptResult.data ?? []) {
    if (!deptByCode.has(d.code)) deptByCode.set(d.code, d.name as string);
  }
  const departments = [...deptByCode].map(([code, name]) => ({ code, name }));

  const needle = term.toLowerCase();
  const schools = Object.entries(COLLEGE_LABELS)
    .filter(
      ([code, label]) =>
        code.toLowerCase().includes(needle) ||
        label.toLowerCase().includes(needle)
    )
    .slice(0, 5)
    .map(([code, name]) => ({ code, name }));

  res.json({ courses, professors, departments, schools });
}

// Readable names for BC's college codes.
export const COLLEGE_LABELS: Record<string, string> = {
  MCAS: "Arts & Sciences",
  CSOM: "Carroll School of Management",
  CSON: "Connell School of Nursing",
  LSOE: "Lynch School of Education",
  LAW: "Law School",
  STM: "School of Theology & Ministry",
  SSW: "School of Social Work",
  MCBC: "Woods College",
};

type SectionRatingRow = {
  section_id: number;
  section_number: string | null;
  meeting_text: string | null;
  instructor_id: number;
  instructor_name: string;
  overall_rating: string | null;
  overall_evaluations: number | null;
  course_rating: string | null;
  course_evaluations: number | null;
  semesters_taught: number | null;
  intellectually_challenging: string | null;
  avg_hours_weekly: string | null;
  attendance_necessary: string | null;
};

const num = (v: string | null) => (v === null ? null : Number(v));
const avg = (xs: number[]) =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;

// PostgREST embeds can come back as an object or a single-element array.
const one = <T>(rel: T | T[] | null): T | null =>
  Array.isArray(rel) ? rel[0] ?? null : rel ?? null;

// GET /api/courses/:courseCode?term=2026FALL
// Course header info plus every section taught this term (instructors repeat),
// each with the instructor's global rating (headline) and course metrics.
export async function getCourse(req: Request, res: Response): Promise<void> {
  const courseCode = req.params.courseCode;
  const term =
    typeof req.query.term === "string" && req.query.term.trim()
      ? req.query.term.trim()
      : DEFAULT_TERM;

  const [courseResult, coreResult, instructorResult] = await Promise.all([
    supabase
      .from("courses")
      .select("course_code, title, description, departments(name, college)")
      .eq("course_code", courseCode)
      .maybeSingle(),
    supabase
      .from("course_core_requirements")
      .select("core_requirements(name)")
      .eq("course_code", courseCode),
    supabase.rpc("get_course_instructors", {
      p_course_code: courseCode,
      p_term: term,
    }),
  ]);

  if (courseResult.error || instructorResult.error) {
    const message =
      courseResult.error?.message ?? instructorResult.error?.message;
    console.error("Course lookup failed:", message);
    res.status(500).json({ error: "Course lookup failed." });
    return;
  }

  const course = courseResult.data;
  if (!course) {
    res.status(404).json({ error: "Course not found." });
    return;
  }

  const department = one(course.departments) as {
    name: string | null;
    college: string | null;
  } | null;
  const collegeCode = department?.college ?? null;
  const college = collegeCode
    ? COLLEGE_LABELS[collegeCode] ?? collegeCode
    : null;

  const coreRequirements = (coreResult.data ?? [])
    .map((r) => one(r.core_requirements as { name: string | null } | { name: string | null }[] | null)?.name)
    .filter((name): name is string => Boolean(name));

  // One entry per section (instructors repeat across their sections).
  const sections = ((instructorResult.data ?? []) as SectionRatingRow[]).map(
    (row) => ({
      sectionId: row.section_id,
      sectionNumber: row.section_number,
      meetingText: row.meeting_text,
      instructorId: row.instructor_id,
      name: row.instructor_name,
      overallRating: num(row.overall_rating),
      overallEvaluations: row.overall_evaluations,
      courseRating: num(row.course_rating),
      courseEvaluations: row.course_evaluations,
      semestersTaught: row.semesters_taught,
      intellectuallyChallenging: num(row.intellectually_challenging),
      avgHoursWeekly: num(row.avg_hours_weekly),
      attendanceNecessary: num(row.attendance_necessary),
    })
  );

  // Course-level summary: average per unique instructor (so an instructor with
  // many sections doesn't dominate the course averages).
  const byInstructor = new Map<number, (typeof sections)[number]>();
  for (const s of sections) {
    if (!byInstructor.has(s.instructorId)) byInstructor.set(s.instructorId, s);
  }
  const unique = [...byInstructor.values()];
  const avgOf = (pick: (s: (typeof sections)[number]) => number | null) =>
    avg(unique.map(pick).filter((v): v is number => v !== null));

  res.json({
    course: {
      courseCode: course.course_code,
      title: course.title,
      description: course.description,
      department: department?.name ?? null,
      college,
      coreRequirements,
      avgRating: avgOf((s) => s.courseRating),
      difficulty: avgOf((s) => s.intellectuallyChallenging),
      avgWorkload: avgOf((s) => s.avgHoursWeekly),
    },
    term,
    sections,
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

type ExploreRow = {
  course_code: string;
  title: string | null;
  best_instructor_name: string | null;
  best_instructor_rating: string | null;
  avg_rating: string | null;
  review_count: number | null;
  difficulty: string | null;
  avg_workload: string | null;
  core_requirements: string[] | null;
  source: "current" | "historical" | "limited";
};

// "2026FALL" -> "Fall 2026", "2026SUMM" -> "Summer 2026", etc.
const SEASON_LABELS: Record<string, string> = {
  FALL: "Fall",
  SPRING: "Spring",
  SUMM: "Summer",
  SUMMER: "Summer",
  WINTER: "Winter",
};
function termLabel(term: string): string {
  const m = term.match(/^(\d{4})(.+)$/);
  if (!m) return term;
  const [, year, season] = m;
  return `${SEASON_LABELS[season.toUpperCase()] ?? season} ${year}`;
}

// GET /api/courses/explore?term=2026FALL&college=MCAS&department=...&core=Arts
//   &minReviews=10&maxWorkload=3
// Filtered list of courses offered in the term, with per-course aggregates and
// the highest-rated current instructor. Sorting happens client-side.
export async function exploreCourses(
  req: Request,
  res: Response
): Promise<void> {
  const str = (v: unknown) =>
    typeof v === "string" && v.trim() ? v.trim() : null;
  const intOf = (v: unknown) => {
    const s = str(v);
    if (s === null) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  };

  const term = str(req.query.term) ?? DEFAULT_TERM;

  const sortKeys = ["rating", "difficulty", "workload"];
  const sort = sortKeys.includes(str(req.query.sort) ?? "")
    ? (str(req.query.sort) as string)
    : "rating";
  const order = req.query.order === "asc" ? "asc" : "desc";
  const limit = Math.min(50, Math.max(1, intOf(req.query.limit) ?? 25));
  const offset = Math.max(0, intOf(req.query.offset) ?? 0);

  const { data, error } = await supabase.rpc("explore_courses", {
    p_term: term,
    p_college: str(req.query.college),
    p_department: str(req.query.department),
    p_core: str(req.query.core),
    p_min_reviews: intOf(req.query.minReviews) ?? 0,
    p_max_workload: intOf(req.query.maxWorkload),
    p_credits: intOf(req.query.credits),
    p_student_level: ["Undergraduate", "Graduate"].includes(
      str(req.query.studentLevel) ?? ""
    )
      ? str(req.query.studentLevel)
      : null,
    p_sort: sort,
    p_order: order,
    p_limit: limit,
    p_offset: offset,
  });

  if (error) {
    console.error("Explore lookup failed:", error.message);
    res.status(500).json({ error: "Explore lookup failed." });
    return;
  }

  const courses = ((data ?? []) as ExploreRow[]).map((row) => ({
    courseCode: row.course_code,
    title: row.title,
    bestInstructorName: row.best_instructor_name,
    bestInstructorRating: num(row.best_instructor_rating),
    avgRating: num(row.avg_rating),
    reviewCount: Number(row.review_count ?? 0),
    difficulty: num(row.difficulty),
    avgWorkload: num(row.avg_workload),
    coreRequirements: row.core_requirements ?? [],
    source: row.source,
  }));

  res.json({
    term,
    termLabel: termLabel(term),
    count: courses.length,
    hasMore: courses.length === limit,
    courses,
  });
}

// GET /api/courses/filters
// Dropdown options for the Explore page.
export async function getFilters(_req: Request, res: Response): Promise<void> {
  const [termResult, deptResult, coreResult] = await Promise.all([
    supabase.rpc("list_section_terms"),
    supabase.from("departments").select("name").not("name", "is", null),
    supabase.from("core_requirements").select("code"),
  ]);

  const error = termResult.error ?? deptResult.error ?? coreResult.error;
  if (error) {
    console.error("Filter lookup failed:", error.message);
    res.status(500).json({ error: "Filter lookup failed." });
    return;
  }

  const terms = ((termResult.data ?? []) as { term: string }[]).map((r) => ({
    value: r.term,
    label: termLabel(r.term),
  }));

  const departments = [
    ...new Set((deptResult.data ?? []).map((r) => r.name as string)),
  ].sort();

  const cores = (coreResult.data ?? []).map((r) => r.code as string).sort();

  const colleges = Object.entries(COLLEGE_LABELS).map(([value, label]) => ({
    value,
    label,
  }));

  res.json({ terms, colleges, departments, cores });
}
