-- Reputation Ledger (see dm.html's "Reputation" button on the Story
-- tab's toolbar, next to Planned Loot — same one-jsonb-array-per-
-- campaign pattern as planned_loot/story_notes).
--
-- Each entry: { type: 'faction'|'npc', name, score, standing, notes,
-- revealed }. Score and standing are each independently optional (a DM
-- can use a numeric score, a qualitative label like "Friendly", or
-- both on the same entry) — see chat: a vendor's reputation "could be
-- numerical, but also qualitative". `revealed` gates whether an entry
-- shows up on a player's own read-only copy (index.html) — same
-- DM-decides-when-the-party-knows pattern as token identity/chest
-- contents elsewhere in this app.
--
-- Draft for you to read and run yourself in the Supabase dashboard's SQL
-- editor, same as every other migration in this folder. Nothing has been
-- run against the live database.

alter table campaigns
    add column if not exists reputation_ledger jsonb not null default '[]'::jsonb;
