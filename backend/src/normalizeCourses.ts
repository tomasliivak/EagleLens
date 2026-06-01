// src/lib/bcCourses/normalizeCourses.ts

import { OfferedSection, RawBCCourseSection } from "./types.ts";
import { parseBCInstructors } from "./lib/instructorName.ts";

export function normalizeCourseSection(
  raw: RawBCCourseSection
): OfferedSection {
  const instructorNames = parseBCInstructors(raw.instructors);
  const credits = Number.parseInt(raw.credits, 10);

  return {
    externalId: raw.course_id,
    term: raw.term,
    courseCode: `${raw.dept_code}${raw.crs_number}`,
    departmentCode: raw.dept_code,
    title: raw.title,
    description: raw.crs_desc,
    sectionNumber: raw.section,
    instructorNames,
    meetingText: raw.room_schedule,
    credits: Number.isNaN(credits) ? 0 : credits,
    coreRequirements: raw.core_list
      ? raw.core_list.split(",").map((value) => value.trim())
      : [],
    prerequisiteText: raw.prereq,
    college: raw.college,
    studentLevel: raw.student_level,
    isSelectable: credits > 0 && instructorNames.length > 0,
  };
}