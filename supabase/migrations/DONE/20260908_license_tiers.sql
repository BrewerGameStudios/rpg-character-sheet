-- Split Character Sheet / DM Tools licensing (2026-09-08, DM-Tester only
-- for now) — see the "Business / Licensing Discussion" section of the
-- master TODO for the full plan this implements: Character Sheet alone
-- ($10, the SAME Payment Link/Price everyone already uses), a $20 upgrade
-- that adds DM Tools on top of an existing Character Sheet license, or
-- the $25 bundle up front (grants both at once). DM Tools was never
-- purchasable on its own and still isn't in this plan.
--
-- ============================================================
-- STEP 1 — RUN THIS QUERY FIRST, BY ITSELF, AND CHECK THE RESULT.
-- ============================================================
-- stripe-webhook has only ever done a blind `insert()` on every checkout,
-- never an upsert — so if the same email ever checked out twice (a
-- refund + rebuy, a duplicate click, etc.), there could already be more
-- than one row for it. The UNIQUE constraint in Step 3 below will FAIL to
-- apply if any duplicates exist. This must return ZERO rows before you
-- run the rest of this file:
--
--     select email, count(*) from "Licenses" group by email having count(*) > 1;
--
-- If it DOES return rows: for each one, decide which row to keep (the
-- one with is_active = true, or the most recent) and delete the other(s)
-- by id before continuing. Do not run Step 3 until this comes back empty.
--
-- ============================================================
-- STEP 2 — entitlement columns, and grandfather existing customers.
-- ============================================================
-- Draft for you to read and run yourself in the Supabase dashboard's SQL
-- editor, same as every other migration in this folder. Nothing has been
-- run against the live database.

alter table "Licenses"
    add column if not exists has_character boolean not null default false,
    add column if not exists has_dm boolean not null default false;

-- Every EXISTING active customer already paid under the old "one license
-- unlocks everything" model — this migration must never take anything
-- away from someone who's already active, so they all get both flags.
update "Licenses" set has_character = true, has_dm = true where is_active = true;

-- ============================================================
-- STEP 3 — only after Step 1 came back empty: unique email, so the new
-- stripe-webhook's upsert (onConflict: 'email') actually has a real
-- constraint to conflict against, instead of silently inserting a second
-- row on a repeat purchase (the $20 upgrade) the way plain insert() always
-- has.
-- ============================================================
alter table "Licenses" add constraint licenses_email_key unique (email);
