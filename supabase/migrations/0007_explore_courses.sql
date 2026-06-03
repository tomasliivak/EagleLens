-- Explore page listing: one row per course offered in a term, with
-- per-course aggregates averaged over the distinct instructors teaching it
-- that term (same per-unique-instructor approach as getCourse), the
-- highest-rated current instructor, and the core requirements it fulfills.
-- Optional filters narrow by college, department, core requirement, a minimum
-- review count, and a maximum workload. 0-credit sections are excluded.

drop function if exists explore_courses(text, text, text, text, int, numeric, int);

create function explore_courses(
  p_term         text,
  p_college      text default null,
  p_department   text default null,
  p_core         text default null,
  p_min_reviews  int default 0,
  p_max_workload numeric default null,
  p_limit        int default 100
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
  core_requirements     text[]
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
  agg as (
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
  )
  select
    c.course_code,
    c.title,
    best.canonical_name,
    best.instructor_overall,
    agg.avg_rating,
    coalesce(agg.review_count, 0),
    agg.difficulty,
    agg.avg_workload,
    (select array_agg(ccr.core_code order by ccr.core_code)
       from course_core_requirements ccr
      where ccr.course_code = c.course_code)
  from offered o
  join courses c on c.course_code = o.course_code
  left join agg on agg.course_code = c.course_code
  left join departments d on d.code = c.department_code
  left join lateral (
    select i.canonical_name, ir.instructor_overall
    from sections s
    join section_instructors si on si.section_id = s.id
    join instructors i on i.id = si.instructor_id
    left join instructor_ratings ir on ir.instructor_id = i.id
    where s.course_code = c.course_code and s.term = p_term and s.credits <> 0
    order by ir.instructor_overall desc nulls last, i.canonical_name
    limit 1
  ) best on true
  where (p_core is null
         or exists (select 1 from course_core_requirements x
                     where x.course_code = c.course_code and x.core_code = p_core))
    and (p_department is null or d.name = p_department)
    and (p_min_reviews <= 0 or coalesce(agg.review_count, 0) >= p_min_reviews)
    and (p_max_workload is null or agg.avg_workload <= p_max_workload)
  order by agg.avg_rating desc nulls last, c.course_code
  limit p_limit;
$$;

grant execute on function explore_courses(text, text, text, text, int, numeric, int)
  to anon, authenticated;

-- Distinct section terms for the Explore semester dropdown. (A plain
-- select on sections is capped at PostgREST's row limit and would miss terms.)
drop function if exists list_section_terms();

create function list_section_terms()
returns table (term text)
language sql
stable
as $$
  select distinct s.term from sections s order by s.term;
$$;

grant execute on function list_section_terms() to anon, authenticated;
