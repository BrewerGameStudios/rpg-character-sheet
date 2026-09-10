-- DM Tools: campaign delete + archived retention
--
-- Draft for you to review and run yourself in the Supabase dashboard's SQL
-- editor, same as the other migrations in this folder.
--
-- Two things:
-- 1. campaigns never had a `delete` RLS policy — only select/insert/update
--    (see 20260818_dm_tools_campaigns.sql), so Archive was the only removal
--    option the app could ever actually perform, even though nothing in
--    the UI made that obvious. This adds a real Delete.
-- 2. Archived campaigns should clean themselves up automatically after 90
--    days instead of sitting around forever. That needs to know *when* a
--    campaign was archived, hence archived_at. Existing archived campaigns
--    (from before this column existed) get their 90-day clock started now
--    via the backfill below, rather than being stuck in limbo forever.

alter table campaigns add column if not exists archived_at timestamptz;

update campaigns set archived_at = now() where status = 'archived' and archived_at is null;

create policy "campaigns can be deleted by anyone with the anon key"
    on campaigns for delete
    using (true);
