// Run locally with:  npm run sync:classes   (from the backend/ directory)
//
// Refreshes the BC course catalog only:
//   BC course feeds (fall + summer + spring) -> departments, core_requirements,
//   courses, course_core_requirements, instructors, sections, section_instructors
//
// This is the cheap, frequently-changing half of the sync. The Avalanche
// evaluations are refreshed separately by npm run sync:evals.
//
// Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in backend/.env.

import { COURSE_DATA_URLS, fetchBCCourses } from "../src/fetchCourses.ts";
import { normalizeCourseSection } from "../src/normalizeCourses.ts";
import type { OfferedSection, RawBCCourseSection } from "../src/types.ts";
import {
  selectAll,
  upsertChunked,
  upsertInstructorsAndMap,
} from "./syncShared.ts";

async function loadBcCatalog(): Promise<void> {
  console.log(`Fetching ${COURSE_DATA_URLS.length} BC course feeds…`);
  const responses = await Promise.all(
    COURSE_DATA_URLS.map((url) => fetchBCCourses(url))
  );
  const rawSections: RawBCCourseSection[] = responses.flatMap((r) => r.payload);
  const sections: OfferedSection[] = rawSections.map(normalizeCourseSection);
  console.log(`  ${rawSections.length} sections across all terms.`);

  // Departments (need dept_name/college, which only the raw rows carry).
  const departments = new Map<string, Record<string, unknown>>();
  for (const r of rawSections) {
    if (!departments.has(r.dept_code)) {
      departments.set(r.dept_code, {
        code: r.dept_code,
        name: r.dept_name ?? null,
        college: r.college ?? null,
      });
    }
  }
  await upsertChunked("departments", [...departments.values()], "code");

  // Core requirements.
  const coreCodes = new Set<string>();
  for (const s of sections) for (const c of s.coreRequirements) coreCodes.add(c);
  await upsertChunked(
    "core_requirements",
    [...coreCodes].map((code) => ({ code })),
    "code",
    true
  );

  // Courses (BC is authoritative for title/description/credits).
  const courses = new Map<string, Record<string, unknown>>();
  for (const s of sections) {
    if (!courses.has(s.courseCode)) {
      courses.set(s.courseCode, {
        course_code: s.courseCode,
        department_code: s.departmentCode || null,
        title: s.title,
        description: s.description,
        credits: s.credits,
      });
    }
  }
  await upsertChunked("courses", [...courses.values()], "course_code");
  const courseCodeSet = new Set(courses.keys());

  // Course <-> core requirement.
  const ccrSeen = new Set<string>();
  const ccr: Record<string, unknown>[] = [];
  for (const s of sections) {
    for (const core of s.coreRequirements) {
      const key = `${s.courseCode}::${core}`;
      if (!ccrSeen.has(key)) {
        ccrSeen.add(key);
        ccr.push({ course_code: s.courseCode, core_code: core });
      }
    }
  }
  await upsertChunked(
    "course_core_requirements",
    ccr,
    "course_code,core_code",
    true
  );

  // Instructors from BC.
  const bcNames = new Set<string>();
  for (const s of sections) for (const n of s.instructorNames) bcNames.add(n);
  const instructorIdByName = await upsertInstructorsAndMap(bcNames);

  // Sections (dedup on the natural key before upserting).
  const sectionSeen = new Set<string>();
  const sectionRows: Record<string, unknown>[] = [];
  for (const s of sections) {
    const key = `${s.externalId}::${s.term}`;
    if (sectionSeen.has(key)) continue;
    sectionSeen.add(key);
    sectionRows.push({
      external_id: s.externalId,
      term: s.term,
      course_code: s.courseCode,
      section_number: s.sectionNumber,
      meeting_text: s.meetingText,
      credits: s.credits,
      college: s.college,
      student_level: s.studentLevel,
      prerequisite_text: s.prerequisiteText,
      is_selectable: s.isSelectable,
    });
  }
  await upsertChunked("sections", sectionRows, "external_id,term");

  const sectionIdByKey = new Map<string, number>();
  for (const row of await selectAll<{
    id: number;
    external_id: string;
    term: string;
  }>("sections", "id,external_id,term")) {
    sectionIdByKey.set(`${row.external_id}::${row.term}`, row.id);
  }

  // Section <-> instructor.
  const siSeen = new Set<string>();
  const sectionInstructors: Record<string, unknown>[] = [];
  for (const s of sections) {
    const sectionId = sectionIdByKey.get(`${s.externalId}::${s.term}`);
    if (!sectionId) continue;
    for (const name of s.instructorNames) {
      const instructorId = instructorIdByName.get(name);
      if (!instructorId) continue;
      const key = `${sectionId}::${instructorId}`;
      if (siSeen.has(key)) continue;
      siSeen.add(key);
      sectionInstructors.push({
        section_id: sectionId,
        instructor_id: instructorId,
      });
    }
  }
  await upsertChunked(
    "section_instructors",
    sectionInstructors,
    "section_id,instructor_id",
    true
  );

  console.log(
    `  Catalog loaded: ${courseCodeSet.size} courses, ${instructorIdByName.size} instructors, ${sectionRows.length} sections.`
  );
}

async function main() {
  const started = Date.now();
  await loadBcCatalog();
  console.log(
    `Classes sync complete in ${Math.round((Date.now() - started) / 1000)}s.`
  );
}

main().catch((error) => {
  console.error("Classes sync failed:", error);
  process.exit(1);
});
