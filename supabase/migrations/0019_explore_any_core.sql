-- Add an "Any Core" option to explore_courses: the sentinel p_core = '__any__'
-- matches any course that fulfills at least one core requirement (rather than a
-- specific core). Only the core predicate in the `picked` CTE changes; the rest
-- of the function is identical to 0018_precomputed_caches.sql.

create or replace function explore_courses(
  p_term          text,
  p_college       text default null,
  p_department    text default null,
  p_core          text default null,
  p_min_reviews   int default 0,
  p_max_workload  numeric default null,
  p_credits       int default null,
  p_student_level text default null,
  p_sort          text default 'rating',
  p_order         text default 'desc',
  p_limit         int default 25,
  p_offset        int default 0
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
  core_requirements     text[],
  source                text
)
language sql
stable
as $$
  with picked as (
    select
      ecs.course_code, ecs.title, ecs.best_instructor_name, ecs.best_instructor_rating,
      ecs.core_requirements, ecs.m_prior, ecs.c_rating,
      case
        when ecs.cur_n >= greatest(p_min_reviews, 1) then 'current'
        when ecs.all_n >= greatest(p_min_reviews, 1) then 'historical'
        else 'limited'
      end as source,
      case when ecs.cur_n >= greatest(p_min_reviews, 1) then ecs.cur_rating else ecs.all_rating end as avg_rating,
      case when ecs.cur_n >= greatest(p_min_reviews, 1) then ecs.cur_difficulty else ecs.all_difficulty end as difficulty,
      case when ecs.cur_n >= greatest(p_min_reviews, 1) then ecs.cur_workload else ecs.all_workload end as avg_workload,
      case
        when ecs.cur_n >= greatest(p_min_reviews, 1) then ecs.cur_n
        when ecs.all_n >= greatest(p_min_reviews, 1) then ecs.all_n
        else greatest(ecs.cur_n, ecs.all_n)
      end as review_count,
      case
        when ecs.cur_n >= greatest(p_min_reviews, 1) then ecs.cur_responses
        when ecs.all_n >= greatest(p_min_reviews, 1) then ecs.all_responses
        else greatest(ecs.cur_responses, ecs.all_responses)
      end as responses
    from explore_course_stats ecs
    where ecs.term = p_term
      and (p_college is null or p_college = any(ecs.college_codes))
      and (p_department is null or ecs.department_name = p_department)
      and (
        p_core is null
        or (p_core = '__any__' and coalesce(array_length(ecs.core_requirements, 1), 0) > 0)
        or p_core = any(ecs.core_requirements)
      )
      and (p_credits is null or ecs.credits = p_credits)
      and (p_student_level is null
           or p_student_level = any(ecs.student_levels)
           or 'Both' = any(ecs.student_levels))
  ),
  filtered as (
    select p.*, bayes_score(p.responses, p.avg_rating, p.m_prior, p.c_rating) as br
    from picked p
    where (p_max_workload is null or p.avg_workload <= p_max_workload)
  )
  select
    f.course_code, f.title, f.best_instructor_name, f.best_instructor_rating,
    f.avg_rating, f.review_count, f.difficulty, f.avg_workload,
    f.core_requirements, f.source
  from filtered f
  order by
    (case when f.source = 'limited' then 1 else 0 end) asc,
    (case when p_order = 'asc' then
       (case p_sort when 'rating' then f.br when 'difficulty' then f.difficulty when 'workload' then f.avg_workload end)
     end) asc nulls last,
    (case when p_order <> 'asc' then
       (case p_sort when 'rating' then f.br when 'difficulty' then f.difficulty when 'workload' then f.avg_workload end)
     end) desc nulls last,
    f.course_code
  limit p_limit offset p_offset;
$$;
