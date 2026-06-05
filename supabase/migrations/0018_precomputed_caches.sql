-- Database-backed precomputation for rankings + explore.
--
-- The rank_* / explore_courses RPCs previously re-aggregated the full evaluations
-- table (GROUP BYs + percentile_cont for the Bayesian prior) on every request.
-- This migration moves that work into cache tables rebuilt once per sync by
-- refresh_caches(), and rewrites the RPCs as thin reads over those tables. The
-- RPC signatures and return shapes are unchanged, so the controllers/frontend are
-- untouched.
--
-- The Bayesian prior (m = median total responses, C = global mean of the metric)
-- is FROZEN at refresh time over the canonical eligible set (review_count >= 5);
-- the scores are stored. min_evals / credits / student_level are pure row filters
-- over the cache and no longer change scores or the prior.
--   score = (v * R + m * C) / (v + m),  v = total_responses = sum(response_count)
-- Rankings adjust rating/difficulty/workload (reviews & variation sort raw);
-- explore adjusts the rating sort only.

-- ---------------------------------------------------------------------------
-- Bayesian helper
-- ---------------------------------------------------------------------------
create or replace function bayes_score(p_v numeric, p_r numeric, p_m numeric, p_c numeric)
returns numeric
language sql
immutable
as $$
  select case
    when p_r is null then null
    when coalesce(p_v, 0) + coalesce(p_m, 0) = 0 then p_r
    else (coalesce(p_v, 0) * p_r + coalesce(p_m, 0) * p_c) / (coalesce(p_v, 0) + coalesce(p_m, 0))
  end;
$$;

-- ---------------------------------------------------------------------------
-- Cache tables
-- ---------------------------------------------------------------------------
create table if not exists ranking_classes (
  course_code      text primary key,
  title            text,
  department_name  text,
  credits          int,
  student_levels   text[],
  rating           numeric,
  difficulty       numeric,
  workload         numeric,
  review_count     bigint,
  total_responses  bigint,
  variation        numeric,
  bayes_rating     numeric,
  bayes_difficulty numeric,
  bayes_workload   numeric,
  rank             int
);

create table if not exists ranking_professors (
  instructor_id    bigint primary key,
  name             text,
  department_name  text,
  rating           numeric,
  difficulty       numeric,
  workload         numeric,
  review_count     bigint,
  total_responses  bigint,
  variation        numeric,
  bayes_rating     numeric,
  bayes_difficulty numeric,
  bayes_workload   numeric,
  rank             int
);

create table if not exists ranking_departments (
  department_code  text primary key,
  name             text,
  college          text,
  rating           numeric,
  difficulty       numeric,
  workload         numeric,
  review_count     bigint,
  total_responses  bigint,
  variation        numeric,
  bayes_rating     numeric,
  bayes_difficulty numeric,
  bayes_workload   numeric,
  rank             int
);

create table if not exists ranking_schools (
  college          text primary key,
  rating           numeric,
  difficulty       numeric,
  workload         numeric,
  review_count     bigint,
  total_responses  bigint,
  variation        numeric,
  bayes_rating     numeric,
  bayes_difficulty numeric,
  bayes_workload   numeric,
  rank             int
);

create table if not exists explore_course_stats (
  term                   text,
  course_code            text,
  title                  text,
  department_name        text,
  credits                int,
  college_codes          text[],
  student_levels         text[],
  core_requirements      text[],
  cur_rating             numeric,
  cur_difficulty         numeric,
  cur_workload           numeric,
  cur_n                  bigint,
  cur_responses          bigint,
  all_rating             numeric,
  all_difficulty         numeric,
  all_workload           numeric,
  all_n                  bigint,
  all_responses          bigint,
  best_instructor_name   text,
  best_instructor_rating numeric,
  m_prior                numeric,
  c_rating               numeric,
  primary key (term, course_code)
);

-- RLS: public read, consistent with every other table (writes happen via the
-- service-role sync / the security-definer refresh function).
alter table ranking_classes     enable row level security;
alter table ranking_professors  enable row level security;
alter table ranking_departments enable row level security;
alter table ranking_schools     enable row level security;
alter table explore_course_stats enable row level security;

