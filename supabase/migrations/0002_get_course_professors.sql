-- Professors teaching a given course in a given term, with their global
-- (instructor_ratings) and course-specific (instructor_course_ratings) stats,
-- sorted by global overall rating descending. Defaults to the fall term.

create or replace function get_course_professors(
  p_course_code text,
  p_term text default '2026FALL'
)
returns table (
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
  group by i.id, i.canonical_name, ir.instructor_overall, ir.evaluation_count,
           icr.instructor_overall, icr.evaluation_count
  order by ir.instructor_overall desc nulls last;
$$;

grant execute on function get_course_professors(text, text) to anon, authenticated;
