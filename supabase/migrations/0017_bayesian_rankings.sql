-- Bayesian-weighted ordering for the ranking RPCs and the Explore rating sort.
--
-- Rankings/Explore previously sorted by the raw metric average, so an item with a
-- handful of evaluations could outrank one with hundreds. These functions now sort
-- by a Bayesian-adjusted score that shrinks each item toward the category prior:
--
--   score = (v * R + m * C) / (v + m)
--
--   R = the item's raw metric average (still what we RETURN/display)
--   v = the item's total response count = sum(response_count)
--   m = median of v among the eligible items in this ranking (per query)
--   C = the prior = average of R among the same eligible items
--
-- Only the mean-style metrics are adjusted: rating, difficulty, workload. The
-- "reviews" (count) and "variation" (stddev) sorts keep their raw ordering. In
-- Explore only the rating sort is adjusted. The returned columns are the raw
-- averages in every case -- only the ORDER BY changes -- so the API/return shapes
-- are untouched and CREATE OR REPLACE suffices (no signature change).

-- ---------------------------------------------------------------------------
-- rank_classes  (base: 0015; credits + student_level filters, no dept exclusion)
-- ---------------------------------------------------------------------------
create or replace function rank_classes(
  p_metric        text default 'rating',
  p_order         text default 'desc',
  p_min_evals     int  default 5,
  p_credits       int  default null,
  p_student_level text default null,
  p_limit         int  default 25,
  p_offset        int  default 0
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
      stddev_samp(e.course_overall)             as variation,
      sum(e.response_count)                     as total_responses
    from evaluations e
    group by e.course_code
    having count(*) >= p_min_evals
  ),
  eligible as (
    select
      a.course_code, c.title, d.name as department_name,
      a.rating, a.difficulty, a.workload, a.review_count, a.variation, a.total_responses
    from agg a
    join courses c on c.course_code = a.course_code
    left join departments d on d.code = c.department_code
    where (p_credits is null or c.credits = p_credits)
      and (p_student_level is null
           or exists (select 1 from sections s
                       where s.course_code = a.course_code
                         and (s.student_level = p_student_level
                              or s.student_level = 'Both')))
  ),
  scored as (
    select x.*,
      coalesce(x.total_responses, 0) as v,
      (case p_metric
         when 'rating' then x.rating when 'difficulty' then x.difficulty
         when 'workload' then x.workload when 'reviews' then x.review_count::numeric
         when 'variation' then x.variation end) as metric_raw
    from eligible x
  ),
  stats as (
    select percentile_cont(0.5) within group (order by v) as m_prior,
           avg(metric_raw) as c_prior
    from scored
  ),
  final as (
    select s.*,
      case
        when p_metric not in ('rating','difficulty','workload') then s.metric_raw
        when s.metric_raw is null then null
        when (s.v + st.m_prior) = 0 then s.metric_raw
        else (s.v * s.metric_raw + st.m_prior * st.c_prior) / (s.v + st.m_prior)
      end as score
    from scored s cross join stats st
  )
  select
    f.course_code, f.title, f.department_name,
    f.rating, f.difficulty, f.workload, f.review_count, f.variation
  from final f
  order by
    (case when p_order = 'asc' then f.score end) asc nulls last,
    (case when p_order <> 'asc' then f.score end) desc nulls last,
    f.review_count desc
  limit p_limit offset p_offset;
$$;

-- ---------------------------------------------------------------------------
-- rank_professors  (base: 0010; dept exclusion + most-frequent-dept subquery)
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
      stddev_samp(e.instructor_overall)         as variation,
      sum(e.response_count)                     as total_responses
    from evaluations e
    join courses c          on c.course_code = e.course_code
    left join departments d on d.code = c.department_code
    where not ranking_excluded_dept_name(d.name)
    group by e.instructor_id
    having count(*) >= p_min_evals
  ),
  scored as (
    select a.*,
      coalesce(a.total_responses, 0) as v,
      (case p_metric
         when 'rating' then a.rating when 'difficulty' then a.difficulty
         when 'workload' then a.workload when 'reviews' then a.review_count::numeric
         when 'variation' then a.variation end) as metric_raw
    from agg a
  ),
  stats as (
    select percentile_cont(0.5) within group (order by v) as m_prior,
           avg(metric_raw) as c_prior
    from scored
  ),
  final as (
    select s.*,
      case
        when p_metric not in ('rating','difficulty','workload') then s.metric_raw
        when s.metric_raw is null then null
        when (s.v + st.m_prior) = 0 then s.metric_raw
        else (s.v * s.metric_raw + st.m_prior * st.c_prior) / (s.v + st.m_prior)
      end as score
    from scored s cross join stats st
  )
  select
    f.instructor_id, i.canonical_name,
    (select d.name
       from evaluations e2
       join courses c2    on c2.course_code = e2.course_code
       join departments d on d.code = c2.department_code
       where e2.instructor_id = f.instructor_id
         and d.name is not null
         and not ranking_excluded_dept_name(d.name)
       group by d.name order by count(*) desc, d.name limit 1),
    f.rating, f.difficulty, f.workload, f.review_count, f.variation
  from final f
  join instructors i on i.id = f.instructor_id
  order by
    (case when p_order = 'asc' then f.score end) asc nulls last,
    (case when p_order <> 'asc' then f.score end) desc nulls last,
    f.review_count desc
  limit p_limit offset p_offset;
