-- Credits filter for explore_courses and rank_classes.
--
-- Both gain an optional `p_credits int` argument that filters on the course's
-- catalog credits (courses.credits, which is fully populated). null = no filter
-- (All). The UI defaults the control to 3 and offers 1/2/3/4/All.
--
-- The return types are unchanged, but adding a parameter changes each function's
-- signature, so the old versions must be dropped first.

-- ---------------------------------------------------------------------------
-- explore_courses  (+ p_credits)
-- ---------------------------------------------------------------------------
drop function if exists explore_courses(text, text, text, text, int, numeric, text, text, int, int);

create or replace function explore_courses(
  p_term         text,
  p_college      text default null,
  p_department   text default null,
  p_core         text default null,
  p_min_reviews  int default 0,
  p_max_workload numeric default null,
  p_credits      int default null,
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
  ),
  course_instructors as (
    select distinct s.course_code, si.instructor_id
    from sections s
    join section_instructors si on si.section_id = s.id
    where s.term = p_term and s.credits <> 0
  ),
  -- Tier 1: current instructors' evals for this exact course.
  cur_agg as (
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
  -- Tier 2: all historical evals for this exact course, across all professors.
  all_agg as (
    select
      cr.course_code,
      cr.instructor_overall                     as avg_rating,
      cr.course_intellectually_challenging      as difficulty,
      cr.effort_avg_hours_weekly                as avg_workload,
      cr.evaluation_count                       as review_count
    from course_ratings cr
  ),
  tiered as (
    select
      o.course_code,
      cur.avg_rating          as cur_rating,
      cur.difficulty          as cur_diff,
      cur.avg_workload        as cur_wl,
      coalesce(cur.review_count, 0)   as cur_n,
      all_a.avg_rating        as all_rating,
      all_a.difficulty        as all_diff,
      all_a.avg_workload      as all_wl,
      coalesce(all_a.review_count, 0) as all_n
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
      case
        when t.cur_n >= greatest(p_min_reviews, 1) then t.cur_rating
        else t.all_rating
      end as avg_rating,
      case
        when t.cur_n >= greatest(p_min_reviews, 1) then t.cur_diff
        else t.all_diff
      end as difficulty,
      case
        when t.cur_n >= greatest(p_min_reviews, 1) then t.cur_wl
        else t.all_wl
      end as avg_workload,
      case
        when t.cur_n >= greatest(p_min_reviews, 1) then t.cur_n
        when t.all_n >= greatest(p_min_reviews, 1) then t.all_n
        else greatest(t.cur_n, t.all_n)
      end as review_count
    from tiered t
  ),
  ranked as (
    select
      c.course_code,
      co.title,
      ch.avg_rating,
      ch.review_count,
      ch.difficulty,
      ch.avg_workload,
      ch.source
    from chosen ch
    join courses co on co.course_code = ch.course_code
    join offered c on c.course_code = ch.course_code
    left join departments d on d.code = co.department_code
    where (p_core is null
           or exists (select 1 from course_core_requirements x
                       where x.course_code = co.course_code and x.core_code = p_core))
      and (p_department is null or d.name = p_department)
      and (p_max_workload is null or ch.avg_workload <= p_max_workload)
      and (p_credits is null or co.credits = p_credits)
    order by
      (case when ch.source = 'limited' then 1 else 0 end) asc,
      (case when p_order = 'asc' then
         case p_sort when 'rating' then ch.avg_rating
                     when 'difficulty' then ch.difficulty
                     when 'workload' then ch.avg_workload end end) asc nulls last,
      (case when p_order <> 'asc' then
         case p_sort when 'rating' then ch.avg_rating
                     when 'difficulty' then ch.difficulty
                     when 'workload' then ch.avg_workload end end) desc nulls last,
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

-- ---------------------------------------------------------------------------
-- rank_classes  (+ p_credits)
-- ---------------------------------------------------------------------------
drop function if exists rank_classes(text, text, int, int, int);

create or replace function rank_classes(
  p_metric    text default 'rating',
  p_order     text default 'desc',
  p_min_evals int  default 5,
  p_credits   int  default null,
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
  where (p_credits is null or c.credits = p_credits)
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