drop policy if exists public_read on ranking_classes;
drop policy if exists public_read on ranking_professors;
drop policy if exists public_read on ranking_departments;
drop policy if exists public_read on ranking_schools;
drop policy if exists public_read on explore_course_stats;
create policy public_read on ranking_classes     for select using (true);
create policy public_read on ranking_professors  for select using (true);
create policy public_read on ranking_departments for select using (true);
create policy public_read on ranking_schools     for select using (true);
create policy public_read on explore_course_stats for select using (true);

-- Indexes for the common filter/sort paths.
create index if not exists idx_ranking_classes_reviews on ranking_classes (review_count);
create index if not exists idx_ranking_classes_credits on ranking_classes (credits);
create index if not exists idx_ranking_classes_levels  on ranking_classes using gin (student_levels);
create index if not exists idx_ranking_professors_reviews  on ranking_professors (review_count);
create index if not exists idx_ranking_departments_reviews on ranking_departments (review_count);
create index if not exists idx_ranking_schools_reviews     on ranking_schools (review_count);

create index if not exists idx_explore_term       on explore_course_stats (term);
create index if not exists idx_explore_term_dept  on explore_course_stats (term, department_name);
create index if not exists idx_explore_term_cred  on explore_course_stats (term, credits);
create index if not exists idx_explore_colleges   on explore_course_stats using gin (college_codes);
create index if not exists idx_explore_levels     on explore_course_stats using gin (student_levels);
create index if not exists idx_explore_cores      on explore_course_stats using gin (core_requirements);

-- ---------------------------------------------------------------------------
-- refresh_caches() -- rebuild every cache from current DB state.
-- Safe to run after either sync (reads current catalog + evaluations).
-- ---------------------------------------------------------------------------
create or replace function refresh_caches()
returns void
language plpgsql
security definer
as $$
declare
  t text;
