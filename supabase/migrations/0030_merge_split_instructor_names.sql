-- A parser bug glued BC's suffix field onto the first name, so
-- "Vicini, Andrea, SJ" became the instructor "Andrea, Vicini" instead of
-- "Andrea Vicini". Because the two feeds are stitched on canonical name, those
-- professors ended up as two rows: the comma row (from the BC catalog) held the
-- sections, its comma-free twin (from Avalanche) held the evaluations. The
-- parser is fixed in backend/src/lib/instructorName.ts; this merges the rows it
-- already created. Instructors are never pruned by the sync, so they'd persist.

-- 1. Reviews first: reviews_instructor_id_fkey is ON DELETE CASCADE, so deleting
--    an instructor below would silently take student reviews with it. Drop only
--    rows that would collide on (user_id, course_code, instructor_id); rmp rows
--    have a null user_id, which the unique constraint doesn't cover.
delete from reviews r
using instructors d
where r.instructor_id = d.id
  and d.canonical_name like '%,%'
  and r.user_id is not null
  and exists (
    select 1
    from reviews r2
    join instructors c on c.id = r2.instructor_id
    where c.canonical_name = replace(d.canonical_name, ',', '')
      and r2.user_id = r.user_id
      and r2.course_code = r.course_code
  );

update reviews r
set instructor_id = c.id
from instructors d
join instructors c on c.canonical_name = replace(d.canonical_name, ',', '')
where r.instructor_id = d.id
  and d.canonical_name like '%,%';

-- 2. Section links: move them onto the twin, skipping any the twin already has
--    (section_instructors is keyed on (section_id, instructor_id)).
update section_instructors si
set instructor_id = c.id
from instructors d
join instructors c on c.canonical_name = replace(d.canonical_name, ',', '')
where si.instructor_id = d.id
  and d.canonical_name like '%,%'
  and not exists (
    select 1 from section_instructors x
    where x.section_id = si.section_id and x.instructor_id = c.id
  );

delete from section_instructors si
using instructors d
where si.instructor_id = d.id
  and d.canonical_name like '%,%'
  and exists (
    select 1 from instructors c
    where c.canonical_name = replace(d.canonical_name, ',', '')
  );

-- 3. The comma rows are now empty; drop the ones that have a twin.
delete from instructors d
where d.canonical_name like '%,%'
  and exists (
    select 1 from instructors c
    where c.canonical_name = replace(d.canonical_name, ',', '')
  );

-- 4. The rest were never seen by Avalanche, so there is nothing to merge them
--    with - just repair the name in place.
update instructors
set canonical_name = replace(canonical_name, ',', '')
where canonical_name like '%,%';
