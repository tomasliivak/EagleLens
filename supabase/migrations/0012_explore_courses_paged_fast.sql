-- Make explore_courses fast for broad searches (e.g. "All" min reviews).
--
-- 0011 computed the per-course "best instructor" lateral and the core-requirements
-- subquery for EVERY matching course before applying limit/offset, so an unfiltered
-- search ran the lateral over thousands of courses and hit the statement timeout.
-- Fix: rank/filter/sort/limit on the cheap aggregates first (CTE `ranked`), then run
-- the lateral + core-requirements only for the <= p_limit rows on the page.

create or replace function explore_courses(
  p_term         text,
  p_college      text default null,
  p_department   text default null,
  p_core         text default null,
  p_min_reviews  int default 0,
  p_max_workload numeric default null,
  p_sort         text default 'rating',
  p_order        text default 'desc',
  p_limit        int default 25,
  p_offset       int default 0
)
returns table (
  course_code           text,
  title                 text,
  best_instructor_name  text,
  best_instructor_rating numeric,
  avg_rating            numeric,
  review_count          bigint,
  difficulty            numeric,
  avg_workload          numeric,
  core_requirements     text[]
)
language sql
stable
as $$
  with offered as (
    select distinct s.course_code
    from sections s
    where s.term = p_term
      and s.credits <> 0
      and (p_college is null or s.college = p_college)
  ),
  course_instructors as (
    select distinct s.course_code, si.instructor_id
    from sections s
    join section_instructors si on si.section_id = s.id
    where s.term = p_term and s.credits <> 0
  ),
  agg as (
    select
      ci.course_code,
      avg(icr.instructor_overall)                 as avg_rating,
      avg(icr.course_intellectually_challenging)  as difficulty,
      avg(icr.effort_avg_hours_weekly)            as avg_workload,
      sum(icr.evaluation_count)                   as review_count
    from course_instructors ci
    join instructor_course_ratings icr
      on icr.instructor_id = ci.instructor_id
     and icr.course_code = ci.course_code
    group by ci.course_code
  ),
  ranked as (
    select
      c.course_code,
      c.title,
      agg.avg_rating,
      coalesce(agg.review_count, 0) as review_count,
      agg.difficulty,
      agg.avg_workload
    from offered o
    join courses c on c.course_code = o.course_code
    left join agg on agg.course_code = c.course_code
    left join departments d on d.code = c.department_code
    where (p_core is null
           or exists (select 1 from course_core_requirements x
                       where x.course_code = c.course_code and x.core_code = p_core))
      and (p_department is null or d.name = p_department)
      and (p_min_reviews <= 0 or coalesce(agg.review_count, 0) >= p_min_reviews)
      and (p_max_workload is null or agg.avg_workload <= p_max_workload)
    order by
      (case when p_order = 'asc' then
         case p_sort when 'rating' then agg.avg_rating
                     when 'difficulty' then agg.difficulty
                     when 'workload' then agg.avg_workload end end) asc nulls last,
      (case when p_order <> 'asc' then
         case p_sort when 'rating' then agg.avg_rating
                     when 'difficulty' then agg.difficulty
                     when 'workload' then agg.avg_workload end end) desc nulls last,
      c.course_code
    limit p_limit offset p_offset
  )
  select
    r.course_code,
    r.title,
    best.canonical_name,
    best.instructor_overall,
    r.avg_rating,
    r.review_count,
    r.difficulty,
    r.avg_workload,
    (select array_agg(ccr.core_code order by ccr.core_code)
       from course_core_requirements ccr
      where ccr.course_code = r.course_code)
  from ranked r
  left join lateral (
    select i.canonical_name, ir.instructor_overall
    from sections s
    join section_instructors si on si.section_id = s.id
    join instructors i on i.id = si.instructor_id
    left join instructor_ratings ir on ir.instructor_id = i.id
    where s.course_code = r.course_code and s.term = p_term and s.credits <> 0
    order by ir.instructor_overall desc nulls last, i.canonical_name
    limit 1
  ) best on true
  order by
    (case when p_order = 'asc' then
       case p_sort when 'rating' then r.avg_rating
                   when 'difficulty' then r.difficulty
                   when 'workload' then r.avg_workload end end) asc nulls last,
    (case when p_order <> 'asc' then
       case p_sort when 'rating' then r.avg_rating
                   when 'difficulty' then r.difficulty
                   when 'workload' then r.avg_workload end end) desc nulls last,
    r.course_code;
$$;
