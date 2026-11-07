-- RLS lockdown: library_books + monsters_npcs (2026-09-11)
--
-- Same deal as every other file in this folder: a draft for you to read
-- and run yourself in the Supabase dashboard's SQL editor (Project > SQL
-- Editor > New query). Nothing here has been run against the live
-- database yet.
--
-- WHAT THIS FIXES: both tables were created with `using (true)` policies
-- — "readable/writable by anyone with the anon key." The anon
-- (publishable) key isn't a secret; it's baked into shared.js and shipped
-- to every visitor of the site. That means, right now, a raw API request
-- straight to Supabase's REST endpoint (bypassing the app's own UI
-- entirely, which only ever politely filters by `.eq('dm_email', email)`
-- client-side) can read or write EVERY DM's library books and monster/NPC
-- library, not just their own. This replaces that with real Postgres-
-- enforced isolation: a row is only visible/editable by the person
-- actually logged into that email.
--
-- WHY THIS IS SAFE TO DO WITHOUT BREAKING CURRENT USERS: every path that
-- touches either table in dm.html sits behind restrictedFeature('DM
-- Tools'), which only ever passes for someone who already completed a
-- real password sign-in (signInWithPassword) earlier in the session — see
-- shared.js's initActivateButton -> completeLogin. That sign-in is what
-- gives Supabase's own client (_supabase, same instance used for every
-- .from() call) a real session token, which it then attaches to every
-- request automatically from then on -- including after a page reload,
-- since Supabase persists and auto-refreshes that session on its own.
-- So: anyone who can currently open the Monster Editor or the Digital
-- Library already has a live token carrying their own email -- these
-- policies just require it match dm_email, which it already always does
-- for a legitimate user. index.html (the player-facing sheet) never
-- touches either table at all (grepped for both table names — zero
-- matches), so this can't affect players either.
--
-- SCOPE -- deliberately ONLY these two tables. campaigns/
-- campaign_submissions/campaign_maps/loot_awards and license_accounts
-- ALSO have `using (true)` policies from this same era, but a player
-- joins a campaign with just its code + password -- not necessarily a
-- real logged-in/paid account at all -- so locking those to "must match
-- auth's own email" would break real current players, not just close a
-- gap. Those need a different fix (something that checks the campaign
-- code/password itself, e.g. a security-definer function, rather than
-- per-row identity) and shouldn't be rushed through in the same pass as
-- this one. Flagging it here so it doesn't get forgotten.
--
-- lower(...) on both sides of the comparison: dm_email is already always
-- stored lowercase (see shared.js's loginLicense — "Force lowercase to
-- prevent caps-lock issues later") and Supabase Auth emails are lowercase
-- too in every normal case, but there's no cost to being defensive about
-- it here, and a silent case mismatch would otherwise look exactly like
-- "my library went empty" to whoever hit it.

-- ---------- library_books ----------

drop policy if exists "library_books are readable by anyone with the anon key" on library_books;
drop policy if exists "library_books can be created by anyone with the anon key" on library_books;
drop policy if exists "library_books can be updated by anyone with the anon key" on library_books;
drop policy if exists "library_books can be deleted by anyone with the anon key" on library_books;

create policy "library_books: select own rows only"
    on library_books for select
    using (lower(dm_email) = lower(auth.jwt() ->> 'email'));

create policy "library_books: insert own rows only"
    on library_books for insert
    with check (lower(dm_email) = lower(auth.jwt() ->> 'email'));

create policy "library_books: update own rows only"
    on library_books for update
    using (lower(dm_email) = lower(auth.jwt() ->> 'email'))
    with check (lower(dm_email) = lower(auth.jwt() ->> 'email'));

create policy "library_books: delete own rows only"
    on library_books for delete
    using (lower(dm_email) = lower(auth.jwt() ->> 'email'));

-- ---------- monsters_npcs ----------

drop policy if exists "monsters_npcs are readable by anyone with the anon key" on monsters_npcs;
drop policy if exists "monsters_npcs can be created by anyone with the anon key" on monsters_npcs;
drop policy if exists "monsters_npcs can be updated by anyone with the anon key" on monsters_npcs;
drop policy if exists "monsters_npcs can be deleted by anyone with the anon key" on monsters_npcs;

create policy "monsters_npcs: select own rows only"
    on monsters_npcs for select
    using (lower(dm_email) = lower(auth.jwt() ->> 'email'));

create policy "monsters_npcs: insert own rows only"
    on monsters_npcs for insert
    with check (lower(dm_email) = lower(auth.jwt() ->> 'email'));

create policy "monsters_npcs: update own rows only"
    on monsters_npcs for update
    using (lower(dm_email) = lower(auth.jwt() ->> 'email'))
    with check (lower(dm_email) = lower(auth.jwt() ->> 'email'));

create policy "monsters_npcs: delete own rows only"
    on monsters_npcs for delete
    using (lower(dm_email) = lower(auth.jwt() ->> 'email'));

-- ---------- After running this ----------
-- Log in as yourself (or any real customer) in DM Tools and confirm the
-- Digital Library and Monster/NPC Library both still load exactly what
-- they did before. If either one comes up empty for a real logged-in
-- account, STOP and tell me — that means something about that account's
-- session isn't carrying the email these policies expect, and the fix
-- needs to happen before this goes any further, not after.
