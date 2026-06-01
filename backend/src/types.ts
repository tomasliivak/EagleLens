export type RawBCCourseResponse = {
  msg: string;
  code: number;
  servertime: number;
  payload: RawBCCourseSection[];
};

export type RawBCCourseSection = {
  college: string;
  comments: string | null;
  core_list: string | null;
  coreq: string | null;
  course_id: string;
  credits: string;
  crs_desc: string;
  crs_number: string;
  dept_code: string;
  dept_name: string;
  freq: string | null;
  instructors: string | null;
  open_close: string;
  prereq: string | null;
  room_schedule: string;
  section: string;
  student_level: string;
  subject: string;
  title: string;
  term: string;
  xlist: string | null;
};

export type OfferedSection = {
  externalId: string;
  term: string;
  courseCode: string;
  departmentCode: string;
  title: string;
  description: string;
  sectionNumber: string;
  instructorNames: string[];
  meetingText: string;
  credits: number;
  coreRequirements: string[];
  prerequisiteText: string | null;
  college: string;
  studentLevel: string;
  isSelectable: boolean;
};