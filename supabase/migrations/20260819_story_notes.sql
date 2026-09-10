-- DM Tools: Story Tracker (Phase 04)
--
-- One rich-text blob per campaign, not a separate table — a campaign has
-- exactly one story, unlike the roster or monster library which are real
-- lists. Draft for you to read and run yourself in the Supabase dashboard's
-- SQL editor, same as the other migrations in this folder.

alter table campaigns add column if not exists story_notes text not null default '';
