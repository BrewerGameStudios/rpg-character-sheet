-- Scenes for the battle map (see dm.html's "Scenes" button in the Map tab's toolbar).
--
-- A scene is a snapshot of one map as it stood at a moment, so the DM can jump between "Before the fight" and
-- "After the fight" in one click. `snapshot` holds, as JSON:
--   v, cols, rows, grid_data, wall_edges, ink_walls (null when the map has no ink_walls column), aoe_markers, cone_markers,
--   light_level, tokens (the full map_tokens rows), fog (the map_fog rows, only when per-player fog is in use).
-- The map's background picture is deliberately NOT in it (it is large, and it does not change between scenes).
-- Loading a scene writes this back over the map, upserts its tokens by id and removes tokens that were not in it.
-- Before any load the page keeps a safety copy of the map as it was (is_auto = true, one per map, replaced each time).
--
-- token_count and is_auto are kept as plain columns so the list of scenes can be fetched without downloading every snapshot.
--
-- Run once in the Supabase SQL editor (DM-Tester and v3 share the project). Nothing has been run against the live database.

create table if not exists map_scenes (
    id uuid primary key default gen_random_uuid(),
    map_id uuid not null references campaign_maps(id) on delete cascade,
    name text not null default 'Scene',
    snapshot jsonb not null default '{}'::jsonb,
    token_count integer not null default 0,
    is_auto boolean not null default false,
    created_at timestamptz not null default now()
);

create index if not exists map_scenes_map_id_idx on map_scenes (map_id);

alter table map_scenes enable row level security;

-- Same "anyone with the anon key" policy pattern as map_tokens, map_marks and campaign_maps.
create policy "map_scenes readable by anyone with the anon key"
    on map_scenes for select using (true);
create policy "map_scenes insertable by anyone with the anon key"
    on map_scenes for insert with check (true);
create policy "map_scenes updatable by anyone with the anon key"
    on map_scenes for update using (true);
create policy "map_scenes deletable by anyone with the anon key"
    on map_scenes for delete using (true);
