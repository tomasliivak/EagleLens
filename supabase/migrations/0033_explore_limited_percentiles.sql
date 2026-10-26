-- explore_courses: percentiles for 'limited' rows too.
--
-- 0032 nulled difficulty_pct / workload_pct whenever source = 'limited', but
-- those rows still display the course's all-time (historical) difficulty and
-- workload, so the cards showed a real number next to an empty bar. Limited rows
-- are now ranked by that same displayed value against the same population
-- (ranking_classes, review_count >= 5); percentiles are null only when the value
-- itself is null (no evals at all).
--
-- Everything else is identical to 0032. Signature and return type are
-- unchanged, so create or replace is enough.

create or replace function public.explore_courses(
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
  source                text,
  difficulty_pct        numeric,
  workload_pct          numeric
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
  ),
  ordered as (
    select f.*,
      row_number() over (order by
        (case when f.source = 'limited' then 1 else 0 end) asc,
        (case when p_order = 'asc' then
           (case p_sort when 'rating' then f.br when 'difficulty' then f.difficulty when 'workload' then f.avg_workload end)
         end) asc nulls last,
        (case when p_order <> 'asc' then
           (case p_sort when 'rating' then f.br when 'difficulty' then f.difficulty when 'workload' then f.avg_workload end)
         end) desc nulls last,
        f.course_code
      ) as ord
    from filtered f
  ),
  page as (
    select o.* from ordered o
    where o.ord > p_offset
    order by o.ord
    limit p_limit
  )
  select
    pg.course_code, pg.title, pg.best_instructor_name, pg.best_instructor_rating,
    pg.avg_rating, pg.review_count, pg.difficulty, pg.avg_workload,
    pg.core_requirements, pg.source,
    case when pg.difficulty is null then null else (
      select 100.0 * (count(*) filter (where rc.difficulty < pg.difficulty)
                      + 0.5 * count(*) filter (where rc.difficulty = pg.difficulty))
             / nullif(count(*), 0)
      from ranking_classes rc
      where rc.review_count >= 5 and rc.difficulty is not null
    ) end,
    case when pg.avg_workload is null then null else (
      select 100.0 * (count(*) filter (where rc.workload < pg.avg_workload)
                      + 0.5 * count(*) filter (where rc.workload = pg.avg_workload))
             / nullif(count(*), 0)
      from ranking_classes rc
      where rc.review_count >= 5 and rc.workload is not null
    ) end
  from page pg
  order by pg.ord;
$$;

grant execute on function public.explore_courses(text, text, text, text, int, numeric, int, text, text, text, int, int)
  to anon, authenticated, service_role;
