-- One row per instructor teaching a course in a term, with their global rating
-- (across all courses) as the headline plus course-specific metrics
-- (rating, intellectually challenging, avg weekly hours, attendance necessary)
-- and how many times they've taught this course (course_evaluations).
-- Sorted by global overall rating descending.

create or replace function get_course_instructors(
  p_course_code text,
  p_term text default '2026FALL'
)
returns table (
  instructor_id              bigint,
  instructor_name            text,
  overall_rating             numeric,
  overall_evaluations        bigint,
  course_rating              numeric,
  course_evaluations         bigint,
  semesters_taught           bigint,
  intellectually_challenging numeric,
  avg_hours_weekly           numeric,
  attendance_necessary       numeric,
  sections                   text[],
  meetings                   text[]
)
language sql
stable
as $$
  select
    i.id,
    i.canonical_name,
    ir.instructor_overall,
    ir.evaluation_count,
    icr.instructor_overall,
    icr.evaluation_count,
    (select count(distinct e.semester)
       from evaluations e
      where e.instructor_id = i.id and e.course_code = p_course_code),
    icr.course_intellectually_challenging,
    icr.effort_avg_hours_weekly,
    icr.attendance_necessary,
    array_remove(array_agg(distinct s.section_number), null),
    array_remove(array_agg(distinct s.meeting_text), null)
  from sections s
  join section_instructors si on si.section_id = s.id
  join instructors i on i.id = si.instructor_id
  left join instructor_ratings ir on ir.instructor_id = i.id
  left join instructor_course_ratings icr
    on icr.instructor_id = i.id and icr.course_code = s.course_code
  where s.course_code = p_course_code and s.term = p_term
  group by i.id, i.canonical_name, ir.instructor_overall, ir.evaluation_count,
           icr.instructor_overall, icr.evaluation_count,
           icr.course_intellectually_challenging, icr.effort_avg_hours_weekly,
           icr.attendance_necessary
  order by ir.instructor_overall desc nulls last;
$$;

grant execute on function get_course_instructors(text, text) to anon, authenticated;
