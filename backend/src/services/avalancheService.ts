import * as cheerio from "cheerio";
import type {
  AvalancheApiResponse,
  EvaluationDrilldown,
  EvaluationSummary,
  ParsedAvalancheRow,
} from "../types/evaluations.ts";
import { standardizeInstructorName } from "../lib/instructorName.ts";

const AVALANCHE_ENDPOINT =
  "https://avalanche.bc.edu/BPI/fbview-WebService.asmx/getFbvGrid";

type SummaryRequestBody = {
  strUiCultureIn: string;
  datasourceId: string;
  blockId: string;
  subjectColId: string;
  subjectValue: string;
  detailValue: string;
  gridId: string;
  pageActuelle: number;
  strOrderBy: [string, "asc" | "desc"];
  strFilter: [string, string, string, string];
  sortCallbackFunc: string;
  userid: string;
  pageSize: string;
};

type DrilldownRequestBody = {
  strUiCultureIn: string;
  datasourceId: string;
  blockId: string;
  subjectColId: string;
  subjectValue: string;
  detailValue: string;
  gridId: string;
  pageActuelle: number;
  strOrderBy: [string, string, string, string];
  strFilter: [string, string, string, string];
  sortCallbackFunc: string;
  userid: string;
  pageSize: string;
};

/**
 * Fetches historical BC evaluation summary records for a course or professor.
 *
 * Example queries:
 *   "SOCY1001"
 *   "Goldman"
 */
export async function fetchEvaluationSummaries(
  query: string
): Promise<EvaluationSummary[]> {
  const trimmedQuery = query.trim();

  if (!trimmedQuery) {
    throw new Error("Evaluation query cannot be empty.");
  }

  const body = buildSummaryRequestBody(trimmedQuery);
  const html = await requestAvalancheTable(body);
  const rows = parseAvalancheHtmlTable(html);

  return rows
    .filter((row) => row.course_code && row.instructor && row.semester)
    .map(normalizeSummaryRow);
}

/**
 * Fetches detailed evaluation metrics for one specific historical
 * course/professor record.
 *
 */
export async function fetchEvaluationDrilldown(params: {
  fullCourseCode: string;
  instructorName: string;
  semester: string;
}): Promise<EvaluationDrilldown | null> {
  const { fullCourseCode, instructorName, semester } = params;

  const body = buildDrilldownRequestBody(fullCourseCode, instructorName);
  const html = await requestAvalancheTable(body);
  const rows = parseAvalancheHtmlTable(html);

  const matchingRow = rows.find((row) => row.semester === semester);

  if (!matchingRow) {
    return null;
  }

  return normalizeDrilldownRow({
    fullCourseCode,
    instructorName,
    semester,
    row: matchingRow,
  });
}

/**
 * Like fetchEvaluationDrilldown, but returns the drilldown metrics for EVERY
 * semester of a (course, instructor) pair in a single request. The sync
 * backfill uses this so it makes one drilldown call per pair instead of one
 * call per semester.
 */
export async function fetchEvaluationDrilldownRows(params: {
  fullCourseCode: string;
  instructorName: string;
}): Promise<EvaluationDrilldown[]> {
  const { fullCourseCode, instructorName } = params;

  const body = buildDrilldownRequestBody(fullCourseCode, instructorName);
  const html = await requestAvalancheTable(body);
  const rows = parseAvalancheHtmlTable(html);

  return rows
    .filter((row) => row.semester)
    .map((row) =>
      normalizeDrilldownRow({
        fullCourseCode,
        instructorName,
        semester: row.semester,
        row,
      })
    );
}

function buildSummaryRequestBody(query: string): SummaryRequestBody {
  return {
    strUiCultureIn: "en",
    datasourceId: "560",
    blockId: "30",
    subjectColId: "2",
    subjectValue: "____[-1]____",
    detailValue: "____[-1]____",
    gridId: "fbvGrid",
    pageActuelle: 1,
    strOrderBy: ["col_2", "asc"],
    strFilter: ["", query, "ddlFbvColumnSelectorLvl1", ""],
    sortCallbackFunc: "__getFbvGrid",
    userid: "",
    pageSize: "1000",
  };
}

function buildDrilldownRequestBody(
  fullCourseCode: string,
  instructorName: string
): DrilldownRequestBody {
  return {
    strUiCultureIn: "en",
    datasourceId: "890",
    blockId: "30",
    subjectColId: "2",
    subjectValue: fullCourseCode,
    detailValue: instructorName,
    gridId: "fbvGridDrilldown",
    pageActuelle: 1,
    strOrderBy: ["col_19", "desc", fullCourseCode, instructorName],
    strFilter: ["", "", "ddlFbvColumnSelector", ""],
    sortCallbackFunc: "__getFbvGridDrilldownData",
    userid: "",
    pageSize: "1000",
  };
}

