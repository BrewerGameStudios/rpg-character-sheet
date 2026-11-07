-- Quest Log and Clocks (see dm.html's "Quests" button on the Story tab's
-- toolbar, next to Reputation -- same one-jsonb-column-per-campaign pattern
-- as reputation_ledger/timers).
--
-- One object per campaign:
--   {
--     "quests": [ { "id", "title", "status": "active"|"completed"|"failed"|"hold",
--                   "summary", "notes", "shown",
--                   "entries": [ { "kind": "objective"|"clue", "text", "done", "shown" } ] } ],
--     "clocks": [ { "id", "name", "segments", "filled", "shown" } ]
--   }
-- `shown` is the DM-decides-when-the-party-knows flag, the same idea as the
-- Reputation Ledger's `revealed`: a quest, an objective, a clue or a clock only
-- appears on a player's own read-only copy (index.html, Tools > View Quests)
-- once the DM has ticked it. `notes` is the DM's private reasoning and is never
-- shown to players, whatever else is ticked.
--
-- Draft for you to read and run yourself in the Supabase dashboard's SQL
-- editor, same as every other migration in this folder. Nothing has been
-- run against the live database.

alter table campaigns
    add column if not exists quest_log jsonb not null default '{}'::jsonb;
