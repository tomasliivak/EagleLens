-- Exclude post-grad / continuing-ed departments from the rankings ONLY.
--
-- These departments aren't what the app caters to, so their evaluations should
-- not count toward any ranking aggregate and the entities shouldn't show up.
-- Applied at the evaluation level inside every rank_* RPC, so it cascades to
-- classes, professors, departments, and the ADV school (whose only department is
-- "Advancing Studies"). Course lookup and the Explore page are intentionally
-- untouched -- they use explore_courses / get_course_* and keep all departments.

create or replace function ranking_excluded_dept_name(p_name text)
returns boolean
language sql
immutable
as $$
  select coalesce(p_name, '') in (
    'Advancing Studies',
    'University and Capstone',
    'Carroll School - Office of the Dean'
  );
$$;

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
    join courses c          on c.course_code = e.course_code
    left join departments d on d.code = c.department_code
    where not ranking_excluded_dept_name(d.name)
    group by e.course_code
    having count(*) >= p_min_evals
  )
  select
    a.course_code, c.title, d.name,
    a.rating, a.difficulty, a.workload, a.review_count, a.variation
  from agg a
  join courses c on c.course_code = a.course_code
  left join departments d on d.code = c.department_code
  order by
    (case when p_order = 'asc' then
       case p_metric when 'rating' then a.rating when 'difficulty' then a.difficulty
         when 'workload' then a.workload when 'reviews' then a.review_count::numeric
         when 'variation' then a.variation end end) asc nulls last,
    (case when p_order <> 'asc' then
       case p_metric when 'rating' then a.rating when 'difficulty' then a.difficulty
         when 'workload' then a.workload when 'reviews' then a.review_count::numeric
         when 'variation' then a.variation end end) desc nulls last,
    a.review_count desc
  limit p_limit offset p_offset;
$$;

-- ---------------------------------------------------------------------------
-- Professors
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
    join courses c          on c.course_code = e.course_code
    left join departments d on d.code = c.department_code
    where not ranking_excluded_dept_name(d.name)
    group by e.instructor_id
    having count(*) >= p_min_evals
  )
  select
    a.instructor_id, i.canonical_name,
    (select d.name
       from evaluations e2
       join courses c2    on c2.course_code = e2.course_code
       join departments d on d.code = c2.department_code
       where e2.instructor_id = a.instructor_id
         and d.name is not null
         and not ranking_excluded_dept_name(d.name)
       group by d.name order by count(*) desc, d.name limit 1),
    a.rating, a.difficulty, a.workload, a.review_count, a.variation
  from agg a
  join instructors i on i.id = a.instructor_id
  order by
    (case when p_order = 'asc' then
       case p_metric when 'rating' then a.rating when 'difficulty' then a.difficulty
         when 'workload' then a.workload when 'reviews' then a.review_count::numeric
         when 'variation' then a.variation end end) asc nulls last,
    (case when p_order <> 'asc' then
       case p_metric when 'rating' then a.rating when 'difficulty' then a.difficulty
         when 'workload' then a.workload when 'reviews' then a.review_count::numeric
         when 'variation' then a.variation end end) desc nulls last,
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
      min(d.code) as department_code,
      d.name      as name,
      d.college   as college,
      avg(e.course_overall)                     as rating,
      avg(e.course_intellectually_challenging)  as difficulty,
      avg(e.effort_avg_hours_weekly)            as workload,
      count(*)                                  as review_count,
      stddev_samp(e.course_overall)             as variation
    from evaluations e
    join courses c     on c.course_code = e.course_code
    join departments d on d.code = c.department_code
    where not ranking_excluded_dept_name(d.name)
    group by d.name, d.college
    having count(*) >= p_min_evals
  )
  select
    a.department_code, a.name, a.college,
    a.rating, a.difficulty, a.workload, a.review_count, a.variation
  from agg a
  order by
    (case when p_order = 'asc' then
       case p_metric when 'rating' then a.rating when 'difficulty' then a.difficulty
         when 'workload' then a.workload when 'reviews' then a.review_count::numeric
         when 'variation' then a.variation end end) asc nulls last,
    (case when p_order <> 'asc' then
       case p_metric when 'rating' then a.rating when 'difficulty' then a.difficulty
         when 'workload' then a.workload when 'reviews' then a.review_count::numeric
         when 'variation' then a.variation end end) desc nulls last,
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
      and not ranking_excluded_dept_name(d.name)
    group by d.college
    having count(*) >= p_min_evals
  )
  select
    a.college, a.rating, a.difficulty, a.workload, a.review_count, a.variation
  from agg a
  order by
    (case when p_order = 'asc' then
       case p_metric when 'rating' then a.rating when 'difficulty' then a.difficulty
         when 'workload' then a.workload when 'reviews' then a.review_count::numeric
         when 'variation' then a.variation end end) asc nulls last,
    (case when p_order <> 'asc' then
       case p_metric when 'rating' then a.rating when 'difficulty' then a.difficulty
         when 'workload' then a.workload when 'reviews' then a.review_count::numeric
         when 'variation' then a.variation end end) desc nulls last,
    a.review_count desc
  limit p_limit offset p_offset;
$$;