$$;

-- ---------------------------------------------------------------------------
-- rank_departments  (base: 0010)
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
      stddev_samp(e.course_overall)             as variation,
      sum(e.response_count)                     as total_responses
    from evaluations e
    join courses c     on c.course_code = e.course_code
    join departments d on d.code = c.department_code
    where not ranking_excluded_dept_name(d.name)
    group by d.name, d.college
    having count(*) >= p_min_evals
  ),
  scored as (
    select a.*,
      coalesce(a.total_responses, 0) as v,
      (case p_metric
         when 'rating' then a.rating when 'difficulty' then a.difficulty
         when 'workload' then a.workload when 'reviews' then a.review_count::numeric
         when 'variation' then a.variation end) as metric_raw
    from agg a
  ),
  stats as (
    select percentile_cont(0.5) within group (order by v) as m_prior,
           avg(metric_raw) as c_prior
    from scored
  ),
  final as (
    select s.*,
      case
        when p_metric not in ('rating','difficulty','workload') then s.metric_raw
        when s.metric_raw is null then null
        when (s.v + st.m_prior) = 0 then s.metric_raw
        else (s.v * s.metric_raw + st.m_prior * st.c_prior) / (s.v + st.m_prior)
      end as score
    from scored s cross join stats st
  )
  select
    f.department_code, f.name, f.college,
    f.rating, f.difficulty, f.workload, f.review_count, f.variation
  from final f
  order by
    (case when p_order = 'asc' then f.score end) asc nulls last,
    (case when p_order <> 'asc' then f.score end) desc nulls last,
    f.review_count desc
  limit p_limit offset p_offset;
$$;

-- ---------------------------------------------------------------------------
-- rank_schools  (base: 0010)
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
      stddev_samp(e.course_overall)             as variation,
      sum(e.response_count)                     as total_responses
    from evaluations e
    join courses c     on c.course_code = e.course_code
    join departments d on d.code = c.department_code
    where d.college is not null
      and not ranking_excluded_dept_name(d.name)
    group by d.college
    having count(*) >= p_min_evals
  ),
  scored as (
    select a.*,
      coalesce(a.total_responses, 0) as v,
      (case p_metric
         when 'rating' then a.rating when 'difficulty' then a.difficulty
         when 'workload' then a.workload when 'reviews' then a.review_count::numeric
         when 'variation' then a.variation end) as metric_raw
    from agg a
  ),
  stats as (
    select percentile_cont(0.5) within group (order by v) as m_prior,
           avg(metric_raw) as c_prior
    from scored
  ),
  final as (
    select s.*,
      case
        when p_metric not in ('rating','difficulty','workload') then s.metric_raw
        when s.metric_raw is null then null
        when (s.v + st.m_prior) = 0 then s.metric_raw
        else (s.v * s.metric_raw + st.m_prior * st.c_prior) / (s.v + st.m_prior)
      end as score
    from scored s cross join stats st
  )
  select
    f.college, f.rating, f.difficulty, f.workload, f.review_count, f.variation
  from final f
  order by
    (case when p_order = 'asc' then f.score end) asc nulls last,
    (case when p_order <> 'asc' then f.score end) desc nulls last,
    f.review_count desc
  limit p_limit offset p_offset;
$$;

