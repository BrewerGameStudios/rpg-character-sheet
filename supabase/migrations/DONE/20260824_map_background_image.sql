-- A custom background image the DM can drop underneath the grid — a real
-- photo/scan/screenshot of a map they already have, from anywhere, lined
-- up by eye with zoom/rotate/flip/drag rather than needing to redraw
-- anything as terrain.
--
-- Stored as a data URI (background_image, plain text — genuinely can run
-- into the low megabytes for a real photo) rather than real file storage.
-- Same pattern this app already uses for character portraits
-- (data.portrait in getCharacterData()); simplest given this project's
-- current scale (see rpg-character-sheet-repos memory) — no Storage
-- bucket, no upload endpoint, no separate access policy to get right.
--
-- background_transform is the DM's zoom/position/rotation/flip, kept
-- separate from the image bytes themselves so adjusting it doesn't need
-- to re-send the image on every drag/slider tick (see
-- scheduleMapBackgroundSave() in dm.html, which saves both together in
-- one update either way, but keeping them as two columns rather than one
-- blob keeps the shape honest — one's binary-ish data, one's a handful
-- of numbers).
-- { scale, offsetX, offsetY (px, drag-to-position), rotation (deg), flipX }
--
-- DM-only for now — not read by index.html's player-side map view at all.
--
-- Draft for you to read and run yourself in the Supabase dashboard's SQL
-- editor, same as every other migration in this folder. Nothing has been
-- run against the live database.

alter table campaign_maps
    add column if not exists background_image text,
    add column if not exists background_transform jsonb not null default '{}'::jsonb;
