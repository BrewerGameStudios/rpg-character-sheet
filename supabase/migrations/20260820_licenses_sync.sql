-- Sync license_accounts from the real "Licenses" table
--
-- license_accounts (previous migration) was only ever populated from
-- campaigns/monsters_npcs/library_books/character_backups — meaning a
-- license that's been activated but never actually used to save anything
-- never got an account row, and so never showed up in admin.html at all.
-- "Licenses" (note the capital L — it was created with a quoted,
-- case-sensitive name, so every reference to it below has to match that
-- exactly or Postgres won't find it) is the real table verify-license
-- checks against; this is what actually fixes that gap.
--
-- Read-only with respect to "Licenses" itself — nothing here ever alters
-- its columns, existing rows, or RLS policies, only SELECTs from it (for
-- the backfill) and adds a trigger that fires on inserts to it. That
-- table gates the entire app's paywall, so it's treated as strictly
-- off-limits to modify structurally.
--
-- Draft for you to read and run yourself in the Supabase dashboard's SQL
-- editor, same as every other migration in this folder. Nothing has been
-- run against the live database. Safe to run after (and only after)
-- 20260820_license_accounts.sql.

-- Backfill: one account per email already in "Licenses", even ones with
-- zero campaigns/monsters/books/characters.
insert into license_accounts (email)
select distinct lower(email) from "Licenses" where email is not null
on conflict (email) do nothing;

-- Extends the existing trigger function (from 20260820_license_accounts.sql)
-- with a branch for "Licenses" — it has no account_id column of its own
-- (its primary key is email, which already matches license_accounts.email
-- directly, so no FK column is needed there), so this branch only ensures
-- the license_accounts row exists and skips the NEW.account_id assignment
-- the other four tables' rows get.
create or replace function sync_license_account()
returns trigger as $$
declare
    v_email text;
    v_account_id uuid;
begin
    if TG_TABLE_NAME = 'character_backups' then
        v_email := lower(NEW.user_email);
    elsif TG_TABLE_NAME = 'Licenses' then
        v_email := lower(NEW.email);
    else
        v_email := lower(NEW.dm_email);
    end if;

    if v_email is null then
        return NEW;
    end if;

    insert into license_accounts (email)
    values (v_email)
    on conflict (email) do nothing;

    if TG_TABLE_NAME <> 'Licenses' then
        select id into v_account_id from license_accounts where email = v_email;
        NEW.account_id := v_account_id;
    end if;

    return NEW;
end;
$$ language plpgsql;

drop trigger if exists licenses_sync_account on "Licenses";
create trigger licenses_sync_account
    before insert on "Licenses"
    for each row execute function sync_license_account();
