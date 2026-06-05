-- Professor profile page RPCs.
-- All aggregates use plain avg()/count() to match the instructor_ratings /
-- instructor_course_ratings views (migration 0001), which the rest of the app
-- relies on.

-- Header: one row of professor-level aggregates plus the dominant department,
-- its college, and the most recent semester taught.
create or replace function get_professor(p_id bigint)
returns table (
  id              bigint,
  name            text,
  overall         numeric,
  difficulty      numeric,
  workload        numeric,
  interest        numeric,
  total_evals     bigint,
  department      text,
  college         text,
  latest_semester text
)
language sql
stable
as $$
  select
    i.id,
    i.canonical_name,
    (select avg(e.instructor_overall) from evaluations e where e.instructor_id = i.id),
    (select avg(e.course_intellectually_challenging) from evaluations e where e.instructor_id = i.id),
    (select avg(e.effort_avg_hours_weekly) from evaluations e where e.instructor_id = i.id),
    (select avg(e.stimulated_interest) from evaluations e where e.instructor_id = i.id),
    (select count(*) from evaluations e where e.instructor_id = i.id),
    dept.name,
    dept.college,
    (select e.semester
       from evaluations e
      where e.instructor_id = i.id and e.semester is not null
      order by split_part(e.semester, ' ', 2)::int desc,
        case split_part(e.semester, ' ', 1)
          when 'Winter' then 4 when 'Fall' then 3 when 'Summer' then 2 when 'Spring' then 1 else 0
        end desc
      limit 1)
  from instructors i
  left join lateral (
    select d.name, d.college
    from instructor_course_ratings icr
    join courses c on c.course_code = icr.course_code
    join departments d on d.code = c.department_code
    where icr.instructor_id = i.id
    group by d.name, d.college
    order by sum(icr.evaluation_count) desc nulls last
    limit 1
  ) dept on true
  where i.id = p_id;
$$;

grant execute on function get_professor(bigint) to anon, authenticated;

-- Courses the professor is teaching in the given term (driven by sections, so a
-- course with no prior evaluations still appears). One row per section.
create or replace function get_professor_sections(p_id bigint, p_term text default '2026FALL')
returns table (
  course_code        text,
  title              text,
  credits            int,
  meeting_text       text,
  rating             numeric,
  difficulty         numeric,
  workload           numeric,
  evaluation_count   bigint
)
language sql
stable
as $$
  select
    s.course_code,
    c.title,
    s.credits,
    s.meeting_text,
    icr.instructor_overall,
    icr.course_intellectually_challenging,
    icr.effort_avg_hours_weekly,
    icr.evaluation_count
  from sections s
  join section_instructors si on si.section_id = s.id
  left join courses c on c.course_code = s.course_code
  left join instructor_course_ratings icr
    on icr.instructor_id = p_id and icr.course_code = s.course_code
  where si.instructor_id = p_id and s.term = p_term and s.credits <> 0
  order by s.course_code, s.section_number;
$$;

grant execute on function get_professor_sections(bigint, text) to anon, authenticated;

-- Every course the professor has evaluation data for (historical catalog +
-- highlights source).
create or replace function get_professor_courses(p_id bigint)
returns table (
  course_code      text,
  title            text,
  rating           numeric,
  difficulty       numeric,
  workload         numeric,
  evaluation_count bigint,
  total_responses  bigint
)
language sql
stable
as $$
  select
    icr.course_code,
    coalesce(
      c.title,
      (select e.course_name from evaluations e
        where e.instructor_id = p_id and e.course_code = icr.course_code
          and e.course_name is not null
        limit 1)
    ),
    icr.instructor_overall,
    icr.course_intellectually_challenging,
    icr.effort_avg_hours_weekly,
    icr.evaluation_count,
    icr.total_responses
  from instructor_course_ratings icr
  left join courses c on c.course_code = icr.course_code
  where icr.instructor_id = p_id
  order by icr.evaluation_count desc nulls last;
$$;

grant execute on function get_professor_courses(bigint) to anon, authenticated;
