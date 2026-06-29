-- School profile page RPCs.
-- A "school" is a BC college code (MCAS, CSOM, ...) carried by departments.college
-- (the same column rank_schools (0017) groups on). The page route carries the
-- college code, so these aggregate over every course in that college.
--
-- Metrics mirror the school-centric aggregates in rank_schools: rating uses
-- course_overall (not instructor_overall). rank_school_professors reuses the
-- Bayesian-score pattern from rank_professors (0017), scoped to one college.

-- Header: one row of school-level aggregates plus the most recent semester
-- with evaluations in the school.
create or replace function get_school(p_code text)
returns table (
  code            text,
  overall         numeric,
  difficulty      numeric,
  workload        numeric,
  interest        numeric,
  total_evals     bigint,
  course_count    bigint,
  latest_semester text
)
language sql
stable
as $$
  with evals as (
    select e.*
    from evaluations e
    join courses c     on c.course_code = e.course_code
    join departments d on d.code = c.department_code
    where d.college = p_code
  )
  select
    p_code,
    (select avg(course_overall) from evals),
    (select avg(course_intellectually_challenging) from evals),
    (select avg(effort_avg_hours_weekly) from evals),
    (select avg(stimulated_interest) from evals),
    (select count(*) from evals),
    (select count(distinct course_code) from evals),
    (select e.semester
       from evals e
      -- Only the canonical "Season YYYY" values; the feed also has
      -- "Midterm Fall 2025", "2024FALL1", "Spring 1 2023" etc. that would break
      -- the year cast below and aren't real terms.
      where e.semester ~ '^(Fall|Spring|Summer|Winter) [0-9]{4}$'
      order by split_part(e.semester, ' ', 2)::int desc,
        case split_part(e.semester, ' ', 1)
          when 'Winter' then 4 when 'Fall' then 3 when 'Summer' then 2 when 'Spring' then 1 else 0
        end desc
      limit 1);
$$;

grant execute on function get_school(text) to anon, authenticated;

-- Top professors in a school, ranked by a Bayesian-adjusted score over their
-- instructor_overall within this college's courses (same formula/shape as
-- rank_professors). Returns the raw average; only the ORDER BY uses the score.
create or replace function rank_school_professors(
  p_college    text,
  p_limit      int default 8,
  p_min_evals  int default 1
)
returns table (
  instructor_id bigint,
  name          text,
  rating        numeric,
  review_count  bigint
)
language sql
stable
as $$
  with agg as (
    select
      e.instructor_id,
      avg(e.instructor_overall) as rating,
      count(*)                  as review_count,
      sum(e.response_count)     as total_responses
    from evaluations e
    join courses c     on c.course_code = e.course_code
    join departments d on d.code = c.department_code
    where d.college = p_college
    group by e.instructor_id
    having count(*) >= p_min_evals
  ),
  scored as (
    select a.*, coalesce(a.total_responses, 0) as v
    from agg a
  ),
  stats as (
    select percentile_cont(0.5) within group (order by v) as m_prior,
           avg(rating) as c_prior
    from scored
  ),
  final as (
    select s.*,
      case
        when s.rating is null then null
        when (s.v + st.m_prior) = 0 then s.rating
        else (s.v * s.rating + st.m_prior * st.c_prior) / (s.v + st.m_prior)
      end as score
    from scored s cross join stats st
  )
  select f.instructor_id, i.canonical_name, f.rating, f.review_count
  from final f
  join instructors i on i.id = f.instructor_id
  order by f.score desc nulls last, f.review_count desc
  limit p_limit;
$$;

grant execute on function rank_school_professors(text, int, int) to anon, authenticated;
