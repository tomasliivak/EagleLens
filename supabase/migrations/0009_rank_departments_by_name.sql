-- Fix duplicate departments in the rankings.
--
-- BC splits many logical departments into multiple subject codes that share one
-- human-readable name (e.g. "Advancing Studies" -> 26 codes, "Fine Arts" ->
-- ARTH/ARTS/FILM). The original rank_departments grouped by d.code, so a single
-- department surfaced once per code. Group by name + college instead, so each
-- logical department is one aggregated row; min(code) is the representative code.

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
    group by d.name, d.college
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
