-- Rankings & Insights
--
-- Four ranking RPCs, one per entity (class / professor / department / school).
-- Each aggregates the FULL evaluation history (all-time, not term-scoped) and
-- supports a selectable metric, sort direction, minimum-evaluation threshold,
-- and limit/offset paging. Metrics:
--   rating     -> avg(course_overall)   (avg(instructor_overall) for professors)
--   difficulty -> avg(course_intellectually_challenging)
--   workload   -> avg(effort_avg_hours_weekly)   (1-5 rating, NOT literal hours)
--   reviews    -> count(*)
--   variation  -> stddev_samp of the rating metric
--
-- Ordering is done DB-side (so paging is stable) via CASE expressions keyed on
-- p_metric / p_order, NULLS LAST, with review_count as a deterministic tiebreak.

-- ---------------------------------------------------------------------------
-- Classes
-- ---------------------------------------------------------------------------
create or replace function rank_classes(
  p_metric    text default 'rating',
  p_order     text default 'desc',
  p_min_evals int  default 5,
  p_limit     int  default 25,
  p_offset    int  default 0
)
returns table (
  course_code     text,
  title           text,
  department_name text,
  rating          numeric,
  difficulty      numeric,
  workload        numeric,
  review_count    bigint,
  variation       numeric
)
language sql
stable
as $$
  with agg as (
    select
      e.course_code,
      avg(e.course_overall)                     as rating,
      avg(e.course_intellectually_challenging)  as difficulty,
      avg(e.effort_avg_hours_weekly)            as workload,
      count(*)                                  as review_count,
      stddev_samp(e.course_overall)             as variation
    from evaluations e
    group by e.course_code
    having count(*) >= p_min_evals
  )
  select
    a.course_code,
    c.title,
    d.name,
    a.rating,
    a.difficulty,
    a.workload,
    a.review_count,
    a.variation
  from agg a
  join courses c on c.course_code = a.course_code
  left join departments d on d.code = c.department_code
  order by
    (case when p_order = 'asc' then
       case p_metric
         when 'rating'     then a.rating
         when 'difficulty' then a.difficulty
         when 'workload'   then a.workload
         when 'reviews'    then a.review_count::numeric
         when 'variation'  then a.variation
       end end) asc nulls last,
    (case when p_order <> 'asc' then
       case p_metric
         when 'rating'     then a.rating
         when 'difficulty' then a.difficulty
         when 'workload'   then a.workload
         when 'reviews'    then a.review_count::numeric
         when 'variation'  then a.variation
       end end) desc nulls last,
    a.review_count desc
  limit p_limit offset p_offset;
$$;

