-- Encounter Lists (see dm.html's "Encounters" button on the Story
-- tab's toolbar, next to Planned Loot/Reputation — same one-jsonb-
-- array-per-campaign pattern as planned_loot/reputation_ledger).
--
-- Each entry: { name, notes, entries: [{ monsterId, name, kind, qty }] }.
-- entries[] is a list of references into this DM's own monsters_npcs
-- library (by id), not a copy of the stat block — editing a creature in
-- the Library later keeps every encounter using it current. name/kind
-- are snapshotted alongside the id purely so a later-deleted creature
-- still renders a readable "(deleted)" row instead of breaking.
--
-- No new table and no RLS needed here — this rides on campaigns, whose
-- own RLS already governs who can read/write this row.
--
-- Draft for you to read and run yourself in the Supabase dashboard's SQL
-- editor, same as every other migration in this folder. Nothing has been
-- run against the live database.

alter table campaigns
    add column if not exists encounter_lists jsonb not null default '[]'::jsonb;
