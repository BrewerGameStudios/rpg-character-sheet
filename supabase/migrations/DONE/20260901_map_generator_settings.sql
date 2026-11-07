-- Lets the DM Map tab remember the seed/mode/settings a map was
-- generated with, so a large hand-edit gone wrong can be reset by
-- reopening the standalone generator (mapgen.html) at the exact same
-- starting point instead of losing it for good (2026-09-01, "For a map
-- imported from the standalone generator, let the DM pull back up the
-- original seed + mode + settings").
--
-- Only ever set by dm.html's importMapLayout() (from the generator's own
-- buildExportJson output) and carried forward untouched by every later
-- save (see saveMapGrid) — null for any map that was never imported, or
-- was built by hand from scratch. dm.html's "🎲 Reopen in Generator"
-- button is disabled whenever this is null.
--
-- Draft for you to read and run yourself in the Supabase dashboard's SQL
-- editor, same as every other migration in this folder. Nothing has been
-- run against the live database.

alter table campaign_maps
    add column if not exists generator_settings jsonb;
