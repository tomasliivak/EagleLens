-- Enforce the review form's 20-500 character comment rule at the DB level
-- (not just client-side), since reviews are inserted directly from the
-- frontend via Supabase (no Express backend in the write path).
alter table reviews drop constraint reviews_comment_check;
alter table reviews add constraint reviews_comment_check
  check (char_length(trim(comment)) between 20 and 500);
