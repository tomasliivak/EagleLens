// Run locally with:  npm run sync:rmp   (from the backend/ directory)
//
// Imports RateMyProfessors reviews for every professor already in our
// `instructors` table (matched at "Boston College" on RMP) into the
// `reviews` table as source = 'rmp', user_id = null rows. Purely
// display/supporting data — never creates instructors or courses, only
// attaches reviews to professor/course pairs we already track.
//
// Full refresh: existing source = 'rmp' rows are deleted and reinserted on
// every run, so re-running never duplicates.
//
// RMP's rate limits are undocumented, so every request (school search,
// professor search, review pages) is funneled through one rate limiter with
// a fixed minimum delay between requests (RMP_DELAY_MS, default 1000ms).
// Set RMP_LIMIT=N to cap the number of instructors processed, for testing.

import { GraphQLClient, gql } from "graphql-request";
import { chunk, selectAll, sleep, supabase, withRetry } from "./syncShared.ts";

const RMP_ENDPOINT = "https://www.ratemyprofessors.com/graphql";
const AUTH_TOKEN = "dGVzdDp0ZXN0"; // Base64 for "test:test"

const RMP_DELAY_MS = Number(process.env.RMP_DELAY_MS) || 1000;

const parsedLimit = Number.parseInt(process.env.RMP_LIMIT ?? "", 10);
const RMP_LIMIT =
  Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : null;

const client = new GraphQLClient(RMP_ENDPOINT, {
  headers: {
    Authorization: `Basic ${AUTH_TOKEN}`,
    "User-Agent": "Mozilla/5.0",
  },
});

// Single choke point for every RMP request, so professor search, review
// pagination, etc. are all naturally spaced out regardless of call site.
let lastRequestAt = 0;
async function rmpRequest<T>(query: string, variables: object): Promise<T> {
  const wait = RMP_DELAY_MS - (Date.now() - lastRequestAt);
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
  return client.request<T>(query, variables);
}

export interface School {
  id: string;
  legacyId: number;
  name: string;
  city: string;
  state: string;
}

export interface ProfessorSummary {
  id: string;
  legacyId: number;
  firstName: string;
  lastName: string;
  department: string | null;
  avgRating: number;
  avgDifficulty: number;
  numRatings: number;
  wouldTakeAgainPercent: number;
  school: School;
}

export interface ProfessorReview {
  id: string;
  legacyId: number;
  comment: string;
  class: string;
  date: string;
  helpfulRating: number;
  clarityRating: number;
  difficultyRating: number;
  attendanceMandatory: string;
  wouldTakeAgain: number | null;
  grade: string | null;
  textbookUse: number | null;
  isForCredit: boolean;
  isForOnlineClass: boolean;
  ratingTags: string;
  thumbsUpTotal: number;
  thumbsDownTotal: number;
}

export interface ProfessorWithReviews extends ProfessorSummary {
  reviews: ProfessorReview[];
  profileUrl: string;
}

interface SchoolSearchResponse {
  search: {
    schools: {
      edges: Array<{ node: School }>;
    };
  };
}

interface ProfessorSearchResponse {
  search: {
    teachers: {
      edges: Array<{ node: ProfessorSummary }>;
    } | null;
  };
}

interface RatingsPageResponse {
  node:
    | (ProfessorSummary & {
        ratings: {
          edges: Array<{
            cursor: string;
            node: ProfessorReview;
          }>;
          pageInfo: {
            hasNextPage: boolean;
            endCursor: string | null;
          };
        };
      })
    | null;
}

const SEARCH_SCHOOLS_QUERY = gql`
  query SchoolSearchResultsPageQuery(
    $query: SchoolSearchQuery!
    $count: Int!
    $cursor: String
  ) {
    search: newSearch {
      schools(query: $query, first: $count, after: $cursor) {
        edges {
          node {
            id
            legacyId
            name
            city
            state
          }
        }
      }
    }
  }
`;

const SEARCH_PROFESSORS_QUERY = gql`
  query TeacherSearchResultsPageQuery(
    $query: TeacherSearchQuery!
    $count: Int!
    $cursor: String
  ) {
    search: newSearch {
      teachers(query: $query, first: $count, after: $cursor) {
        edges {
          node {
            id
            legacyId
            firstName
            lastName
            department
            avgRating
            avgDifficulty
            numRatings
            wouldTakeAgainPercent
            school {
              id
              legacyId
              name
              city
              state
            }
          }
        }
      }
    }
  }
`;