-- ---------------------------------------------------------------------------
-- explore_courses  (base: 0015; Bayesian on the rating sort only)
-- ---------------------------------------------------------------------------
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
  with offered as (
    select distinct s.course_code
    from sections s
    where s.term = p_term
      and s.credits <> 0
      and (p_college is null or s.college = p_college)
      and (p_student_level is null
           or s.student_level = p_student_level
           or s.student_level = 'Both')
  ),
  course_instructors as (
    select distinct s.course_code, si.instructor_id
    from sections s
    join section_instructors si on si.section_id = s.id
    where s.term = p_term and s.credits <> 0
  ),
  cur_agg as (
    select
      ci.course_code,
      avg(icr.instructor_overall)                 as avg_rating,
      avg(icr.course_intellectually_challenging)  as difficulty,
      avg(icr.effort_avg_hours_weekly)            as avg_workload,
      sum(icr.evaluation_count)                   as review_count,
      sum(icr.total_responses)                    as responses
    from course_instructors ci
    join instructor_course_ratings icr
      on icr.instructor_id = ci.instructor_id
     and icr.course_code = ci.course_code
    group by ci.course_code
  ),
  all_agg as (
    select
      cr.course_code,
      cr.instructor_overall                     as avg_rating,
      cr.course_intellectually_challenging      as difficulty,
      cr.effort_avg_hours_weekly                as avg_workload,
      cr.evaluation_count                       as review_count,
      cr.total_responses                        as responses
    from course_ratings cr
  ),
  tiered as (
    select
      o.course_code,
      cur.avg_rating          as cur_rating,
      cur.difficulty          as cur_diff,
      cur.avg_workload        as cur_wl,
      coalesce(cur.review_count, 0)   as cur_n,
      coalesce(cur.responses, 0)      as cur_resp,
      all_a.avg_rating        as all_rating,
      all_a.difficulty        as all_diff,
      all_a.avg_workload      as all_wl,
      coalesce(all_a.review_count, 0) as all_n,
      coalesce(all_a.responses, 0)    as all_resp
    from offered o
    left join cur_agg cur   on cur.course_code = o.course_code
    left join all_agg all_a on all_a.course_code = o.course_code
  ),
  chosen as (
    select
      t.course_code,
      case
        when t.cur_n >= greatest(p_min_reviews, 1) then 'current'
        when t.all_n >= greatest(p_min_reviews, 1) then 'historical'
        else 'limited'
      end as source,
      case when t.cur_n >= greatest(p_min_reviews, 1) then t.cur_rating else t.all_rating end as avg_rating,
      case when t.cur_n >= greatest(p_min_reviews, 1) then t.cur_diff   else t.all_diff   end as difficulty,
      case when t.cur_n >= greatest(p_min_reviews, 1) then t.cur_wl     else t.all_wl     end as avg_workload,
      case
        when t.cur_n >= greatest(p_min_reviews, 1) then t.cur_n
        when t.all_n >= greatest(p_min_reviews, 1) then t.all_n
        else greatest(t.cur_n, t.all_n)
      end as review_count,
      case
        when t.cur_n >= greatest(p_min_reviews, 1) then t.cur_resp
        when t.all_n >= greatest(p_min_reviews, 1) then t.all_resp
        else greatest(t.cur_resp, t.all_resp)
      end as responses
    from tiered t
  ),
  eligible as (
    select
      ch.course_code, co.title, ch.source,
      ch.avg_rating, ch.difficulty, ch.avg_workload, ch.review_count, ch.responses
    from chosen ch
    join courses co on co.course_code = ch.course_code
    join offered o on o.course_code = ch.course_code
    left join departments d on d.code = co.department_code
    where (p_core is null
           or exists (select 1 from course_core_requirements x
                       where x.course_code = co.course_code and x.core_code = p_core))
      and (p_department is null or d.name = p_department)
      and (p_max_workload is null or ch.avg_workload <= p_max_workload)
      and (p_credits is null or co.credits = p_credits)
  ),
  stats as (
    select percentile_cont(0.5) within group (order by coalesce(responses, 0)) as m_prior,
           avg(avg_rating) as c_prior
    from eligible
  ),
  scored as (
    select
      e.*,
      case
        when p_sort = 'rating' then
          case
            when e.avg_rating is null then null
            when (coalesce(e.responses, 0) + s.m_prior) = 0 then e.avg_rating
            else (coalesce(e.responses, 0) * e.avg_rating + s.m_prior * s.c_prior)
                 / (coalesce(e.responses, 0) + s.m_prior)
          end
        else
          case p_sort when 'difficulty' then e.difficulty when 'workload' then e.avg_workload end
      end as order_value
    from eligible e cross join stats s
  ),
  ranked as (
    select
      sc.course_code, sc.title, sc.avg_rating, sc.review_count,
      sc.difficulty, sc.avg_workload, sc.source, sc.order_value
    from scored sc
    order by
      (case when sc.source = 'limited' then 1 else 0 end) asc,
      (case when p_order = 'asc' then sc.order_value end) asc nulls last,
      (case when p_order <> 'asc' then sc.order_value end) desc nulls last,
      sc.course_code
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
      where ccr.course_code = r.course_code),
    r.source
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
    (case when r.source = 'limited' then 1 else 0 end) asc,
    (case when p_order = 'asc' then r.order_value end) asc nulls last,
    (case when p_order <> 'asc' then r.order_value end) desc nulls last,
    r.course_code;
$$;
