-- Adds facing to map_tokens — which of 8 compass directions a token is
-- looking, shown on the map as a small direction cone. Applies to every
-- token kind (player, monster, NPC) the same way.
--
-- A separate migration rather than editing 20260822_campaign_maps.sql
-- directly, since that one's already been run — this just adds the one
-- column to the existing table.
--
-- Draft for you to read and run yourself in the Supabase dashboard's SQL
-- editor, same as every other migration in this folder. Nothing has been
-- run against the live database.

alter table map_tokens
    add column if not exists facing text not null default 'S'
    check (facing in ('N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'));
