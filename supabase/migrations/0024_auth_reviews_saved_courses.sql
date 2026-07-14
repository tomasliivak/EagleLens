-- User accounts (Supabase Auth, Google OAuth restricted to @bc.edu), user
-- reviews, and saved courses.
--
-- Reviews are publicly readable and anonymous. user_id is nullable because
-- imported RateMyProfessors reviews have no account; those rows are inserted
-- with the service-role key (bypasses RLS) and marked source = 'rmp'.

-- helper: does the current JWT belong to a bc.edu account?
create function public.is_bc_email()
returns boolean language sql stable as $$
  select lower(coalesce(auth.jwt()->>'email', '')) like '%@bc.edu'
$$;

-- block non-BC accounts at signup (raising aborts the auth.users insert)
create function public.enforce_bc_email()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if lower(coalesce(new.email, '')) not like '%@bc.edu' then
    raise exception 'Only @bc.edu accounts may sign in';
  end if;
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.enforce_bc_email();

-- reviews: public read, owner-only writes, one per (user, course, professor)
create table reviews (
  id              bigint generated always as identity primary key,
  user_id         uuid   references auth.users (id) on delete cascade,
  course_code     text   not null references courses (course_code) on delete cascade,
  instructor_id   bigint not null references instructors (id) on delete cascade,
  would_recommend boolean not null,
  comment         text   not null check (char_length(trim(comment)) between 1 and 2000),
  source          text   not null default 'user' check (source in ('user', 'rmp')),
  created_at      timestamptz not null default now(),
  unique (user_id, course_code, instructor_id),
  check (source = 'user' or user_id is null)  -- imported rows never claim an account
);
create index reviews_course_code_idx on reviews (course_code);
create index reviews_instructor_id_idx on reviews (instructor_id);

alter table reviews enable row level security;
create policy "public read" on reviews for select using (true);
create policy "bc insert own" on reviews for insert to authenticated
  with check (user_id = auth.uid() and public.is_bc_email());
create policy "owner update" on reviews for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and public.is_bc_email());
create policy "owner delete" on reviews for delete to authenticated
  using (user_id = auth.uid());

-- saved_courses: fully private to the owner
create table saved_courses (
  user_id     uuid not null references auth.users (id) on delete cascade,
  course_code text not null references courses (course_code) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (user_id, course_code)
);
alter table saved_courses enable row level security;
create policy "owner read" on saved_courses for select to authenticated
  using (user_id = auth.uid());
create policy "bc insert own" on saved_courses for insert to authenticated
  with check (user_id = auth.uid() and public.is_bc_email());
create policy "owner delete" on saved_courses for delete to authenticated
  using (user_id = auth.uid());
