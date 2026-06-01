-- Return one row per section of a course in a term (repeat professors included),
-- with the meeting text and each professor's global + course-specific ratings,
-- sorted by global overall rating descending.

drop function if exists get_course_professors(text, text);

create function get_course_professors(
  p_course_code text,
  p_term text default '2026FALL'
)
returns table (
  section_id          bigint,
  section_number      text,
  meeting_text        text,
  instructor_id       bigint,
  instructor_name     text,
  overall_rating      numeric,
  overall_evaluations bigint,
  course_rating       numeric,
  course_evaluations  bigint
)
language sql
stable
as $$
  select
    s.id,
    s.section_number,
    s.meeting_text,
    i.id,
    i.canonical_name,
    ir.instructor_overall,
    ir.evaluation_count,
    icr.instructor_overall,
    icr.evaluation_count
  from sections s
  join section_instructors si on si.section_id = s.id
  join instructors i on i.id = si.instructor_id
  left join instructor_ratings ir on ir.instructor_id = i.id
  left join instructor_course_ratings icr
    on icr.instructor_id = i.id and icr.course_code = s.course_code
  where s.course_code = p_course_code and s.term = p_term
  order by ir.instructor_overall desc nulls last, s.section_number;
$$;

grant execute on function get_course_professors(text, text) to anon, authenticated;
