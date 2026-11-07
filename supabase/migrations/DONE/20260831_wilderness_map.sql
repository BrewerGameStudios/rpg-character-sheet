-- Lets a DM flag a SECOND map as the campaign's current wilderness/
-- overview map, viewable by players ALONGSIDE (not instead of) whichever
-- map is currently is_active — see chat: "allow the dm to activate a
-- second map, the players can also see this map, so they can decide
-- what direction to go on the overall map, dm can control the marker on
-- whats open."
--
-- Deliberately a separate flag from is_active rather than a third value
-- on some single "map role" column — a campaign can have an active
-- tactical map (the current dungeon room, say) and an active wilderness
-- map (the region it's in) shown at the same time, not one XOR the
-- other. Same "at most one true per campaign" shape as is_active's own
-- partial unique index.
alter table campaign_maps
    add column if not exists is_wilderness_active boolean not null default false;

create unique index if not exists campaign_maps_one_wilderness_active_idx
    on campaign_maps (campaign_id)
    where is_wilderness_active;

-- One new token kind: a single DM-controlled "Party Marker" showing
-- where the group currently stands on the wilderness map — placed and
-- dragged around exactly like a monster/NPC token (dm.html's existing
-- pick-up/move-anywhere flow needs no changes at all for that part),
-- just never tied to a roster/monster-library entry. Players can see it
-- on their own read-only wilderness view, but only the DM moves it.
alter table map_tokens drop constraint if exists map_tokens_kind_check;
alter table map_tokens add constraint map_tokens_kind_check check (kind in ('player', 'monster', 'npc', 'party-marker'));

-- Draft for you to read and run yourself in the Supabase dashboard's SQL
-- editor, same as every other migration in this folder. Nothing has been
-- run against the live database.
