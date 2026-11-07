-- Separate fog of war for each player (map-fog.js): the squares one player's character has explored on a map.
-- Only used when the DM picks "Separate fog for each player" for a map; the usual shared fog stays on campaign_maps.grid_data.
--
-- cells = a JSON array of square keys, e.g. ["A1","B1","C2"]
-- owner_player_name / owner_character_name match the pair used by map_tokens.
--
-- Run once in the Supabase SQL editor (DM-Tester and v3 share the project).

create table if not exists map_fog (
    id uuid primary key default gen_random_uuid(),
    map_id uuid not null references campaign_maps(id) on delete cascade,
    owner_player_name text not null default '',
    owner_character_name text not null default '',
    cells jsonb not null default '[]'::jsonb,
    updated_at timestamptz not null default now(),
    unique (map_id, owner_player_name, owner_character_name)
);

create index if not exists map_fog_map_id_idx on map_fog (map_id);

alter table map_fog enable row level security;

-- Same "anyone with the anon key" policy pattern as map_tokens and campaign_maps.
create policy "map_fog readable by anyone with the anon key"
    on map_fog for select using (true);
create policy "map_fog insertable by anyone with the anon key"
    on map_fog for insert with check (true);
create policy "map_fog updatable by anyone with the anon key"
    on map_fog for update using (true);
create policy "map_fog deletable by anyone with the anon key"
    on map_fog for delete using (true);