-- ---------------------------------------------------------------------------
-- Professors  (rating/variation use instructor_overall; department = the
-- department of the courses they're most evaluated in)
-- ---------------------------------------------------------------------------
create or replace function rank_professors(
  p_metric    text default 'rating',
  p_order     text default 'desc',
  p_min_evals int  default 5,
  p_limit     int  default 25,
  p_offset    int  default 0
)
returns table (
  instructor_id   bigint,
  name            text,
  department_name text,
  rating          numeric,
  difficulty      numeric,
  workload        numeric,
  review_count    bigint,
  variation       numeric
)
language sql
stable
as $$
  with agg as (
    select
      e.instructor_id,
      avg(e.instructor_overall)                 as rating,
      avg(e.course_intellectually_challenging)  as difficulty,
      avg(e.effort_avg_hours_weekly)            as workload,
      count(*)                                  as review_count,
      stddev_samp(e.instructor_overall)         as variation
    from evaluations e
    group by e.instructor_id
    having count(*) >= p_min_evals
  )
  select
    a.instructor_id,
    i.canonical_name,
    (select d.name
       from evaluations e2
       join courses c2    on c2.course_code = e2.course_code
       join departments d on d.code = c2.department_code
       where e2.instructor_id = a.instructor_id and d.name is not null
       group by d.name
       order by count(*) desc, d.name
       limit 1),
    a.rating,
    a.difficulty,
    a.workload,
    a.review_count,
    a.variation
  from agg a
  join instructors i on i.id = a.instructor_id
  order by
    (case when p_order = 'asc' then
       case p_metric
         when 'rating'     then a.rating
         when 'difficulty' then a.difficulty
         when 'workload'   then a.workload
         when 'reviews'    then a.review_count::numeric
         when 'variation'  then a.variation
       end end) asc nulls last,
    (case when p_order <> 'asc' then
       case p_metric
         when 'rating'     then a.rating
         when 'difficulty' then a.difficulty
         when 'workload'   then a.workload
         when 'reviews'    then a.review_count::numeric
         when 'variation'  then a.variation
       end end) desc nulls last,
    a.review_count desc
  limit p_limit offset p_offset;
$$;

-- ---------------------------------------------------------------------------
-- Departments
-- ---------------------------------------------------------------------------
create or replace function rank_departments(
  p_metric    text default 'rating',
  p_order     text default 'desc',
  p_min_evals int  default 5,
  p_limit     int  default 25,
  p_offset    int  default 0
)
returns table (
  department_code text,
  name            text,
  college         text,
  rating          numeric,
  difficulty      numeric,
  workload        numeric,
  review_count    bigint,
  variation       numeric
)
language sql
stable
as $$
  with agg as (
    select
      d.code    as department_code,
      d.name    as name,
      d.college as college,
      avg(e.course_overall)                     as rating,
      avg(e.course_intellectually_challenging)  as difficulty,
      avg(e.effort_avg_hours_weekly)            as workload,
      count(*)                                  as review_count,
      stddev_samp(e.course_overall)             as variation
    from evaluations e
    join courses c     on c.course_code = e.course_code
    join departments d on d.code = c.department_code
    group by d.code, d.name, d.college
    having count(*) >= p_min_evals
  )
  select
    a.department_code,
    a.name,
    a.college,
    a.rating,
    a.difficulty,
    a.workload,
    a.review_count,
    a.variation
  from agg a
  order by
    (case when p_order = 'asc' then
       case p_metric
         when 'rating'     then a.rating
         when 'difficulty' then a.difficulty
         when 'workload'   then a.workload
         when 'reviews'    then a.review_count::numeric
         when 'variation'  then a.variation
       end end) asc nulls last,
    (case when p_order <> 'asc' then
       case p_metric
         when 'rating'     then a.rating
         when 'difficulty' then a.difficulty
         when 'workload'   then a.workload
         when 'reviews'    then a.review_count::numeric
         when 'variation'  then a.variation
       end end) desc nulls last,
    a.review_count desc
  limit p_limit offset p_offset;
$$;

-- ---------------------------------------------------------------------------
-- Schools (BC colleges)
-- ---------------------------------------------------------------------------
create or replace function rank_schools(
  p_metric    text default 'rating',
  p_order     text default 'desc',
  p_min_evals int  default 5,
  p_limit     int  default 25,
  p_offset    int  default 0
)
returns table (
  college      text,
  rating       numeric,
  difficulty   numeric,
  workload     numeric,
  review_count bigint,
  variation    numeric
)
language sql
stable
as $$
  with agg as (
    select
      d.college as college,
      avg(e.course_overall)                     as rating,
      avg(e.course_intellectually_challenging)  as difficulty,
      avg(e.effort_avg_hours_weekly)            as workload,
      count(*)                                  as review_count,
      stddev_samp(e.course_overall)             as variation
    from evaluations e
    join courses c     on c.course_code = e.course_code
    join departments d on d.code = c.department_code
    where d.college is not null
    group by d.college
    having count(*) >= p_min_evals
  )
  select
    a.college,
    a.rating,
    a.difficulty,
    a.workload,
    a.review_count,
    a.variation
  from agg a
  order by
    (case when p_order = 'asc' then
       case p_metric
         when 'rating'     then a.rating
         when 'difficulty' then a.difficulty
         when 'workload'   then a.workload
         when 'reviews'    then a.review_count::numeric
         when 'variation'  then a.variation
       end end) asc nulls last,
    (case when p_order <> 'asc' then
       case p_metric
         when 'rating'     then a.rating
         when 'difficulty' then a.difficulty
         when 'workload'   then a.workload
         when 'reviews'    then a.review_count::numeric
         when 'variation'  then a.variation
       end end) desc nulls last,
    a.review_count desc
  limit p_limit offset p_offset;
$$;
