-- Custom Potion Book (2026-09-12)
--
-- A draft for you to read and run yourself in the Supabase dashboard's SQL
-- editor. Nothing here has been run against the live database yet.
--
-- "custom potions need to save to our potion book" — a hand-typed potion
-- (the "+ Add Potion" custom maker, unchanged) can now also be pushed to
-- this account's own cloud library via a new "Save to Potion Book" button
-- on each row, so it shows up in the Potion Book's own list — same
-- picker the SRD potions live in — on every character, on every device
-- you're logged into. Same ownership model as character_backups
-- (user_email, matching shared.js's licenseEmail), NOT the dm_email
-- model DM Tools tables use — this is a player-sheet feature.
--
-- RLS is scoped correctly from the START here (lower(user_email) =
-- lower(auth.jwt() ->> 'email')) rather than the "using (true)" every
-- DM Tools table originally shipped with and had to be locked down
-- later — see rpg-character-sheet-rls-lockdown. Same reasoning as that
-- fix: restrictedFeature('Potion Book') (added to shared.js's
-- lockedDuringTrial list) means this is only ever touched by someone
-- with a real, licensed, logged-in session, so real per-account RLS
-- costs nothing in usability and closes the gap before it ever opens.

create table if not exists custom_potions (
    id uuid primary key default gen_random_uuid(),
    user_email text not null,
    name text not null,
    price text not null default '',
    weight numeric not null default 0,
    description text not null default '',
    created_at timestamptz not null default now(),
    unique (user_email, name) -- re-saving the same name updates it in place (see the upsert in saveCustomPotionToBook)
);

create index if not exists custom_potions_user_email_idx on custom_potions (user_email);

alter table custom_potions enable row level security;

create policy "custom_potions: select own rows only"
    on custom_potions for select
    using (lower(user_email) = lower(auth.jwt() ->> 'email'));

create policy "custom_potions: insert own rows only"
    on custom_potions for insert
    with check (lower(user_email) = lower(auth.jwt() ->> 'email'));

create policy "custom_potions: update own rows only"
    on custom_potions for update
    using (lower(user_email) = lower(auth.jwt() ->> 'email'))
    with check (lower(user_email) = lower(auth.jwt() ->> 'email'));

create policy "custom_potions: delete own rows only"
    on custom_potions for delete
    using (lower(user_email) = lower(auth.jwt() ->> 'email'));

-- ---------- After running this ----------
-- Log in on the Character Sheet, add a custom potion, hit its new "Save
-- to Potion Book" button, then open the Potion Book modal — it should
-- appear under "My Potions" at the top, with a working "+ Add" and a way
-- to remove it. Then confirm it also shows up there on a second
-- character (or a second device logged into the same account).
