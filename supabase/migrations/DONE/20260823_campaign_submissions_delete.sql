-- campaign_submissions was created with select/insert/update RLS policies
-- but no delete policy at all (see 20260818_dm_tools_campaigns.sql) — the
-- exact same gap campaigns itself had until 20260819_campaign_delete_and_
-- retention.sql fixed it there. Never caught until now because Postgres
-- RLS silently filters out rows a DELETE isn't allowed to touch rather
-- than erroring: removeSubmission() in dm.html calls
-- .from('campaign_submissions').delete().eq('id', id) and gets back
-- error: null either way, so the "Remove from roster" button looked like
-- it worked while actually deleting zero rows every time. Confirmed live
-- against a real throwaway submission: delete returned no error, but the
-- row was still there right after.
--
-- Draft for you to read and run yourself in the Supabase dashboard's SQL
-- editor, same as every other migration in this folder. Nothing has been
-- run against the live database.

create policy "submissions can be deleted by anyone with the anon key"
    on campaign_submissions for delete
    using (true);
