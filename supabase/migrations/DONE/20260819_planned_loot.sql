-- DM Tools: Planned Loot (lives on the Story tab)
--
-- One jsonb array per campaign — a DM's prep list of treasure/items they
-- intend to hand out, each entry shaped like
-- { name, worth, description, notes, given, source }. "source" is the
-- monster/NPC name when an entry was pushed over from that editor's
-- Carrying fields (Money/Weapons/Items), blank for anything typed directly
-- into the list. Not a record of what players actually have (that's each
-- player's own Storage tab on their character sheet) — purely DM-side
-- planning, same spirit as Story Notes right above it on that tab.
-- Draft for you to read and run yourself in the Supabase dashboard's SQL
-- editor, same as the other migrations in this folder.

alter table campaigns add column if not exists planned_loot jsonb not null default '[]'::jsonb;
