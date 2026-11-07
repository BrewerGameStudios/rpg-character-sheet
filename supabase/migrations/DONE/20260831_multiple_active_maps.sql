-- Allows more than one map to be flagged active/wilderness-active at
-- once (2026-08-31, "we need to allow multiple active maps, index needs
-- a drop down... to were they can go back to whatever map thats active,
-- and see whats available") — a DM might want several tactical rooms
-- kept "active" at once (the party split up), or more than one
-- wilderness/overview map (different regions of the world) reachable at
-- the same time.
--
-- Drops the two partial unique indexes from 20260822_campaign_maps.sql
-- and 20260831_wilderness_map.sql that enforced "at most one" for each
-- flag — dm.html's setMapActive()/setMapWildernessActive() no longer
-- unset every other map's flag before setting this one, and index.html
-- now fetches EVERY currently-active map (of either kind) into a picker
-- instead of assuming exactly one exists per kind.
--
-- Draft for you to read and run yourself in the Supabase dashboard's SQL
-- editor, same as every other migration in this folder. Nothing has been
-- run against the live database.

drop index if exists campaign_maps_one_active_idx;
drop index if exists campaign_maps_one_wilderness_active_idx;
