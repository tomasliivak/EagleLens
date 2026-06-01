export type ParsedAvalancheRow = Record<string, string>;

export type EvaluationSummary = {
  fullCourseCode: string;      // Example: "SOCY100101"
  courseCode: string;          // Example: "SOCY1001"
  sectionNumber: string | null; // Example: "01"

  courseName: string | null;
  department: string | null;
  school: string | null;

  instructorName: string;
  semester: string;

  instructorOverall: number | null;
  courseOverall: number | null;

  modality: string | null;

  /**
   * Useful while developing because Avalanche may contain
   * fields you decide to support later.
   */
  rawRow: ParsedAvalancheRow;
};

export type EvaluationDrilldown = {
  fullCourseCode: string;
  instructorName: string;
  semester: string;

  courseWellOrganized: number | null;
  courseIntellectuallyChallenging: number | null;
  effortAverageHoursWeekly: number | null;
  attendanceNecessary: number | null;
  assignmentsHelpful: number | null;

  instructorPrepared: number | null;
  instructorClearExplanations: number | null;
  availableForHelpOutsideClass: number | null;
  stimulatedInterestInSubjectMatter: number | null;

  rawRow: ParsedAvalancheRow;
};

export type AvalancheApiResponse = {
  d: unknown[];
};