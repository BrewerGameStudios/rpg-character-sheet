-- Timers and Travel (see dm.html's "Timers" button on the Story tab's
-- toolbar, next to Calendar -- same one-jsonb-column-per-campaign pattern as
-- reputation_ledger/initiative_roster).
--
-- One object per campaign:
--   {
--     "clock": 0,                       -- game seconds passed since the DM last reset it
--     "items": [ { "id", "name", "total", "left", "paused" } ],   -- countdown timers, all in game seconds
--     "travel": { "pace": "slow"|"normal"|"fast", "party": 4, "food": 0, "water": 0,
--                 "goal": 0, "traveled": 0, "days": 0 }           -- food in person-days, water in gallons, distances in miles
--   }
-- Game time, not real time: nothing ticks by itself. The DM presses "Pass time"
-- (or a Travel button) and every running timer counts down by that much.
-- DM-only for now; players never read this column.
--
-- Draft for you to read and run yourself in the Supabase dashboard's SQL
-- editor, same as every other migration in this folder. Nothing has been
-- run against the live database.

alter table campaigns
    add column if not exists timers jsonb not null default '{}'::jsonb;
