-- Lets a campaign map be a different size than the DM Map tab's old
-- fixed 20x20 grid (see dm.html's "Import Generated Layout" and chat:
-- "Allow full-size generator maps into DM maps — player side should
-- still only ever show a 20x20 grid, no scrolling").
--
-- Every existing map gets the default 20/20 below, matching the exact
-- size it's always implicitly been — nothing changes for a campaign
-- that never imports a bigger generated layout.
--
-- Read by:
--   - dm.html's selectMap() (sets MAP_COLS/MAP_ROWS from these, rebuilds
--     the DM's own grid if they differ from what's currently built) and
--     importMapLayout()/saveMapGrid() (writes them back on
--     resize/import).
--   - index.html's refreshMapView() (sets mapViewTotalCols/Rows — the
--     player's own visible grid stays a fixed 20x20 window that
--     auto-centers on the party via mapViewRecomputeOffset() once the
--     real map is bigger than that).
--
-- Draft for you to read and run yourself in the Supabase dashboard's SQL
-- editor, same as every other migration in this folder. Nothing has been
-- run against the live database.

alter table campaign_maps
    add column if not exists cols integer not null default 20,
    add column if not exists rows integer not null default 20;