async function requestAvalancheTable(body: object): Promise<string> {
  const response = await fetch(AVALANCHE_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=UTF-8",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(
      `Avalanche request failed with status ${response.status}.`
    );
  }

  const data: unknown = await response.json();

  if (!isAvalancheResponse(data)) {
    throw new Error("Unexpected response structure from Avalanche.");
  }

  const html = data.d[0];

  if (typeof html !== "string") {
    throw new Error("Avalanche response did not include HTML table data.");
  }

  return html;
}

function isAvalancheResponse(data: unknown): data is AvalancheApiResponse {
  if (typeof data !== "object" || data === null) {
    return false;
  }

  const possibleResponse = data as { d?: unknown };

  return Array.isArray(possibleResponse.d);
}

/**
 * Avalanche returns HTML inside JSON.
 * This converts the first table into JavaScript row objects.
 */
function parseAvalancheHtmlTable(html: string): ParsedAvalancheRow[] {
  const $ = cheerio.load(html);
  const table = $("table").first();

  if (table.length === 0) {
    return [];
  }

  const headers = table
    .find("tr")
    .first()
    .find("th, td")
    .map((_, cell) => cleanKey($(cell).text()))
    .get();

  if (headers.length === 0) {
    return [];
  }

  const rows: ParsedAvalancheRow[] = [];

  table
    .find("tr")
    .slice(1)
    .each((_, row) => {
      const cells = $(row).find("td");

      if (cells.length === 0) {
        return;
      }

      const parsedRow: ParsedAvalancheRow = {};

      cells.each((index, cell) => {
        const header = headers[index];

        if (header) {
          parsedRow[header] = $(cell).text().trim();
        }
      });

      if (Object.keys(parsedRow).length > 0) {
        rows.push(parsedRow);
      }
    });

  return rows;
}

/**
 * 
 * remove non-ASCII characters, remove whitespace, lowercase.
 *
 * Example:
 *   "Instructor Overall" -> "instructoroverall"
 *   "Course Well Organized (C)" -> "coursewellorganized(c)"
 */
function cleanKey(key: string): string {
  return key
    .replace(/[^\x00-\x7F]+/g, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

function normalizeSummaryRow(row: ParsedAvalancheRow): EvaluationSummary {
  const fullCourseCode = row.course_code ?? "";
  const courseCode = fullCourseCode.substring(0, 8);
  const sectionNumber =
    fullCourseCode.length >= 10 ? fullCourseCode.substring(8, 10) : null;

  return {
    fullCourseCode,
    courseCode,
    sectionNumber,

    courseName: row.course_name ?? null,
    department: row.department ?? null,
    school: row.school ?? null,

    instructorName: standardizeInstructorName(row.instructor),
    semester: row.semester,

    instructorOverall: parseOptionalNumber(
      row.instructor_overall ?? row.instructoroverall
    ),
    courseOverall: parseOptionalNumber(
      row.course_overall ?? row.courseoverall
    ),

    modality: row.modality ?? null,

    rawRow: row,
  };
}

function normalizeDrilldownRow(params: {
  fullCourseCode: string;
  instructorName: string;
  semester: string;
  row: ParsedAvalancheRow;
}): EvaluationDrilldown {
  const { fullCourseCode, instructorName, semester, row } = params;

  return {
    fullCourseCode,
    instructorName,
    semester,

    courseWellOrganized: parseOptionalNumber(row["coursewellorganized(c)"]),
    courseIntellectuallyChallenging: parseOptionalNumber(
      row["courseintellectuallychallenging(c)"]
    ),
    effortAverageHoursWeekly: parseOptionalNumber(
      row["effortavghoursweeklyc"]
    ),
    attendanceNecessary: parseOptionalNumber(row["attendancenecessary(c)"]),
    assignmentsHelpful: parseOptionalNumber(row["assignmentshelpful(c)"]),

    instructorPrepared: parseOptionalNumber(row["instructorprepared(i)"]),
    instructorClearExplanations: parseOptionalNumber(
      row["instructorclearexplanations(i)"]
    ),
    availableForHelpOutsideClass: parseOptionalNumber(
      row["availableforhelpoutsideofclass(i)"]
    ),
    stimulatedInterestInSubjectMatter: parseOptionalNumber(
      row["stimulatedinterestinthesubjectmatter(i)"]
    ),

    rawRow: row,
  };
}

function parseOptionalNumber(value: string | undefined): number | null {
  if (!value) {
    return null;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : null;
}