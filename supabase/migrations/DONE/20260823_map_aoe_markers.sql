-- AOE markers — a labeled circle of a given radius the DM drops on the
-- map (a fireball's blast, a hazard zone, anything that needs to show
-- "this area is affected" without being a real token or terrain).
--
-- One jsonb array per map, alongside grid_data — saved in the same
-- debounced update as the grid layout rather than a second table, since
-- these change about as often as terrain does, nothing like the
-- every-move frequency that earned tokens their own table.
-- [{ id, cell (center), radiusFeet, label }]
--
-- Spawn markers need no schema at all — placing one just runs the
-- existing line-of-sight reveal (see revealFromCell) around a 30 ft
-- radius and leaves nothing behind, per direct request ("nothing needs
-- to be visible for the spawn, just an auto fog clear").
--
-- Draft for you to read and run yourself in the Supabase dashboard's SQL
-- editor, same as every other migration in this folder. Nothing has been
-- run against the live database.

alter table campaign_maps
    add column if not exists aoe_markers jsonb not null default '[]'::jsonb;
