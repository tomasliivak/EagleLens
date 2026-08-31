-- get_professor's latest_semester subquery cast the second whitespace-delimited
-- field of evaluations.semester to int, which throws on the non-canonical values
-- in the feed ("Midterm Spring 2022" -> "Spring"::int). get_department (0021) and
-- get_school (0022) already guard against this; 0020 never got the same fix, so
-- every professor with such a row returned a 500. Only that subquery changes.
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
      -- Only the canonical "Season YYYY" values; the feed also has
      -- "Midterm Fall 2025", "2024FALL1", "Spring 1 2023" etc. that would break
      -- the year cast below and aren't real terms.
      where e.instructor_id = i.id
        and e.semester ~ '^(Fall|Spring|Summer|Winter) [0-9]{4}$'
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
