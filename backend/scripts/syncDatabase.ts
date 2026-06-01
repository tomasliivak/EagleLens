// Run locally with:  npm run sync   (from the backend/ directory)
//
// Pulls from both sources and loads Supabase:
//   1. BC course feeds (fall + summer + spring)  -> departments, core_requirements,
//                                                    courses, sections, section_instructors
//   2. Avalanche evaluations, enumerated ONE QUERY PER OFFERED COURSE CODE
//      (Avalanche is a search endpoint, so we drive it from the courses our users
//       can actually take), with a full drilldown backfill of the side metrics.
//
// Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in backend/.env. The
// service-role key bypasses RLS, so this must only ever run from your machine.

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

import { COURSE_DATA_URLS, fetchBCCourses } from "../src/fetchCourses.ts";
import { normalizeCourseSection } from "../src/normalizeCourses.ts";
import {
  fetchEvaluationDrilldownRows,
  fetchEvaluationSummaries,
} from "../src/services/avalancheService.ts";
import type { OfferedSection, RawBCCourseSection } from "../src/types.ts";
import type {
  EvaluationDrilldown,
  EvaluationSummary,
  ParsedAvalancheRow,
} from "../src/types/evaluations.ts";

// How many Avalanche requests to keep in flight. Avalanche is a live BC server,
// so keep this modest.
const AVALANCHE_CONCURRENCY = 5;
const UPSERT_CHUNK = 500;

// Optional smoke-test cap: SYNC_LIMIT=20 npm run sync queries Avalanche for only
// the first N course codes. The BC catalog still loads in full; only the
// expensive Avalanche passes are capped.
const parsedLimit = Number.parseInt(process.env.SYNC_LIMIT ?? "", 10);
const SYNC_LIMIT =
  Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : null;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error(
    "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Add them to backend/.env."
  );
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// ---------------------------------------------------------------------------
// Small generic helpers
// ---------------------------------------------------------------------------

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      await sleep(500 * (attempt + 1));
    }
  }
  throw lastError;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index], index);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker)
  );
  return results;
}

// ---------------------------------------------------------------------------
// Supabase helpers
// ---------------------------------------------------------------------------

async function upsertChunked(
  table: string,
  rows: Record<string, unknown>[],
  onConflict: string,
  ignoreDuplicates = false
): Promise<void> {
  for (const part of chunk(rows, UPSERT_CHUNK)) {
    const { error } = await supabase
      .from(table)
      .upsert(part, { onConflict, ignoreDuplicates });
    if (error) {
      throw new Error(`Upsert into ${table} failed: ${error.message}`);
    }
  }
}

