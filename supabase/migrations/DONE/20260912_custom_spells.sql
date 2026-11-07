-- Custom Spellbook library (2026-09-12)
--
-- A draft for you to read and run yourself in the Supabase dashboard's SQL
-- editor. Nothing here has been run against the live database yet.
--
-- Same idea as custom_potions, applied to Spells/Cantrips: a hand-typed
-- custom spell now has a "☁️ Save to My Spellbook" button that pushes it
-- to this account's own cloud library, so it shows up under a "My Saved"
-- section on the Spellbook's Custom tab — on any character, any device
-- you're logged into — instead of only ever existing on the one character
-- you first typed it onto.
--
-- Same ownership model as character_backups/custom_potions (user_email,
-- matching shared.js's licenseEmail). RLS scoped correctly from the
-- start, same as custom_potions — see that migration's own comment for
-- why this is safe to do without extra usability cost.

create table if not exists custom_spells (
    id uuid primary key default gen_random_uuid(),
    user_email text not null,
    name text not null,
    cantrip boolean not null default false,
    level integer not null default 0, -- raw .spell-level-select value (0-8), not the "real" 1-9 spell level SRD_SPELLS uses
    casting_time text not null default '',
    range text not null default '',
    duration text not null default '',
    components text not null default '',
    dice text not null default '',
    damage_type text not null default '',
    description text not null default '',
    created_at timestamptz not null default now(),
    unique (user_email, name) -- re-saving the same name updates it in place
);

create index if not exists custom_spells_user_email_idx on custom_spells (user_email);

alter table custom_spells enable row level security;

create policy "custom_spells: select own rows only"
    on custom_spells for select
    using (lower(user_email) = lower(auth.jwt() ->> 'email'));

create policy "custom_spells: insert own rows only"
    on custom_spells for insert
    with check (lower(user_email) = lower(auth.jwt() ->> 'email'));

create policy "custom_spells: update own rows only"
    on custom_spells for update
    using (lower(user_email) = lower(auth.jwt() ->> 'email'))
    with check (lower(user_email) = lower(auth.jwt() ->> 'email'));

create policy "custom_spells: delete own rows only"
    on custom_spells for delete
    using (lower(user_email) = lower(auth.jwt() ->> 'email'));

-- ---------- After running this ----------
-- Log in, add a custom spell or cantrip, hit its new "☁️ Save to My
-- Spellbook" button, then open the Spellbook -> Custom tab — it should
-- appear under "☁️ My Saved" with a working "+ Add" and a way to remove
-- it. Confirm it also shows up there on a second character.
