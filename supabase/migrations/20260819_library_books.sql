-- DM Tools: Digital Library (Phase 05)
--
-- Same deal as the other migrations in this folder — a draft for you to
-- read and run yourself in the Supabase dashboard's SQL editor. Nothing
-- has been run against the live database.
--
-- Per the plan (dm-campaign-toolkit-plan memory): a personal library owned
-- by the DM directly (dm_email), NOT scoped to any one campaign — same
-- ownership model as monsters_npcs. Books are LINKED, never uploaded:
-- source_url points to wherever the DM already hosts the file (Google
-- Drive, Dropbox, etc.). extracted_text is plain text pulled CLIENT-SIDE
-- from the DM's own local copy of that file purely to build a search
-- index — the file itself never touches this table or any Supabase
-- storage bucket, so there's no storage cost and we're never in
-- possession of a copy of the actual book.
--
-- search_vector is a generated column (title + extracted_text, English
-- config) with its own GIN index, so full-text search runs entirely in
-- Postgres — the app never has to pull every book's full text into the
-- browser just to search it.

create table if not exists library_books (
    id uuid primary key default gen_random_uuid(),
    dm_email text not null,
    title text not null,
    source_url text not null,
    extracted_text text not null default '',
    search_vector tsvector generated always as (
        to_tsvector('english', coalesce(title, '') || ' ' || coalesce(extracted_text, ''))
    ) stored,
    created_at timestamptz not null default now()
);

create index if not exists library_books_dm_email_idx on library_books (dm_email);
create index if not exists library_books_search_idx on library_books using gin (search_vector);

alter table library_books enable row level security;

create policy "library_books are readable by anyone with the anon key"
    on library_books for select
    using (true);

create policy "library_books can be created by anyone with the anon key"
    on library_books for insert
    with check (true);

create policy "library_books can be updated by anyone with the anon key"
    on library_books for update
    using (true);

create policy "library_books can be deleted by anyone with the anon key"
    on library_books for delete
    using (true);
