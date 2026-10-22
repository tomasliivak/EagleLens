-- Percentile context for the professor cards on the course page.
--
-- BC evaluation scores cluster near the top of the 1-5 scale, so raw/5 bars all
-- look alike. These caches store each value's relative standing instead; the raw
-- averages are untouched and still what the card displays as numbers/labels.
--
-- Percentile (mid-rank, ties share a value, never exactly 0 or 100):
--   P = 100 * (B + 0.5 * E) / N
--   B = population members strictly below, E = members equal (incl. itself),
--   N = population size. rank() - 1 = B; count(*) over (partition by value) = E.
-- Null values are excluded from the population and get no percentile.
--
-- 1. instructor_course_percentiles: difficulty / workload / attendance of one
--    professor in one course, vs. every professor x course pair in
--    instructor_course_ratings (one row per pair, already averaged across
--    semesters, so repeat semesters/sections don't count twice).
-- 2. instructor_dept_percentiles: a professor's Bayesian-adjusted overall rating
--    (ranking_professors.bayes_rating, built by refresh_caches -- no new formula)
--    vs. the other professors in their department (ranking_professors.department_name,
--    their most-evaluated department). Population = review_count >= 5, the same
--    eligible set the Bayesian prior uses; departments with < 5 such professors
--    get no rows.
--
-- refresh_percentile_caches() reads ranking_professors, so it runs after
-- refresh_caches() (see backend/scripts/syncShared.ts refreshCaches()). Both are
-- called by the sync scripts with the service-role key, so they're executable by
-- service_role only.

-- ---------------------------------------------------------------------------
-- Cache tables
-- ---------------------------------------------------------------------------
create table if not exists public.instructor_course_percentiles (
  course_code    text,
  instructor_id  bigint,
  difficulty_pct numeric,
  workload_pct   numeric,
  attendance_pct numeric,
  primary key (course_code, instructor_id)
);

create table if not exists public.instructor_dept_percentiles (
  instructor_id   bigint primary key,
  department_name text,
  rating_pct      numeric,
  dept_size       int
);

-- RLS: public read, consistent with the other caches. Writes come only from
-- refresh_percentile_caches() run as service_role (bypasses RLS).
alter table public.instructor_course_percentiles enable row level security;
alter table public.instructor_dept_percentiles   enable row level security;

drop policy if exists public_read on public.instructor_course_percentiles;
drop policy if exists public_read on public.instructor_dept_percentiles;
create policy public_read on public.instructor_course_percentiles for select using (true);
create policy public_read on public.instructor_dept_percentiles   for select using (true);

-- The schema's default ACL grants anon/authenticated full table privileges;
-- TRUNCATE isn't covered by RLS, so keep these caches read-only for them.
revoke all on public.instructor_course_percentiles from anon, authenticated;
revoke all on public.instructor_dept_percentiles   from anon, authenticated;
grant select on public.instructor_course_percentiles to anon, authenticated;
grant select on public.instructor_dept_percentiles   to anon, authenticated;

-- ---------------------------------------------------------------------------
-- refresh_percentile_caches() -- rebuild both caches from current DB state.
-- SECURITY INVOKER: the caller (service_role) already has the privileges it
-- needs. One call = one transaction, so a failure leaves the previous rows.
-- ---------------------------------------------------------------------------
create or replace function public.refresh_percentile_caches()
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- Serialize concurrent refreshes (they'd otherwise collide on the PKs);
  -- this mode doesn't block readers.
  lock table public.instructor_course_percentiles, public.instructor_dept_percentiles
    in share row exclusive mode;

  delete from public.instructor_course_percentiles where true;
  insert into public.instructor_course_percentiles
  with pairs as (
    select course_code, instructor_id,
      course_intellectually_challenging as difficulty,
      effort_avg_hours_weekly           as workload,
      attendance_necessary              as attendance
    from public.instructor_course_ratings
  ),
  diff as (
    select course_code, instructor_id,
      100.0 * ((rank() over w - 1) + 0.5 * count(*) over (partition by difficulty))
            / count(*) over () as pct
    from pairs where difficulty is not null
    window w as (order by difficulty)
  ),
  wl as (
    select course_code, instructor_id,
      100.0 * ((rank() over w - 1) + 0.5 * count(*) over (partition by workload))
            / count(*) over () as pct
    from pairs where workload is not null
    window w as (order by workload)
  ),
  att as (
    select course_code, instructor_id,
      100.0 * ((rank() over w - 1) + 0.5 * count(*) over (partition by attendance))
            / count(*) over () as pct
    from pairs where attendance is not null
    window w as (order by attendance)
  )
  select p.course_code, p.instructor_id, d.pct, w.pct, a.pct
  from pairs p
  left join diff d on d.course_code = p.course_code and d.instructor_id = p.instructor_id
  left join wl   w on w.course_code = p.course_code and w.instructor_id = p.instructor_id
  left join att  a on a.course_code = p.course_code and a.instructor_id = p.instructor_id
  where d.pct is not null or w.pct is not null or a.pct is not null;

  delete from public.instructor_dept_percentiles where true;
  insert into public.instructor_dept_percentiles
  with eligible as (
    select instructor_id, department_name, bayes_rating
    from public.ranking_professors
    where review_count >= 5
      and bayes_rating is not null
      and department_name is not null
  ),
  ranked as (
    select instructor_id, department_name,
      100.0 * ((rank() over w - 1)
               + 0.5 * count(*) over (partition by department_name, bayes_rating))
            / count(*) over (partition by department_name) as pct,
      count(*) over (partition by department_name) as dept_size
    from eligible
    window w as (partition by department_name order by bayes_rating)
  )
  select instructor_id, department_name, pct, dept_size
  from ranked
  where dept_size >= 5;
end;
$$;

-- New functions are executable by PUBLIC/anon/authenticated by default.
revoke execute on function public.refresh_percentile_caches() from public, anon, authenticated;
grant execute on function public.refresh_percentile_caches() to service_role;

-- ---------------------------------------------------------------------------
-- Harden the existing refresh_caches() (0018): it's SECURITY DEFINER and was
-- callable by anyone, letting anon trigger full cache rebuilds. Body unchanged;
-- it uses unqualified names, so pin search_path to public (pg_temp last).
-- ---------------------------------------------------------------------------
alter function public.refresh_caches() set search_path = public, pg_temp;
revoke execute on function public.refresh_caches() from public, anon, authenticated;
grant execute on function public.refresh_caches() to service_role;

-- ---------------------------------------------------------------------------
-- get_course_instructors (base: 0006) + percentile columns appended.
-- The return type changes, so it must be dropped and recreated (nothing depends
-- on it). The migration is one transaction, so callers never see it missing.
-- Body, filters, ordering, volatility and the p_term default are as in 0006.
-- ---------------------------------------------------------------------------
drop function if exists public.get_course_instructors(text, text);

create function public.get_course_instructors(
  p_course_code text,
  p_term text default '2026FALL'
)
returns table (
  section_id                 bigint,
  section_number             text,
  meeting_text               text,
  instructor_id              bigint,
  instructor_name            text,
  overall_rating             numeric,
  overall_evaluations        bigint,
  course_rating              numeric,
  course_evaluations         bigint,
  semesters_taught           bigint,
  intellectually_challenging numeric,
  avg_hours_weekly           numeric,
  attendance_necessary       numeric,
  difficulty_pct             numeric,
  workload_pct               numeric,
  attendance_pct             numeric,
  dept_rating_pct            numeric,
  dept_name                  text
)
language sql
stable
as $$
  select
    s.id,
    s.section_number,
    s.meeting_text,
    i.id,
    i.canonical_name,
    ir.instructor_overall,
    ir.evaluation_count,
    icr.instructor_overall,
    icr.evaluation_count,
    (select count(distinct e.semester)
       from evaluations e
      where e.instructor_id = i.id and e.course_code = p_course_code),
    icr.course_intellectually_challenging,
    icr.effort_avg_hours_weekly,
    icr.attendance_necessary,
    icp.difficulty_pct,
    icp.workload_pct,
    icp.attendance_pct,
    idp.rating_pct,
    idp.department_name
  from sections s
  join section_instructors si on si.section_id = s.id
  join instructors i on i.id = si.instructor_id
  left join instructor_ratings ir on ir.instructor_id = i.id
  left join instructor_course_ratings icr
    on icr.instructor_id = i.id and icr.course_code = s.course_code
  left join instructor_course_percentiles icp
    on icp.instructor_id = i.id and icp.course_code = s.course_code
  left join instructor_dept_percentiles idp on idp.instructor_id = i.id
  where s.course_code = p_course_code and s.term = p_term and s.credits <> 0
  order by ir.instructor_overall desc nulls last, s.section_number;
$$;

grant execute on function public.get_course_instructors(text, text) to anon, authenticated, service_role;

-- Initial fill (the migration runs as the owner).
select public.refresh_percentile_caches();