const PROFESSOR_RATINGS_QUERY = gql`
  query TeacherRatingsPageQuery(
    $id: ID!
    $count: Int!
    $cursor: String
  ) {
    node(id: $id) {
      ... on Teacher {
        id
        legacyId
        firstName
        lastName
        department
        avgRating
        avgDifficulty
        numRatings
        wouldTakeAgainPercent
        school {
          id
          legacyId
          name
          city
          state
        }
        ratings(first: $count, after: $cursor) {
          edges {
            cursor
            node {
              id
              legacyId
              comment
              class
              date
              helpfulRating
              clarityRating
              difficultyRating
              attendanceMandatory
              wouldTakeAgain
              grade
              textbookUse
              isForCredit
              isForOnlineClass
              ratingTags
              thumbsUpTotal
              thumbsDownTotal
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    }
  }
`;

function normalize(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim()
    .toLowerCase();
}

function fullName(professor: ProfessorSummary): string {
  return `${professor.firstName} ${professor.lastName}`.trim();
}

function normalizeCourseCode(value: string): string {
  return value.replace(/[^a-z0-9]/gi, "").toUpperCase();
}

const NO_COMMENT_PATTERN = /^(no comments?|n\/?a)$/i;

export async function searchSchools(
  schoolName: string,
  limit = 10
): Promise<School[]> {
  const response = await rmpRequest<SchoolSearchResponse>(SEARCH_SCHOOLS_QUERY, {
    query: { text: schoolName },
    count: limit,
    cursor: "",
  });

  return response.search.schools.edges.map(({ node }) => node);
}

export async function searchProfessors(
  professorName: string,
  schoolId: string,
  limit = 20
): Promise<ProfessorSummary[]> {
  const response = await rmpRequest<ProfessorSearchResponse>(
    SEARCH_PROFESSORS_QUERY,
    {
      query: {
        text: professorName,
        schoolID: schoolId,
      },
      count: limit,
      cursor: "",
    }
  );

  return response.search.teachers?.edges.map(({ node }) => node) ?? [];
}

/**
 * Fetches every review for one professor by following the GraphQL cursor.
 */
export async function fetchAllProfessorReviews(
  professorId: string,
  pageSize = 20
): Promise<ProfessorWithReviews> {
  const reviews: ProfessorReview[] = [];
  let cursor: string | null = null;
  let professor: ProfessorSummary | null = null;

  do {
    const response: RatingsPageResponse = await rmpRequest<RatingsPageResponse>(
      PROFESSOR_RATINGS_QUERY,
      {
        id: professorId,
        count: pageSize,
        cursor,
      }
    );

    if (!response.node) {
      throw new Error(`No professor found for GraphQL ID "${professorId}".`);
    }

    professor ??= {
      id: response.node.id,
      legacyId: response.node.legacyId,
      firstName: response.node.firstName,
      lastName: response.node.lastName,
      department: response.node.department,
      avgRating: response.node.avgRating,
      avgDifficulty: response.node.avgDifficulty,
      numRatings: response.node.numRatings,
      wouldTakeAgainPercent: response.node.wouldTakeAgainPercent,
      school: response.node.school,
    };

    reviews.push(
      ...response.node.ratings.edges.map(({ node }) => ({
        ...node,
        comment: node.comment ?? "",
        ratingTags: node.ratingTags ?? "",
      }))
    );

    const { hasNextPage, endCursor } = response.node.ratings.pageInfo;

    if (!hasNextPage) {
      cursor = null;
      break;
    }

    if (!endCursor) {
      throw new Error(
        "RMP reported another ratings page but did not return an end cursor."
      );
    }

    cursor = endCursor;
  } while (cursor);

  if (!professor) {
    throw new Error("Professor data was not returned.");
  }

  return {
    ...professor,
    reviews,
    profileUrl: `https://www.ratemyprofessors.com/professor/${professor.legacyId}`,
  };
}

async function resolveSchool(schoolName: string): Promise<School> {
  const schools = await searchSchools(schoolName);

  if (schools.length === 0) {
    throw new Error(`No school found matching "${schoolName}".`);
  }

  const normalizedSchoolName = normalize(schoolName);
  return (
    schools.find(
      (candidate) => normalize(candidate.name) === normalizedSchoolName
    ) ?? schools[0]
  );
}

// Resolves one of our instructors to their RMP professor (by exact
// normalized name match, preferring the one with the most ratings) and
// fetches their full review history. Returns null if RMP has no exact match
// — we never guess or create data for a professor we can't confidently
// identify.
async function fetchReviewsForInstructor(
  instructorName: string,
  schoolId: string
): Promise<ProfessorWithReviews | null> {
  const professors = await searchProfessors(instructorName, schoolId);
  const normalizedName = normalize(instructorName);

  const exactMatches = professors
    .filter((professor) => normalize(fullName(professor)) === normalizedName)
    .sort((a, b) => b.numRatings - a.numRatings);

  if (exactMatches.length === 0) return null;

  return fetchAllProfessorReviews(exactMatches[0].id);
}

