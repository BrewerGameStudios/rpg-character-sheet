-- Vendor kind (2026-09-12, "lets work on building shop keeps/vendors in
-- our creatures tab")
--
-- monsters_npcs.kind was created with a CHECK limited to 'Monster'/'NPC'
-- (see 20260819_monsters_npcs.sql) — this widens it to also allow
-- 'Vendor', a third Kind in the same Creatures Library/same editor, now
-- carrying a Shop Inventory (stat_block.vendorInventory, an array of
-- {name, price, qty, description}) instead of the usual reason to have
-- combat stats. No new column needed — vendorInventory just lives
-- inside the existing stat_block jsonb, same as every other field there.
--
-- Same deal as every other file in this folder: a draft for you to read
-- and run yourself in the Supabase dashboard's SQL editor. Nothing has
-- been run against the live database yet.
--
-- The constraint name here (monsters_npcs_kind_check) is Postgres's own
-- default name for an unnamed inline CHECK on the "kind" column of
-- "monsters_npcs" — if this errors with "constraint does not exist",
-- check the Table Editor's constraint list for the real name and swap
-- it in below; IF EXISTS on the drop means this is safe to try as-is.

alter table monsters_npcs drop constraint if exists monsters_npcs_kind_check;

alter table monsters_npcs
    add constraint monsters_npcs_kind_check check (kind in ('Monster', 'NPC', 'Vendor'));
