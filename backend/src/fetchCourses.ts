// src/lib/bcCourses/fetchCourses.ts

import { RawBCCourseResponse } from "./types.ts";

export const COURSE_DATA_URLS: string[] = [
  'https://bcweb.bc.edu/aem/coursesfall.json', // fall
  'https://bcweb.bc.edu/aem/coursessumm.json', // summer
  'https://bcweb.bc.edu/aem/coursessprg.json', // spring
];

export async function fetchBCCourses(
  url: string = COURSE_DATA_URLS[0]
): Promise<RawBCCourseResponse> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`BC course fetch failed: ${response.status}`);
  }

  return response.json() as Promise<RawBCCourseResponse>;
}