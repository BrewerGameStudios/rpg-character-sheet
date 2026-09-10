-- Cone markers — a labeled cone-shaped area (Burning Hands, a dragon's
-- breath weapon, anything the rules describe as a cone rather than a
-- circle) anchored at a cell and pointed in one of 8 compass directions.
--
-- Shape follows 5e's own definition (PHB "Areas of Effect: Cone"): "A
-- cone's width at a given point along its length is equal to that
-- point's distance from the point of origin" -- which works out to a
-- ~53.13 degree cone (2 * atan(0.5)), not a plain 90-degree wedge. Same
-- angle Foundry VTT's own dnd5e system defaults to, for what it's worth.
--
-- One jsonb array per map, alongside grid_data/aoe_markers -- same
-- reasoning as aoe_markers: changes about as often as terrain does, so
-- it rides along in the same debounced save rather than a second table.
-- [{ id, cell (origin), direction (N/NE/E/SE/S/SW/W/NW), lengthFeet, label }]
--
-- Direction defaults to whatever token is standing on the origin cell
-- at the moment the cone is placed (its own current facing) -- "make it
-- directional from the position of the player or creature" -- and is
-- freely re-pointable afterward from the cone list, same 8-arrow picker
-- already used for token facing.
--
-- Draft for you to read and run yourself in the Supabase dashboard's SQL
-- editor, same as every other migration in this folder. Nothing has been
-- run against the live database.

alter table campaign_maps
    add column if not exists cone_markers jsonb not null default '[]'::jsonb;
