-- Map light level (Bright/Dim/Darkness, matching 5e's own three light
-- categories) plus raw per-token Vision/Dark Vision in feet, so a
-- token's actual sight radius gets computed fresh from current
-- conditions instead of one number baked in once at placement time.
-- Lets a DM flip a cave from Bright to Dark mid-session (a torch goes
-- out) and have it apply on every token's next move/placement, rather
-- than needing to re-place everyone.
--
-- map_tokens.vision_range (from the very first Battle Map migration)
-- is left in place but unused going forward — not dropped, since
-- dropping a live column some other open tab/session might still read
-- isn't worth the risk for a column that's simply ignored now.
-- Functionally replaced by effectiveVisionRadius(token, map) in both
-- dm.html and index.html, computed from these two new raw fields plus
-- campaign_maps.light_level:
--   - bright: normal Vision applies, Dark Vision adds nothing extra
--   - dim: a token with Dark Vision sees by whichever of the two is
--     larger; one without still just uses normal Vision (not modeled
--     as reduced — see the "informational, not a full simulation"
--     precedent elsewhere in this project, e.g. elevation)
--   - dark (darkness): a token with Dark Vision uses it; one without
--     is treated as effectively blind beyond its own cell
--
-- Draft for you to read and run yourself in the Supabase dashboard's SQL
-- editor, same as every other migration in this folder. Nothing has been
-- run against the live database.

alter table campaign_maps
    add column if not exists light_level text not null default 'bright'
    check (light_level in ('bright', 'dim', 'dark'));

alter table map_tokens
    add column if not exists vision integer not null default 30,
    add column if not exists darkvision integer not null default 0;
