// Run locally with:  npm run sync:evals   (from the backend/ directory)
//
// Refreshes the Avalanche evaluations only, enumerated ONE QUERY PER OFFERED
// COURSE CODE (Avalanche is a search endpoint, so we drive it from the courses
// already in our catalog), with a full drilldown backfill of the side metrics.
//
// This is the slow half of the sync — it hits a live BC server hundreds of
// times. The course catalog must already be loaded (run npm run sync:classes
// first); the course codes are read from the DB rather than re-fetched.
//
// Set SYNC_LIMIT=N to cap the Avalanche queries to the first N course codes.
// Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in backend/.env.

import {
  fetchEvaluationDrilldownRows,
  fetchEvaluationSummaries,
} from "../src/services/avalancheService.ts";
import type {
  EvaluationDrilldown,
  EvaluationSummary,
} from "../src/types/evaluations.ts";
import {
  AVALANCHE_CONCURRENCY,
  SYNC_LIMIT,
  mapWithConcurrency,
  refreshCaches,
  selectAll,
  upsertChunked,
  upsertInstructorsAndMap,
  withRetry,
} from "./syncShared.ts";

// ---------------------------------------------------------------------------
// Phase 1 — Avalanche summaries (one query per offered course code)
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
// Phase 2 — Drilldown backfill (one request per course+instructor pair)
// ---------------------------------------------------------------------------

// The summary and drilldown come from different Avalanche endpoints, so their
// semester strings can drift (extra/internal whitespace, casing). Normalize the
// semester before using it in the match key so minor format differences don't
// silently leave the drilldown metrics null.
function normalizeSemester(semester: string): string {
  return semester.trim().replace(/\s+/g, " ").toLowerCase();
}

function drilldownKey(
  fullCourseCode: string,
  instructorName: string,
  semester: string
): string {
  return `${fullCourseCode}::${instructorName}::${normalizeSemester(semester)}`;
}

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
  let emptyPairs = 0;
  let failedPairs = 0;
  await mapWithConcurrency(pairList, AVALANCHE_CONCURRENCY, async (pair) => {
    done++;
    if (done % 250 === 0) {
      console.log(`  drilldown ${done}/${pairList.length}`);
    }
    try {
      const rows = await withRetry(() => fetchEvaluationDrilldownRows(pair));
      if (rows.length === 0) emptyPairs++;
      for (const d of rows) {
        byKey.set(drilldownKey(d.fullCourseCode, d.instructorName, d.semester), d);
      }
    } catch (error) {
      failedPairs++;
      console.warn(
        `  drilldown failed for ${pair.fullCourseCode} / ${pair.instructorName}:`,
        (error as Error).message
      );
    }
  });

  console.log(
    `  drilldown done: ${byKey.size} rows; ${emptyPairs} pairs returned no rows; ${failedPairs} pairs errored.`
  );
  return byKey;
}

// ---------------------------------------------------------------------------
// Phase 3 — write evaluations
// ---------------------------------------------------------------------------

async function loadEvaluations(
  summaries: Map<string, EvaluationSummary>,
  drilldowns: Map<string, EvaluationDrilldown>,
  instructorIdByName: Map<string, number>
): Promise<void> {
  const rows: Record<string, unknown>[] = [];
  let unmatched = 0;

  for (const s of summaries.values()) {
    const instructorId = instructorIdByName.get(s.instructorName);
    if (!instructorId) continue;

    const d = drilldowns.get(
      drilldownKey(s.fullCourseCode, s.instructorName, s.semester)
    );
    if (!d) unmatched++;

    rows.push({
      full_course_code: s.fullCourseCode,
      course_code: s.courseCode,
      section_number: s.sectionNumber,
      instructor_id: instructorId,
      semester: s.semester,
      course_name: s.courseName,
      modality: s.modality,
      response_count: s.responseCount,
      enrolled_count: s.enrolledCount,
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

  console.log(
    `  ${unmatched}/${rows.length} evaluation rows had no matching drilldown (metrics left null).`
  );
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

  // Drive Avalanche from the catalog already loaded by npm run sync:classes.
  const courseRows = await selectAll<{ course_code: string }>(
    "courses",
    "course_code"
  );
  const courseCodes = courseRows.map((r) => r.course_code);
  if (courseCodes.length === 0) {
    console.error(
      "No courses found in the database. Run `npm run sync:classes` first."
    );
    process.exit(1);
  }
  const courseCodeSet = new Set(courseCodes);

  const queryCodes = SYNC_LIMIT ? courseCodes.slice(0, SYNC_LIMIT) : courseCodes;
  if (SYNC_LIMIT) {
    console.log(
      `SYNC_LIMIT=${SYNC_LIMIT}: querying Avalanche for ${queryCodes.length} of ${courseCodes.length} courses.`
    );
  }

  const summaries = await fetchSummaries(queryCodes, courseCodeSet);

  // Avalanche may name instructors we never saw in the BC feed; make sure they
  // exist before we reference them. Reading the table back also covers every
  // instructor already loaded by the classes sync.
  const avalancheNames = new Set<string>(
    [...summaries.values()].map((s) => s.instructorName)
  );
  const instructorIdByName = await upsertInstructorsAndMap(avalancheNames);

  const drilldowns = await fetchDrilldowns(summaries.values());
  await loadEvaluations(summaries, drilldowns, instructorIdByName);
  await refreshCaches();

  console.log(
    `Evals sync complete in ${Math.round((Date.now() - started) / 1000)}s.`
  );
}

main().catch((error) => {
  console.error("Evals sync failed:", error);
  process.exit(1);
});
