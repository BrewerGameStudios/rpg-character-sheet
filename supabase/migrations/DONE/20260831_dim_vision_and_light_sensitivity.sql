-- Splits the Battle Map's light-level vision model (see
-- 20260824_map_light_and_token_vision.sql) into a proper 5e-style three-
-- tier system instead of just Vision/Dark Vision:
--   - Vision now represents normal/BRIGHT light, which isn't range-
--     limited by the rules — defaults to a generous 300 ft (covers any
--     battle map) instead of the old 30
--   - Dim Vision is new: how far a creature sees in dim light/shadows,
--     typed in directly (same "no checkbox, no race list" philosophy
--     Dark Vision already used) rather than always assumed to be some
--     fixed multiple of Dark Vision
--   - Light Sensitive (e.g. Sunlight Sensitivity) is new: when set, a
--     creature doesn't get the normal unlimited-range bright-light sight
--     and is capped down to its Dim Vision even in bright light
--
-- Functionally used by effectiveVisionRadius(token, map) in both dm.html
-- and index.html:
--   - bright: light_sensitive ? max(dim_vision, darkvision) : vision
--   - dim: max(dim_vision, darkvision)
--   - dark: darkvision if any, else a 5 ft / 1-cell floor
--
-- Draft for you to read and run yourself in the Supabase dashboard's SQL
-- editor, same as every other migration in this folder. Nothing has been
-- run against the live database.

alter table map_tokens
    add column if not exists dim_vision integer not null default 30,
    add column if not exists light_sensitive boolean not null default false;

-- Existing tokens' own `vision` values are left as whatever they already
-- were — most default to the OLD 30, which under the new bright-light
-- logic above would make them undesirably shortsighted in bright light. A
-- one-time bump for the untouched default only, not anyone who
-- deliberately set a different value.
update map_tokens set vision = 300 where vision = 30;