begin
  -- Classes (no department exclusion -- matches rank_classes) -----------------
  delete from ranking_classes where true;
  insert into ranking_classes
  with agg as (
    select
      e.course_code,
      avg(e.course_overall)                     as rating,
      avg(e.course_intellectually_challenging)  as difficulty,
      avg(e.effort_avg_hours_weekly)            as workload,
      count(*)                                  as review_count,
      sum(e.response_count)                     as total_responses,
      stddev_samp(e.course_overall)             as variation
    from evaluations e
    group by e.course_code
  ),
  stats as (
    select
      (percentile_cont(0.5) within group (order by total_responses))::numeric as m,
      avg(rating)     as c_rating,
      avg(difficulty) as c_diff,
      avg(workload)   as c_wl
    from agg where review_count >= 5
  ),
  scored as (
    select a.*, s.m, s.c_rating, s.c_diff, s.c_wl,
      bayes_score(a.total_responses, a.rating,     s.m, s.c_rating) as br,
      bayes_score(a.total_responses, a.difficulty, s.m, s.c_diff)   as bd,
      bayes_score(a.total_responses, a.workload,   s.m, s.c_wl)     as bw
    from agg a cross join stats s
  )
  select
    sc.course_code, c.title, d.name, c.credits,
    (select array_agg(distinct s2.student_level)
       from sections s2
      where s2.course_code = sc.course_code and s2.credits <> 0
        and s2.student_level is not null),
    sc.rating, sc.difficulty, sc.workload, sc.review_count, sc.total_responses, sc.variation,
    sc.br, sc.bd, sc.bw,
    row_number() over (order by sc.br desc nulls last, sc.review_count desc)
  from scored sc
  join courses c on c.course_code = sc.course_code
  left join departments d on d.code = c.department_code;

  -- Professors ---------------------------------------------------------------
  delete from ranking_professors where true;
  insert into ranking_professors
  with agg as (
    select
      e.instructor_id,
      avg(e.instructor_overall)                 as rating,
      avg(e.course_intellectually_challenging)  as difficulty,
      avg(e.effort_avg_hours_weekly)            as workload,
      count(*)                                  as review_count,
      sum(e.response_count)                     as total_responses,
      stddev_samp(e.instructor_overall)         as variation
    from evaluations e
    join courses c          on c.course_code = e.course_code
    left join departments d on d.code = c.department_code
    where not ranking_excluded_dept_name(d.name)
    group by e.instructor_id
  ),
  stats as (
    select
      (percentile_cont(0.5) within group (order by total_responses))::numeric as m,
      avg(rating)     as c_rating,
      avg(difficulty) as c_diff,
      avg(workload)   as c_wl
    from agg where review_count >= 5
  ),
  scored as (
    select a.*, s.m, s.c_rating, s.c_diff, s.c_wl,
      bayes_score(a.total_responses, a.rating,     s.m, s.c_rating) as br,
      bayes_score(a.total_responses, a.difficulty, s.m, s.c_diff)   as bd,
      bayes_score(a.total_responses, a.workload,   s.m, s.c_wl)     as bw
    from agg a cross join stats s
  ),
  prof_dept as (
    -- most-evaluated department per instructor, computed set-based (one pass)
    select distinct on (instructor_id) instructor_id, name as department_name
    from (
      select e.instructor_id, d.name, count(*) as c
      from evaluations e
      join courses c2    on c2.course_code = e.course_code
      join departments d on d.code = c2.department_code
      where d.name is not null and not ranking_excluded_dept_name(d.name)
      group by e.instructor_id, d.name
    ) z
    order by instructor_id, c desc, name
  )
  select
    sc.instructor_id, i.canonical_name, pd.department_name,
    sc.rating, sc.difficulty, sc.workload, sc.review_count, sc.total_responses, sc.variation,
    sc.br, sc.bd, sc.bw,
    row_number() over (order by sc.br desc nulls last, sc.review_count desc)
  from scored sc
  join instructors i on i.id = sc.instructor_id
  left join prof_dept pd on pd.instructor_id = sc.instructor_id;

  -- Departments --------------------------------------------------------------
  delete from ranking_departments where true;
  insert into ranking_departments
  with agg as (
    select
      min(d.code) as department_code,
      d.name      as name,
      d.college   as college,
      avg(e.course_overall)                     as rating,
      avg(e.course_intellectually_challenging)  as difficulty,
      avg(e.effort_avg_hours_weekly)            as workload,
      count(*)                                  as review_count,
      sum(e.response_count)                     as total_responses,
      stddev_samp(e.course_overall)             as variation
    from evaluations e
    join courses c     on c.course_code = e.course_code
    join departments d on d.code = c.department_code
    where not ranking_excluded_dept_name(d.name)
    group by d.name, d.college
  ),
  stats as (
    select
      (percentile_cont(0.5) within group (order by total_responses))::numeric as m,
      avg(rating)     as c_rating,
      avg(difficulty) as c_diff,
      avg(workload)   as c_wl
    from agg where review_count >= 5
  ),
  scored as (
    select a.*, s.m, s.c_rating, s.c_diff, s.c_wl,
      bayes_score(a.total_responses, a.rating,     s.m, s.c_rating) as br,
      bayes_score(a.total_responses, a.difficulty, s.m, s.c_diff)   as bd,
      bayes_score(a.total_responses, a.workload,   s.m, s.c_wl)     as bw
    from agg a cross join stats s
  )
  select
    sc.department_code, sc.name, sc.college,
    sc.rating, sc.difficulty, sc.workload, sc.review_count, sc.total_responses, sc.variation,
    sc.br, sc.bd, sc.bw,
    row_number() over (order by sc.br desc nulls last, sc.review_count desc)
  from scored sc;

  -- Schools ------------------------------------------------------------------
  delete from ranking_schools where true;
  insert into ranking_schools
  with agg as (
    select
      d.college as college,
      avg(e.course_overall)                     as rating,
      avg(e.course_intellectually_challenging)  as difficulty,
      avg(e.effort_avg_hours_weekly)            as workload,
      count(*)                                  as review_count,
      sum(e.response_count)                     as total_responses,
      stddev_samp(e.course_overall)             as variation
    from evaluations e
    join courses c     on c.course_code = e.course_code
    join departments d on d.code = c.department_code
    where d.college is not null
      and not ranking_excluded_dept_name(d.name)
    group by d.college
  ),
  stats as (
    select
      (percentile_cont(0.5) within group (order by total_responses))::numeric as m,
      avg(rating)     as c_rating,
      avg(difficulty) as c_diff,
      avg(workload)   as c_wl
    from agg where review_count >= 5
  ),
  scored as (
    select a.*, s.m, s.c_rating, s.c_diff, s.c_wl,
      bayes_score(a.total_responses, a.rating,     s.m, s.c_rating) as br,
      bayes_score(a.total_responses, a.difficulty, s.m, s.c_diff)   as bd,
      bayes_score(a.total_responses, a.workload,   s.m, s.c_wl)     as bw
    from agg a cross join stats s
  )
  select
    sc.college,
    sc.rating, sc.difficulty, sc.workload, sc.review_count, sc.total_responses, sc.variation,
    sc.br, sc.bd, sc.bw,
    row_number() over (order by sc.br desc nulls last, sc.review_count desc)
  from scored sc;

  -- Explore (per term) -------------------------------------------------------
  delete from explore_course_stats where true;
  for t in select distinct term from sections where credits <> 0 loop
    insert into explore_course_stats
    with offered as (
      select distinct s.course_code
      from sections s
      where s.term = t and s.credits <> 0
    ),
    course_instructors as (
      select distinct s.course_code, si.instructor_id
      from sections s
      join section_instructors si on si.section_id = s.id
      where s.term = t and s.credits <> 0
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
        cr.instructor_overall                as avg_rating,
        cr.course_intellectually_challenging as difficulty,
        cr.effort_avg_hours_weekly           as avg_workload,
        cr.evaluation_count                  as review_count,
        cr.total_responses                   as responses
      from course_ratings cr
    ),
    base as (
      select
        o.course_code,
        cur.avg_rating cur_rating, cur.difficulty cur_diff, cur.avg_workload cur_wl,
        coalesce(cur.review_count, 0) cur_n, coalesce(cur.responses, 0) cur_resp,
        all_a.avg_rating all_rating, all_a.difficulty all_diff, all_a.avg_workload all_wl,
        coalesce(all_a.review_count, 0) all_n, coalesce(all_a.responses, 0) all_resp
      from offered o
      left join cur_agg cur   on cur.course_code = o.course_code
      left join all_agg all_a on all_a.course_code = o.course_code
    ),
    chosen as (
      -- tier chosen at the default min_reviews (3) -- used only for the prior
      select b.*,
        case when b.cur_n >= greatest(3, 1) then b.cur_rating else b.all_rating end as ch_rating,
        case when b.cur_n >= greatest(3, 1) then b.cur_resp   else b.all_resp   end as ch_resp
      from base b
    ),
    stats as (
      select
        (percentile_cont(0.5) within group (order by ch_resp))::numeric as m_prior,
        avg(ch_rating) as c_rating
      from chosen
    ),
    sec_facets as (
      -- college + student-level sets per course, one grouped pass
      select s.course_code,
        array_agg(distinct s.college) filter (where s.college is not null)             as college_codes,
        array_agg(distinct s.student_level) filter (where s.student_level is not null) as student_levels
      from sections s
      where s.term = t and s.credits <> 0
      group by s.course_code
    ),
    cores as (
      select ccr.course_code, array_agg(ccr.core_code order by ccr.core_code) as core_requirements
      from course_core_requirements ccr
      group by ccr.course_code
    ),
    best as (
      -- highest-rated current instructor per course, one pass
      select distinct on (s.course_code) s.course_code, i.canonical_name, ir.instructor_overall
      from sections s
      join section_instructors si on si.section_id = s.id
      join instructors i on i.id = si.instructor_id
      left join instructor_ratings ir on ir.instructor_id = i.id
      where s.term = t and s.credits <> 0
      order by s.course_code, ir.instructor_overall desc nulls last, i.canonical_name
    )
    select
      t, ch.course_code, co.title, d.name, co.credits,
      sf.college_codes, sf.student_levels, cr.core_requirements,
      ch.cur_rating, ch.cur_diff, ch.cur_wl, ch.cur_n, ch.cur_resp,
      ch.all_rating, ch.all_diff, ch.all_wl, ch.all_n, ch.all_resp,
      b.canonical_name, b.instructor_overall,
      st.m_prior, st.c_rating
    from chosen ch
    cross join stats st
    join courses co on co.course_code = ch.course_code
    left join departments d on d.code = co.department_code
    left join sec_facets sf on sf.course_code = ch.course_code
    left join cores cr      on cr.course_code = ch.course_code
    left join best b        on b.course_code = ch.course_code;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Thin RPCs reading the caches (signatures + return shapes unchanged)
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
  select
    rc.course_code, rc.title, rc.department_name,
    rc.rating, rc.difficulty, rc.workload, rc.review_count, rc.variation
  from ranking_classes rc
  where rc.review_count >= p_min_evals
    and (p_credits is null or rc.credits = p_credits)
    and (p_student_level is null
         or p_student_level = any(rc.student_levels)
         or 'Both' = any(rc.student_levels))
  order by
    (case when p_order = 'asc' then
       case p_metric when 'rating' then rc.bayes_rating when 'difficulty' then rc.bayes_difficulty
         when 'workload' then rc.bayes_workload when 'reviews' then rc.review_count::numeric
         when 'variation' then rc.variation end end) asc nulls last,
    (case when p_order <> 'asc' then
       case p_metric when 'rating' then rc.bayes_rating when 'difficulty' then rc.bayes_difficulty
         when 'workload' then rc.bayes_workload when 'reviews' then rc.review_count::numeric
         when 'variation' then rc.variation end end) desc nulls last,
    rc.review_count desc
  limit p_limit offset p_offset;