interface ReviewRow {
  user_id: null;
  course_code: string;
  instructor_id: number;
  would_recommend: boolean;
  comment: string;
  source: "rmp";
}

type SkipReason = "no-answer" | "no-comment" | "no-course";

// Every filter that decides whether an RMP review can become a reviews row:
// an unanswered "would take again", an empty/placeholder/too-long comment,
// or a class that doesn't match a course we track.
function buildReviewRow(
  review: ProfessorReview,
  instructorId: number,
  courseCodes: Set<string>
): { row: ReviewRow } | { skip: SkipReason } {
  if (review.wouldTakeAgain !== 0 && review.wouldTakeAgain !== 1) {
    return { skip: "no-answer" };
  }

  const comment = (review.comment ?? "").trim();
  if (!comment || comment.length > 2000 || NO_COMMENT_PATTERN.test(comment)) {
    return { skip: "no-comment" };
  }

  const courseCode = normalizeCourseCode(review.class ?? "");
  if (!courseCodes.has(courseCode)) {
    return { skip: "no-course" };
  }

  return {
    row: {
      user_id: null,
      course_code: courseCode,
      instructor_id: instructorId,
      would_recommend: review.wouldTakeAgain === 1,
      comment,
      source: "rmp",
    },
  };
}

async function main(): Promise<void> {
  const started = Date.now();

  console.log('Resolving "Boston College" on RateMyProfessors...');
  const school = await withRetry(() => resolveSchool("Boston College"));

  const instructorRows = await selectAll<{ id: number; canonical_name: string }>(
    "instructors",
    "id,canonical_name"
  );
  const courseRows = await selectAll<{ course_code: string }>(
    "courses",
    "course_code"
  );
  const courseCodes = new Set(
    courseRows.map((row) => normalizeCourseCode(row.course_code))
  );

  const targets = RMP_LIMIT ? instructorRows.slice(0, RMP_LIMIT) : instructorRows;
  if (RMP_LIMIT) {
    console.log(
      `RMP_LIMIT=${RMP_LIMIT}: processing ${targets.length} of ${instructorRows.length} instructors.`
    );
  } else {
    console.log(`Processing all ${targets.length} instructors.`);
  }

  let matched = 0;
  let unmatched = 0;
  let totalReviews = 0;
  let skippedNoAnswer = 0;
  let skippedNoComment = 0;
  let skippedNoCourse = 0;
  const rows: ReviewRow[] = [];

  for (const [index, instructor] of targets.entries()) {
    try {
      const professorWithReviews = await withRetry(() =>
        fetchReviewsForInstructor(instructor.canonical_name, school.id)
      );

      if (!professorWithReviews) {
        unmatched++;
      } else {
        matched++;
        totalReviews += professorWithReviews.reviews.length;

        for (const review of professorWithReviews.reviews) {
          const result = buildReviewRow(review, instructor.id, courseCodes);
          if ("skip" in result) {
            if (result.skip === "no-answer") skippedNoAnswer++;
            else if (result.skip === "no-comment") skippedNoComment++;
            else skippedNoCourse++;
            continue;
          }
          rows.push(result.row);
        }
      }
    } catch (error) {
      unmatched++;
      console.warn(
        `  RMP fetch failed for "${instructor.canonical_name}":`,
        (error as Error).message
      );
    }

    if ((index + 1) % 25 === 0) {
      console.log(`  ${index + 1}/${targets.length} instructors processed...`);
    }
  }

  console.log(
    `Matched ${matched}/${targets.length} instructors on RMP (${unmatched} not found or failed).`
  );
  console.log(
    `${rows.length}/${totalReviews} RMP reviews will be imported ` +
      `(skipped: ${skippedNoAnswer} unanswered "would take again", ` +
      `${skippedNoComment} empty/invalid comments, ${skippedNoCourse} unmatched course).`
  );

  console.log("Clearing existing RMP-imported reviews...");
  const { error: deleteError } = await supabase
    .from("reviews")
    .delete()
    .eq("source", "rmp");
  if (deleteError) {
    throw new Error(`Failed to clear old RMP reviews: ${deleteError.message}`);
  }

  console.log(`Inserting ${rows.length} RMP reviews...`);
  for (const part of chunk(rows, 500)) {
    const { error } = await supabase.from("reviews").insert(part);
    if (error) {
      throw new Error(`Insert into reviews failed: ${error.message}`);
    }
  }

  console.log(
    `RMP review import complete in ${Math.round((Date.now() - started) / 1000)}s.`
  );
}

main().catch((error) => {
  console.error("RMP review import failed:", error);
  process.exit(1);
});
