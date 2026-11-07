-- Digital Library: real cloud file storage (2026-09-12)
--
-- A draft for you to read and run yourself in the Supabase dashboard's SQL
-- editor (Project > SQL Editor > New query). Nothing here has been run
-- against the live database yet.
--
-- WHAT THIS CHANGES: up to now, picking a PDF only ever pulled its text
-- out client-side for search (uploaded) and remembered the file's own
-- bytes in that one browser's IndexedDB (never uploaded — see the old
-- comment on dmLibraryBooks in dm.html). That meant a book added on one
-- device only ever opened on that same device unless you also had it
-- hosted somewhere else and pasted a link, or ran "Save Local Copy" again
-- on every other device separately.
--
-- This adds a real per-account cloud copy of the actual PDF file, so a
-- book opens from any device once it's been added anywhere — "Save Local
-- Copy" still exists for an instant, offline-capable copy on one device,
-- it's just no longer the ONLY way to get a book to follow you around.
--
-- Same legal note as the Terms of Service section covering this (menu.html
-- > Terms of Service > 5. User-Uploaded Content): this now stores the
-- actual file, not just its extracted text, on infrastructure this app
-- controls. Real per-account access control below is what makes "only
-- that account can reach it" actually true — see the RLS lockdown work
-- (rpg-character-sheet-rls-lockdown memory) for why that matters.

-- ---------- New column ----------
-- Nullable — an old book saved before this exists, or one whose upload
-- failed, just has no cloud copy yet; every read site already treats a
-- missing/falsy storage_path as "nothing to fetch here," same pattern as
-- every other optional field on this table.
alter table library_books add column if not exists storage_path text;

-- ---------- Storage bucket ----------
-- Private (public = false) — nobody reaches a file through a bare URL,
-- only through the app's own signed download call, which only succeeds
-- once the policies below say it may.
insert into storage.buckets (id, name, public)
values ('library-books', 'library-books', false)
on conflict (id) do nothing;

-- ---------- Storage access policies ----------
-- Every object's path is "<dm_email>/<book id>.pdf" (see
-- uploadLibraryFileToCloud in dm.html) — storage.foldername(name) splits
-- that path and [1] is the first segment, i.e. the email it was uploaded
-- under. Same lower()-on-both-sides pattern as the library_books/
-- monsters_npcs RLS lockdown, for the same case-safety reason.
--
-- Safe for the same reason that lockdown was: every path that uploads or
-- downloads a library file in dm.html sits behind restrictedFeature('DM
-- Tools'), which only ever passes after a real password sign-in — so a
-- live session token carrying the right email already exists by the time
-- any of this runs.

drop policy if exists "library-books storage: select own files" on storage.objects;
drop policy if exists "library-books storage: insert own files" on storage.objects;
drop policy if exists "library-books storage: update own files" on storage.objects;
drop policy if exists "library-books storage: delete own files" on storage.objects;

create policy "library-books storage: select own files"
    on storage.objects for select
    using (bucket_id = 'library-books' and lower((storage.foldername(name))[1]) = lower(auth.jwt() ->> 'email'));

create policy "library-books storage: insert own files"
    on storage.objects for insert
    with check (bucket_id = 'library-books' and lower((storage.foldername(name))[1]) = lower(auth.jwt() ->> 'email'));

create policy "library-books storage: update own files"
    on storage.objects for update
    using (bucket_id = 'library-books' and lower((storage.foldername(name))[1]) = lower(auth.jwt() ->> 'email'))
    with check (bucket_id = 'library-books' and lower((storage.foldername(name))[1]) = lower(auth.jwt() ->> 'email'));

create policy "library-books storage: delete own files"
    on storage.objects for delete
    using (bucket_id = 'library-books' and lower((storage.foldername(name))[1]) = lower(auth.jwt() ->> 'email'));

-- ---------- After running this ----------
-- In DM Tools, edit an existing book and re-pick its file (or add a brand
-- new one) — the status line should say it uploaded successfully. Then
-- open that SAME book from a different browser/device logged into the
-- same account and confirm the title opens it straight from the cloud
-- copy with no local file ever picked there. If the upload fails with a
-- size-related error, check this project's Storage settings for its
-- per-file upload limit — that's a project setting, not something this
-- migration controls.