$$;

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
  select
    rp.instructor_id, rp.name, rp.department_name,
    rp.rating, rp.difficulty, rp.workload, rp.review_count, rp.variation
  from ranking_professors rp
  where rp.review_count >= p_min_evals
  order by
    (case when p_order = 'asc' then
       case p_metric when 'rating' then rp.bayes_rating when 'difficulty' then rp.bayes_difficulty
         when 'workload' then rp.bayes_workload when 'reviews' then rp.review_count::numeric
         when 'variation' then rp.variation end end) asc nulls last,
    (case when p_order <> 'asc' then
       case p_metric when 'rating' then rp.bayes_rating when 'difficulty' then rp.bayes_difficulty
         when 'workload' then rp.bayes_workload when 'reviews' then rp.review_count::numeric
         when 'variation' then rp.variation end end) desc nulls last,
    rp.review_count desc
  limit p_limit offset p_offset;
$$;

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
  select
    rd.department_code, rd.name, rd.college,
    rd.rating, rd.difficulty, rd.workload, rd.review_count, rd.variation
  from ranking_departments rd
  where rd.review_count >= p_min_evals
  order by
    (case when p_order = 'asc' then
       case p_metric when 'rating' then rd.bayes_rating when 'difficulty' then rd.bayes_difficulty
         when 'workload' then rd.bayes_workload when 'reviews' then rd.review_count::numeric
         when 'variation' then rd.variation end end) asc nulls last,
    (case when p_order <> 'asc' then
       case p_metric when 'rating' then rd.bayes_rating when 'difficulty' then rd.bayes_difficulty
         when 'workload' then rd.bayes_workload when 'reviews' then rd.review_count::numeric
         when 'variation' then rd.variation end end) desc nulls last,
    rd.review_count desc
  limit p_limit offset p_offset;
$$;

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
  select
    rs.college,
    rs.rating, rs.difficulty, rs.workload, rs.review_count, rs.variation
  from ranking_schools rs
  where rs.review_count >= p_min_evals
  order by
    (case when p_order = 'asc' then
       case p_metric when 'rating' then rs.bayes_rating when 'difficulty' then rs.bayes_difficulty
         when 'workload' then rs.bayes_workload when 'reviews' then rs.review_count::numeric
         when 'variation' then rs.variation end end) asc nulls last,
    (case when p_order <> 'asc' then
       case p_metric when 'rating' then rs.bayes_rating when 'difficulty' then rs.bayes_difficulty
         when 'workload' then rs.bayes_workload when 'reviews' then rs.review_count::numeric
         when 'variation' then rs.variation end end) desc nulls last,
    rs.review_count desc
  limit p_limit offset p_offset;
$$;

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
      and (p_core is null or p_core = any(ecs.core_requirements))
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

-- Populate immediately so the cache is live before the next sync.
select refresh_caches();
