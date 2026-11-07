-- Digital Library: explicit upload size limit (2026-09-12)
--
-- A draft for you to read and run yourself in the Supabase dashboard's SQL
-- editor. Nothing here has been run against the live database yet.
--
-- CORRECTED same day — the first version of this file set 100 MB, which
-- was pointless: Supabase's Free plan has a hard, ACCOUNT-WIDE 50 MB cap
-- on every single file, and a bucket's own file_size_limit can never
-- exceed that (confirmed against Supabase's own docs — see
-- https://supabase.com/docs/guides/storage/uploads/file-limits). Setting
-- this bucket to 100 MB on Free wouldn't have raised anything; uploads
-- would still fail past 50 MB regardless. This sets the real, honest
-- number for the plan you're actually on.
--
-- If you ever upgrade to Pro ($25/mo+), that account-wide ceiling goes way
-- up (configurable as high as 500 GB) — come back and raise the number
-- below at that point; nothing else about this setup needs to change.

update storage.buckets
set file_size_limit = 50 * 1024 * 1024 -- 50 MB — the real Free-plan ceiling, not a number I chose
where id = 'library-books';

-- ---------- After running this ----------
-- A file over 50 MB now fails upload with a clear "exceeded the maximum
-- allowed size" error (surfaced in the Save status message — see
-- saveLibraryBook in dm.html) instead of a confusing generic failure. A
-- book that's genuinely bigger than that (a large scanned rulebook, e.g.)
-- can still be added with a link (source_url) instead of an uploaded
-- file — it just won't get the cloud/cross-device copy until either the
-- file's made smaller or the project's on Pro.
