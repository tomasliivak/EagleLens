-- Every course a professor has ever taught, for the professor-locked
-- "Leave a Review" form's course dropdown. Flat list (no current/past
-- grouping needed here -- the professor identity is already fixed).
create or replace function get_professor_review_courses(p_id bigint)
returns table (course_code text, title text)
language sql stable as $$
  with current_courses as (
    select distinct s.course_code
    from sections s
    join section_instructors si on si.section_id = s.id
    where si.instructor_id = p_id and s.term = latest_section_term()
  ),
  historical_courses as (
    select distinct e.course_code
    from evaluations e
    where e.instructor_id = p_id
  ),
  all_codes as (
    select course_code from current_courses
    union
    select course_code from historical_courses
  )
  select ac.course_code, c.title
  from all_codes ac
  left join courses c on c.course_code = ac.course_code
  order by ac.course_code;
$$;

grant execute on function get_professor_review_courses(bigint) to anon, authenticated;
