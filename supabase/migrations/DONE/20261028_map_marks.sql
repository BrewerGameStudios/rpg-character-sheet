-- Player and DM marks on the battle map (map-marks.js): freehand drawings and notes pinned to a spot.
-- Pings are not stored; they go over a live channel and fade.
--
-- kind 'draw': data = { pts: [[x, y], ...] in cell units, w: line width }
-- kind 'note': data = { x, y, text }; shared = true shows it to everyone, false keeps it for its author
-- owner_player_name / owner_character_name match the pair used by map_tokens ('__dm__' / 'DM' for the DM).
--
-- Run once in the Supabase SQL editor (DM-Tester and v3 share the project).

create table if not exists map_marks (
    id uuid primary key default gen_random_uuid(),
    map_id uuid not null references campaign_maps(id) on delete cascade,
    kind text not null check (kind in ('draw', 'note')),
    owner_player_name text,
    owner_character_name text,
    color text not null default '#4a4ba2',
    shared boolean not null default true,
    data jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

create index if not exists map_marks_map_id_idx on map_marks (map_id);

alter table map_marks enable row level security;

-- Same "anyone with the anon key" policy pattern as map_tokens and campaign_maps.
create policy "map_marks readable by anyone with the anon key"
    on map_marks for select using (true);
create policy "map_marks insertable by anyone with the anon key"
    on map_marks for insert with check (true);
create policy "map_marks updatable by anyone with the anon key"
    on map_marks for update using (true);
create policy "map_marks deletable by anyone with the anon key"
    on map_marks for delete using (true);
