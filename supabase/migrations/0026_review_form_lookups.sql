-- Every professor who has ever taught p_course_code, flagged as currently
-- teaching it (in the latest live term) or not. Drives the "Leave a Review"
-- form's professor dropdown (Current instructors / Past instructors).
create or replace function get_course_review_professors(p_course_code text)
returns table (instructor_id bigint, instructor_name text, is_current boolean)
language sql stable as $$
  with current_instructors as (
    select distinct si.instructor_id
    from sections s
    join section_instructors si on si.section_id = s.id
    where s.course_code = p_course_code and s.term = latest_section_term()
  ),
  historical_instructors as (
    select distinct e.instructor_id
    from evaluations e
    where e.course_code = p_course_code
  )
  select i.id, i.canonical_name, (ci.instructor_id is not null)
  from instructors i
  join (
    select instructor_id from current_instructors
    union
    select instructor_id from historical_instructors
  ) all_ids on all_ids.instructor_id = i.id
  left join current_instructors ci on ci.instructor_id = i.id
  order by (ci.instructor_id is not null) desc, i.canonical_name;
$$;

grant execute on function get_course_review_professors(text) to anon, authenticated;
