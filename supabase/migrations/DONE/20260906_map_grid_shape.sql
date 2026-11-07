-- Adds a per-map grid shape (2026-09-06, "hex grid map option") — each
-- map remembers its own choice, same pattern as cols/rows (see
-- 20260831_map_cols_rows.sql). Every existing map defaults to 'square',
-- its implicit shape up to now, so nothing changes for a campaign that
-- never touches the new Grid Shape select in dm.html.
--
-- Read/written by:
--   - dm.html's selectMap() (sets MAP_GRID_SHAPE, rebuilds the DM's own
--     grid via ensureMapGridBuilt() if it differs from what's built) and
--     saveCurrentMapState()/setMapGridShape() (writes it back).
--   - index.html's player-facing map view does NOT read this yet — v1 is
--     dm.html's own authoring grid only.
--
-- Draft for you to read and run yourself in the Supabase dashboard's SQL
-- editor, same as every other migration in this folder. Nothing has been
-- run against the live database.

alter table campaign_maps
    add column if not exists grid_shape text not null default 'square';
