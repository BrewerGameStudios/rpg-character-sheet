-- Encounter Lists: own table, replaces the campaigns.encounter_lists
-- jsonb column from earlier today (20260912_encounter_lists.sql).
--
-- WHY THE CHANGE: that first cut followed the same one-jsonb-array-per-
-- campaign pattern as Planned Loot/Reputation, which meant an encounter
-- could only be created from inside a specific campaign's Story tab. The
-- Monster Generator's own "+ Add Mob to Library" needed to create an
-- encounter directly, but that page is standalone (like mapgen.html) and
-- has no campaign context at all — no campaign picker, nothing. Rather
-- than bolt one on, this moves Encounter Lists to the same model as the
-- Creatures Library it's built from: owned by the DM directly (dm_email),
-- not tied to any one campaign, so it shows up the same way in every
-- campaign you run and the Generator can write to it with nothing more
-- than the licenseEmail already sitting in localStorage.
--
-- The old campaigns.encounter_lists column is harmless, unused leftover
-- now that dm.html no longer reads or writes it — left in place rather
-- than dropped, since it's zero-cost to leave and dropping a column is
-- the one kind of migration you can't undo by re-running an old file.
--
-- Same deal as every other file in this folder: a draft for you to read
-- and run yourself in the Supabase dashboard's SQL editor. Nothing has
-- been run against the live database yet. Real RLS from the start this
-- time (see the 2026-09-11 library_books/monsters_npcs lockdown for why
-- `using (true)` is never how a new table should start).

create table if not exists encounter_lists (
    id uuid primary key default gen_random_uuid(),
    dm_email text not null,
    name text not null,
    notes text not null default '',
    entries jsonb not null default '[]'::jsonb,   -- [{monsterId, name, kind, qty}, ...]
                                                   -- references into monsters_npcs by id,
                                                   -- with a name/kind snapshot so a later-
                                                   -- deleted creature still shows a readable
                                                   -- row instead of breaking
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists encounter_lists_dm_email_idx on encounter_lists (dm_email);

alter table encounter_lists enable row level security;

create policy "encounter_lists: select own rows only"
    on encounter_lists for select
    using (lower(dm_email) = lower(auth.jwt() ->> 'email'));

create policy "encounter_lists: insert own rows only"
    on encounter_lists for insert
    with check (lower(dm_email) = lower(auth.jwt() ->> 'email'));

create policy "encounter_lists: update own rows only"
    on encounter_lists for update
    using (lower(dm_email) = lower(auth.jwt() ->> 'email'))
    with check (lower(dm_email) = lower(auth.jwt() ->> 'email'));

create policy "encounter_lists: delete own rows only"
    on encounter_lists for delete
    using (lower(dm_email) = lower(auth.jwt() ->> 'email'));
