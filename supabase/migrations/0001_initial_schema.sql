-- PlanUrBC initial schema
--
-- Two data sources, stitched on (course_code, canonical instructor name):
--   * BC course feed (live catalog)      -> departments, core_requirements,
--                                           courses, sections, section_instructors
--   * Avalanche evaluations (historical) -> evaluations (+ rating views)
--
-- instructors and courses are the UNION of both feeds, since a course may be
-- evaluated but not currently offered, or offered but never evaluated.

create extension if not exists pg_trgm;

-- ---------------------------------------------------------------------------
-- Reference / catalog (BC feed)
-- ---------------------------------------------------------------------------

create table departments (
  code    text primary key,            -- raw.dept_code,  e.g. "SOCY"
  name    text,                         -- raw.dept_name
  college text                          -- raw.college
);

create table core_requirements (
  code text primary key,                -- entry from raw.core_list
  name text                             -- nullable; BC only provides codes
);

create table instructors (
  id             bigint generated always as identity primary key,
  canonical_name text not null unique   -- standardizeInstructorName -> "First Last"
);

create table courses (
  course_code     text primary key,                       -- "SOCY1001"
  department_code text references departments (code),      -- nullable (Avalanche-only courses)
  title           text,
  description     text,
  credits         integer
);

create table course_core_requirements (
  course_code text not null references courses (course_code) on delete cascade,
  core_code   text not null references core_requirements (code) on delete cascade,
  primary key (course_code, core_code)
);

create table sections (
  id                bigint generated always as identity primary key,
  external_id       text not null,                         -- raw.course_id
  term              text not null,
  course_code       text not null references courses (course_code),
  section_number    text,
  meeting_text      text,
  credits           integer,
  college           text,
  student_level     text,
  prerequisite_text text,
  is_selectable     boolean not null default false,
  unique (external_id, term)
);

create table section_instructors (
  section_id    bigint not null references sections (id) on delete cascade,
  instructor_id bigint not null references instructors (id),
  primary key (section_id, instructor_id)
);

-- ---------------------------------------------------------------------------
-- Evaluations (Avalanche): summary + drilldown merged, one row per
-- course x instructor x semester. Drilldown columns are populated by the
-- full backfill of the drilldown endpoint.
-- ---------------------------------------------------------------------------

create table evaluations (
  id                bigint generated always as identity primary key,
  full_course_code  text not null,                          -- "SOCY100101"
  course_code       text not null references courses (course_code),
  section_number    text,
  instructor_id     bigint not null references instructors (id),
  semester          text not null,

  course_name       text,                                   -- Avalanche's label
  modality          text,
  response_count    integer,                                -- weighting (nullable)

  instructor_overall numeric,
  course_overall     numeric,

  -- drilldown side metrics (nullable until backfilled)
  course_well_organized             numeric,
  course_intellectually_challenging numeric,
  effort_avg_hours_weekly           numeric,
  attendance_necessary              numeric,
  assignments_helpful               numeric,
  instructor_prepared               numeric,
  instructor_clear_explanations     numeric,
  available_for_help_outside_class  numeric,
  stimulated_interest               numeric,

  raw_row jsonb,                                            -- full Avalanche row

  unique (full_course_code, instructor_id, semester)
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

create index courses_title_trgm    on courses using gin (title gin_trgm_ops);
create index courses_code_trgm     on courses using gin (course_code gin_trgm_ops);
create index courses_department    on courses (department_code);
create index instructors_name_trgm on instructors using gin (canonical_name gin_trgm_ops);

create index sections_course_code        on sections (course_code);
create index sections_term               on sections (term);
create index section_instructors_inst    on section_instructors (instructor_id);

create index evaluations_course_code  on evaluations (course_code);
create index evaluations_instructor   on evaluations (instructor_id);

-- ---------------------------------------------------------------------------
-- Row level security: public read everywhere; writes only via service role.
-- ---------------------------------------------------------------------------

alter table departments             enable row level security;
alter table core_requirements       enable row level security;
alter table instructors             enable row level security;
alter table courses                 enable row level security;
alter table course_core_requirements enable row level security;
alter table sections                enable row level security;
alter table section_instructors     enable row level security;
alter table evaluations             enable row level security;

create policy "public read" on departments             for select using (true);
create policy "public read" on core_requirements       for select using (true);
create policy "public read" on instructors             for select using (true);
create policy "public read" on courses                 for select using (true);
create policy "public read" on course_core_requirements for select using (true);
create policy "public read" on sections                for select using (true);
create policy "public read" on section_instructors     for select using (true);
create policy "public read" on evaluations             for select using (true);

-- ---------------------------------------------------------------------------
-- Rating views (security_invoker so they respect the underlying RLS).
--   instructor_ratings        -> a professor's global average across all classes
--   instructor_course_ratings -> a professor's ratings for one specific class
--   course_ratings            -> a class overall, across all professors
-- avg() ignores nulls, so partially-backfilled side metrics still aggregate.
-- ---------------------------------------------------------------------------

create view instructor_ratings with (security_invoker = on) as
select
  instructor_id,
  count(*)               as evaluation_count,
  sum(response_count)    as total_responses,
  avg(instructor_overall) as instructor_overall
from evaluations
group by instructor_id;

create view instructor_course_ratings with (security_invoker = on) as
select
  course_code,
  instructor_id,
  count(*)                as evaluation_count,
  sum(response_count)     as total_responses,
  avg(instructor_overall) as instructor_overall,
  avg(course_overall)     as course_overall,
  avg(course_well_organized)             as course_well_organized,
  avg(course_intellectually_challenging) as course_intellectually_challenging,
  avg(effort_avg_hours_weekly)           as effort_avg_hours_weekly,
  avg(attendance_necessary)              as attendance_necessary,
  avg(assignments_helpful)               as assignments_helpful,
  avg(instructor_prepared)               as instructor_prepared,
  avg(instructor_clear_explanations)     as instructor_clear_explanations,
  avg(available_for_help_outside_class)  as available_for_help_outside_class,
  avg(stimulated_interest)               as stimulated_interest
from evaluations
group by course_code, instructor_id;

create view course_ratings with (security_invoker = on) as
select
  course_code,
  count(*)                as evaluation_count,
  sum(response_count)     as total_responses,
  avg(course_overall)     as course_overall,
  avg(instructor_overall) as instructor_overall,
  avg(course_well_organized)             as course_well_organized,
  avg(course_intellectually_challenging) as course_intellectually_challenging,
  avg(effort_avg_hours_weekly)           as effort_avg_hours_weekly,
  avg(attendance_necessary)              as attendance_necessary,
  avg(assignments_helpful)               as assignments_helpful,
  avg(instructor_prepared)               as instructor_prepared,
  avg(instructor_clear_explanations)     as instructor_clear_explanations,
  avg(available_for_help_outside_class)  as available_for_help_outside_class,
  avg(stimulated_interest)               as stimulated_interest
from evaluations
group by course_code;
