-- Initiative Roster (see dm.html's new "Initiative" view on the Roster
-- tab, next to Cards/Party Overview — same one-jsonb-array-per-campaign
-- pattern as reputation_ledger/planned_loot/story_notes).
--
-- Each entry: { id, name, type: 'player'|'monster'|'npc', initiative,
-- hidden, charKey }. Players and the DM's monsters/NPCs share the same
-- array/table so one combined turn order can be sorted highest-to-lowest
-- across all of them. A 'player' entry is written directly by that
-- player's own sheet (index.html) the moment they roll Initiative in the
-- Dice Roller — charKey (their Character Name) is how a re-roll finds and
-- replaces their own existing entry instead of adding a duplicate every
-- time. 'monster'/'npc' entries are added and rolled by the DM (dm.html).
-- `hidden` gates whether an entry shows up on a player's own read-only
-- copy — same DM-decides-when-the-party-knows pattern reputation_ledger's
-- own `revealed` flag already uses, just inverted (hidden defaults false
-- here since a freshly-rolled entry should be visible unless the DM
-- deliberately hides it, the opposite of Reputation's "secret until
-- revealed" default). Removing an entry (a monster/NPC that died) means
-- actually deleting it from the array — nothing reads a "dead" flag today.
--
-- Draft for you to read and run yourself in the Supabase dashboard's SQL
-- editor, same as every other migration in this folder. Nothing has been
-- run against the live database.

alter table campaigns
    add column if not exists initiative_roster jsonb not null default '[]'::jsonb;
