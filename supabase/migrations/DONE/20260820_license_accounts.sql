-- License Accounts Directory (for admin/moderation use, not the app itself)
--
-- Every table so far identifies its owner by a bare email column
-- (campaigns.dm_email, monsters_npcs.dm_email, library_books.dm_email,
-- character_backups.user_email) with no real structure tying a person's
-- rows together across tables — find someone today and you're filtering
-- one table at a time by a string. This gives that a home: one row per
-- licensed email, and an account_id column added to each of those four
-- tables pointing at it.
--
-- Deliberately additive and non-breaking:
--   - Every existing dm_email/user_email column stays exactly as it is.
--     Nothing here removes or renames anything the app already reads or
--     writes, so index.html/dm.html need zero code changes.
--   - Existing rows are backfilled below, so every account that already
--     exists (campaigns, monsters, library books, character sheets
--     already saved by real users) gets linked automatically the moment
--     this runs — nothing "loses" its account_id just because it predates
--     this migration.
--   - Going forward, a BEFORE INSERT trigger on each of the four tables
--     finds-or-creates the matching license_accounts row and stamps
--     account_id automatically — so this stays correct for all future
--     data without the app ever needing to know this table exists.
--
-- Security note, stated plainly rather than implied: like every other
-- table in this project, RLS below is wide open (same "anyone with the
-- anon key" policy pattern already used everywhere else here) — this app
-- has no real per-user authentication yet, so RLS was never the actual
-- security boundary for anything, and pretending this table is different
-- would be misleading. Actually restricting this needs real Supabase Auth
-- — a separate, bigger piece of work, not part of this migration.
--
-- Draft for you to read and run yourself in the Supabase dashboard's SQL
-- editor, same as every other migration in this folder. Nothing has been
-- run against the live database.

create table if not exists license_accounts (
    id uuid primary key default gen_random_uuid(),
    email text not null unique,
    created_at timestamptz not null default now()
);

alter table license_accounts enable row level security;

create policy "license_accounts readable by anyone with the anon key"
    on license_accounts for select using (true);
create policy "license_accounts insertable by anyone with the anon key"
    on license_accounts for insert with check (true);
create policy "license_accounts updatable by anyone with the anon key"
    on license_accounts for update using (true);
create policy "license_accounts deletable by anyone with the anon key"
    on license_accounts for delete using (true);

-- Backfill one account per distinct email already in use anywhere, so
-- every existing DM/player already has a directory entry before the FK
-- columns below start pointing at them.
insert into license_accounts (email)
select distinct lower(dm_email) from campaigns where dm_email is not null
union
select distinct lower(dm_email) from monsters_npcs where dm_email is not null
union
select distinct lower(dm_email) from library_books where dm_email is not null
union
select distinct lower(user_email) from character_backups where user_email is not null
on conflict (email) do nothing;

alter table campaigns add column if not exists account_id uuid references license_accounts(id);
update campaigns set account_id = (select id from license_accounts where email = lower(campaigns.dm_email)) where account_id is null;
create index if not exists campaigns_account_id_idx on campaigns (account_id);

alter table monsters_npcs add column if not exists account_id uuid references license_accounts(id);
update monsters_npcs set account_id = (select id from license_accounts where email = lower(monsters_npcs.dm_email)) where account_id is null;
create index if not exists monsters_npcs_account_id_idx on monsters_npcs (account_id);

alter table library_books add column if not exists account_id uuid references license_accounts(id);
update library_books set account_id = (select id from license_accounts where email = lower(library_books.dm_email)) where account_id is null;
create index if not exists library_books_account_id_idx on library_books (account_id);

alter table character_backups add column if not exists account_id uuid references license_accounts(id);
update character_backups set account_id = (select id from license_accounts where email = lower(character_backups.user_email)) where account_id is null;
create index if not exists character_backups_account_id_idx on character_backups (account_id);

-- One shared trigger function, branching on which table fired it — finds
-- or creates the account for that row's email and stamps account_id, so
-- every future insert on any of these four tables stays linked
-- automatically with no app-side changes required.
create or replace function sync_license_account()
returns trigger as $$
declare
    v_email text;
    v_account_id uuid;
begin
    if TG_TABLE_NAME = 'character_backups' then
        v_email := lower(NEW.user_email);
    else
        v_email := lower(NEW.dm_email);
    end if;

    if v_email is null then
        return NEW;
    end if;

    insert into license_accounts (email)
    values (v_email)
    on conflict (email) do nothing;

    select id into v_account_id from license_accounts where email = v_email;
    NEW.account_id := v_account_id;
    return NEW;
end;
$$ language plpgsql;

drop trigger if exists campaigns_sync_account on campaigns;
create trigger campaigns_sync_account
    before insert on campaigns
    for each row execute function sync_license_account();

drop trigger if exists monsters_npcs_sync_account on monsters_npcs;
create trigger monsters_npcs_sync_account
    before insert on monsters_npcs
    for each row execute function sync_license_account();

drop trigger if exists library_books_sync_account on library_books;
create trigger library_books_sync_account
    before insert on library_books
    for each row execute function sync_license_account();

drop trigger if exists character_backups_sync_account on character_backups;
create trigger character_backups_sync_account
    before insert on character_backups
    for each row execute function sync_license_account();
