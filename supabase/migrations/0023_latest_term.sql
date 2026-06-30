-- Chronological ordering for section terms.
-- sections.term codes look like "2026FALL" / "2026SUMM" / "2026SPRG". A plain
-- text sort is alphabetical (FALL < SPRG < SUMM), which is NOT the calendar
-- order (Spring -> Summer -> Fall). term_sort_key turns a term into a sortable
-- integer (year * 10 + season rank) so "latest" means furthest in the future.

create or replace function term_sort_key(term text)
returns int
language sql
immutable
as $$
  select left(term, 4)::int * 10 +
    case substr(term, 5)
      when 'SPRG' then 1
      when 'SUMM' then 2
      when 'FALL' then 3
      else 0  -- unknown / intersession codes sort earliest within the year
    end;
$$;

-- Distinct section terms for the Explore semester dropdown, ordered
-- chronologically with the latest first (so terms[0] is the latest term).
drop function if exists list_section_terms();

create function list_section_terms()
returns table (term text)
language sql
stable
as $$
  select t.term
  from (select distinct s.term from sections s) t
  order by term_sort_key(t.term) desc;
$$;

grant execute on function list_section_terms() to anon, authenticated;

-- The single chronologically-latest term in the catalog. Used as the app-wide
-- default semester so it advances on its own as new terms are synced.
create or replace function latest_section_term()
returns text
language sql
stable
as $$
  select s.term
  from sections s
  order by term_sort_key(s.term) desc
  limit 1;
$$;

grant execute on function latest_section_term() to anon, authenticated;
