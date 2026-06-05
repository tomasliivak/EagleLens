-- Populate per-evaluation respondent / enrollment counts.
--
-- Avalanche records a "ratio" field on each summary row of the form
-- "[responses/enrolled]" (e.g. "[17/18]"). That's the only place the response
-- count lives, but the sync never parsed it, so evaluations.response_count was
-- null on every row. Going forward the Avalanche service parses `ratio` into
-- responseCount / enrolledCount; this migration adds the enrolled_count column
-- and backfills both columns from the raw_row already stored on each row (no
-- re-scrape needed).

alter table evaluations add column if not exists enrolled_count integer;

update evaluations
set response_count = (regexp_match(raw_row->'summary'->>'ratio', '(\d+)\s*/\s*(\d+)'))[1]::int,
    enrolled_count = (regexp_match(raw_row->'summary'->>'ratio', '(\d+)\s*/\s*(\d+)'))[2]::int
where raw_row->'summary'->>'ratio' ~ '\d+\s*/\s*\d+';
