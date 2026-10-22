-- Percentile context for the Explore page cards: explore_courses gains
-- difficulty_pct and workload_pct.
--
-- Explore shows COURSE-level averages (current-term instructors' average, or the
-- course's all-time average), so the comparison population is BC courses, not
-- the professor x course pairs used on the course page (0031). Same mid-rank
-- methodology as 0031:
--   P = 100 * (B + 0.5 * E) / N
--   B = courses strictly below, E = courses equal, N = population size.
-- Population = ranking_classes (one row per course, all-time averages) with
-- review_count >= 5 -- the eligibility threshold the Bayesian prior uses -- and a
-- non-null metric. Percentiles are null when the value is null or the row's
-- source is 'limited' (too few evals to be meaningful).
--
-- Everything else is identical to 0019_explore_any_core.sql. The return type
-- changes, so the function is dropped and recreated (nothing depends on it; the
-- migration is one transaction). The final ORDER BY moves into row_number() so
-- percentiles are only computed for the returned page.

drop function if exists public.explore_courses(text, text, text, text, int, numeric, int, text, text, text, int, int);

create function public.explore_courses(
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
    case when pg.difficulty is null or pg.source = 'limited' then null else (
      select 100.0 * (count(*) filter (where rc.difficulty < pg.difficulty)
                      + 0.5 * count(*) filter (where rc.difficulty = pg.difficulty))
             / nullif(count(*), 0)
      from ranking_classes rc
      where rc.review_count >= 5 and rc.difficulty is not null
    ) end,
    case when pg.avg_workload is null or pg.source = 'limited' then null else (
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
