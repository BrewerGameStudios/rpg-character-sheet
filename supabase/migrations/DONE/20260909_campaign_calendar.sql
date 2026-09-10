-- Calendar / Weather / Time system (2026-09-09) — per-campaign state a DM
-- sets from dm.html's new "Calendar & Weather" modal (Story tab toolbar),
-- shown to players as a live-updating floating widget on their sheet.
-- Draft for you to read and run yourself in the Supabase dashboard's SQL
-- editor, same as every other migration in this folder.

alter table campaigns
    add column if not exists calendar_system text,                          -- null (not set up yet) | 'harptos' (5e) | 'custom'
    add column if not exists calendar_custom_months jsonb,                  -- [{name, days}, ...] — only used when calendar_system = 'custom'
    add column if not exists calendar_year integer not null default 1491,   -- 1491 DR matches the 5e Harptos default era; irrelevant for custom
    add column if not exists calendar_day_of_year integer not null default 1,
    add column if not exists calendar_time_period text not null default 'Morning',
    add column if not exists calendar_moon_cycle_days integer not null default 30,
    add column if not exists calendar_weather_condition text not null default 'clear',
    add column if not exists calendar_weather_temp_f integer not null default 70,
    add column if not exists calendar_climate text not null default 'temperate';

-- ============================================================
-- ONE MORE STEP — NOT SQL, a dashboard setting:
-- ============================================================
-- The player-facing widget updates live via Supabase Realtime, which needs
-- to be turned on for this table:
--   Dashboard -> Database -> Replication -> find "campaigns" in the table
--   list -> toggle it on.
-- Skipping this doesn't break anything else — the widget will just show
-- the calendar/weather state as of whenever the player's sheet last
-- loaded, instead of updating instantly while they're already looking at
-- it.