// Supabase caps a single select at 1000 rows, so page through with .range().
async function selectAll<T>(table: string, columns: string): Promise<T[]> {
  const pageSize = 1000;
  const out: T[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`Select from ${table} failed: ${error.message}`);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

// Upsert every name, then read the full table back to map name -> id.
async function upsertInstructorsAndMap(
  names: Iterable<string>
): Promise<Map<string, number>> {
  const rows = [...new Set(names)].map((canonical_name) => ({ canonical_name }));
  await upsertChunked("instructors", rows, "canonical_name", true);

  const map = new Map<string, number>();
  const all = await selectAll<{ id: number; canonical_name: string }>(
    "instructors",
    "id,canonical_name"
  );
  for (const row of all) map.set(row.canonical_name, row.id);
  return map;
}

// Best-effort weighting. Avalanche column names vary, so scan for a plausible
// response/enrollment count; leave null if none is found (raw_row keeps the
// original data so this can be revisited later).
function extractResponseCount(raw: ParsedAvalancheRow | undefined): number | null {
  if (!raw) return null;
  for (const [key, value] of Object.entries(raw)) {
    if (/response|respondent|filledout|enrolled|nbrofresp|numresp/.test(key)) {
      const n = Number(value);
      if (Number.isFinite(n)) return Math.round(n);
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Phase 1 — BC catalog
// ---------------------------------------------------------------------------

async function loadBcCatalog(): Promise<{
  courseCodes: string[];
  instructorIdByName: Map<string, number>;
}> {
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

  return { courseCodes: [...courseCodeSet], instructorIdByName };
}

// ---------------------------------------------------------------------------
// Phase 2 — Avalanche summaries (one query per offered course code)
// ---------------------------------------------------------------------------

async function fetchSummaries(
  courseCodes: string[],
  courseCodeSet: Set<string>
): Promise<Map<string, EvaluationSummary>> {
  console.log(`Fetching Avalanche summaries for ${courseCodes.length} courses…`);
  let done = 0;

  const perCourse = await mapWithConcurrency(
    courseCodes,
    AVALANCHE_CONCURRENCY,
    async (code) => {
      done++;
      if (done % 250 === 0) {
        console.log(`  summaries ${done}/${courseCodes.length}`);
      }
      try {
        return await withRetry(() => fetchEvaluationSummaries(code));
      } catch (error) {
        console.warn(`  summary failed for ${code}:`, (error as Error).message);
        return [] as EvaluationSummary[];
      }
    }
  );

  // Dedup on the evaluations natural key; keep only courses in our catalog so
  // the evaluations.course_code foreign key always resolves.
  const byKey = new Map<string, EvaluationSummary>();
  for (const summary of perCourse.flat()) {
    if (!courseCodeSet.has(summary.courseCode)) continue;
    const key = `${summary.fullCourseCode}::${summary.instructorName}::${summary.semester}`;
    if (!byKey.has(key)) byKey.set(key, summary);
  }
  console.log(`  ${byKey.size} unique evaluation records.`);
  return byKey;
}

// ---------------------------------------------------------------------------
// Phase 3 — Drilldown backfill (one request per course+instructor pair)
// ---------------------------------------------------------------------------

async function fetchDrilldowns(
  summaries: Iterable<EvaluationSummary>
): Promise<Map<string, EvaluationDrilldown>> {
  const pairs = new Map<string, { fullCourseCode: string; instructorName: string }>();
  for (const s of summaries) {
    const key = `${s.fullCourseCode}::${s.instructorName}`;
    if (!pairs.has(key)) {
      pairs.set(key, {
        fullCourseCode: s.fullCourseCode,
        instructorName: s.instructorName,
      });
    }
  }

  const pairList = [...pairs.values()];
  console.log(`Backfilling drilldown for ${pairList.length} course/instructor pairs…`);

  const byKey = new Map<string, EvaluationDrilldown>();
  let done = 0;
  await mapWithConcurrency(pairList, AVALANCHE_CONCURRENCY, async (pair) => {
    done++;
    if (done % 250 === 0) {
      console.log(`  drilldown ${done}/${pairList.length}`);
    }
    try {
      const rows = await withRetry(() => fetchEvaluationDrilldownRows(pair));
      for (const d of rows) {
        byKey.set(`${d.fullCourseCode}::${d.instructorName}::${d.semester}`, d);
      }
    } catch (error) {
      console.warn(
        `  drilldown failed for ${pair.fullCourseCode} / ${pair.instructorName}:`,
        (error as Error).message
      );
    }
  });

  return byKey;
}

// ---------------------------------------------------------------------------
// Phase 4 — write evaluations
// ---------------------------------------------------------------------------

async function loadEvaluations(
  summaries: Map<string, EvaluationSummary>,
  drilldowns: Map<string, EvaluationDrilldown>,
  instructorIdByName: Map<string, number>
): Promise<void> {
  const rows: Record<string, unknown>[] = [];

  for (const s of summaries.values()) {
    const instructorId = instructorIdByName.get(s.instructorName);
    if (!instructorId) continue;

    const d = drilldowns.get(
      `${s.fullCourseCode}::${s.instructorName}::${s.semester}`
    );

    rows.push({
      full_course_code: s.fullCourseCode,
      course_code: s.courseCode,
      section_number: s.sectionNumber,
      instructor_id: instructorId,
      semester: s.semester,
      course_name: s.courseName,
      modality: s.modality,
      response_count: extractResponseCount(d?.rawRow ?? s.rawRow),
      instructor_overall: s.instructorOverall,
      course_overall: s.courseOverall,
      course_well_organized: d?.courseWellOrganized ?? null,
      course_intellectually_challenging: d?.courseIntellectuallyChallenging ?? null,
      effort_avg_hours_weekly: d?.effortAverageHoursWeekly ?? null,
      attendance_necessary: d?.attendanceNecessary ?? null,
      assignments_helpful: d?.assignmentsHelpful ?? null,
      instructor_prepared: d?.instructorPrepared ?? null,
      instructor_clear_explanations: d?.instructorClearExplanations ?? null,
      available_for_help_outside_class: d?.availableForHelpOutsideClass ?? null,
      stimulated_interest: d?.stimulatedInterestInSubjectMatter ?? null,
      raw_row: { summary: s.rawRow, drilldown: d?.rawRow ?? null },
    });
  }

  await upsertChunked(
    "evaluations",
    rows,
    "full_course_code,instructor_id,semester"
  );
  console.log(`  ${rows.length} evaluations written.`);
}

// ---------------------------------------------------------------------------

async function main() {
  const started = Date.now();

  const { courseCodes, instructorIdByName: bcInstructors } = await loadBcCatalog();
  const courseCodeSet = new Set(courseCodes);

  const queryCodes = SYNC_LIMIT ? courseCodes.slice(0, SYNC_LIMIT) : courseCodes;
  if (SYNC_LIMIT) {
    console.log(
      `SYNC_LIMIT=${SYNC_LIMIT}: querying Avalanche for ${queryCodes.length} of ${courseCodes.length} courses.`
    );
  }

  const summaries = await fetchSummaries(queryCodes, courseCodeSet);

  // Avalanche may name instructors we never saw in the BC feed; make sure they
  // exist before we reference them, then refresh the name -> id map.
  const allNames = new Set<string>([
    ...bcInstructors.keys(),
    ...[...summaries.values()].map((s) => s.instructorName),
  ]);
  const instructorIdByName = await upsertInstructorsAndMap(allNames);

  const drilldowns = await fetchDrilldowns(summaries.values());
  await loadEvaluations(summaries, drilldowns, instructorIdByName);

  console.log(`Sync complete in ${Math.round((Date.now() - started) / 1000)}s.`);
}

main().catch((error) => {
  console.error("Sync failed:", error);
  process.exit(1);
});
