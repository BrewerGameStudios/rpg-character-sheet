-- Adds Quantity and Weight to Planned Loot / Loot Awards, so a claimed
-- item lands in a player's inventory with the DM's real numbers instead
-- of the hardcoded "1 / 0 lb" addClaimedItemToContainer() has always
-- fallen back to (see 20260821_loot_awards.sql for the rest of this
-- table's shape). Only meaningful for kind='item' rows — money doesn't
-- have a weight/quantity in this app's model, so these just stay null
-- on kind='money' rows.
--
-- weight is numeric (not integer) so something like a 0.5 lb potion
-- isn't forced to round.
--
-- A separate migration rather than editing 20260821_loot_awards.sql
-- directly, since that one's already been run — this just adds two
-- columns to the existing table.
--
-- Draft for you to read and run yourself in the Supabase dashboard's SQL
-- editor, same as every other migration in this folder. Nothing has been
-- run against the live database.

alter table loot_awards
    add column if not exists qty integer,
    add column if not exists weight numeric;
