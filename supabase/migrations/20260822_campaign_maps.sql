-- Battle Maps — a 20x20 coordinate grid (columns A-T, rows 1-20, cells like
-- "G6") a DM builds per campaign: walls/doors/traps, and player/monster/NPC
-- tokens with fog of war driven by real line-of-sight (walls and doors
-- block vision), not manual painting.
--
-- Two tables, split by how often each actually changes:
--   - campaign_maps: the built layout (terrain + fog-revealed state per
--     cell) — edited occasionally, one row per map, multiple maps per
--     campaign (a dungeon has more than one room), one flagged is_active
--     as the map players currently see.
--   - map_tokens: token positions — change constantly during play (every
--     move), kept as their own small rows rather than folded into the
--     grid_data blob so a token move never has to rewrite the whole
--     layout.
--
-- Speed and vision_range are plain DM-editable numbers for now, not pulled
-- from a character sheet or monster stat block yet — deliberately deferred
-- (see rpg-character-sheet-repos memory) until this ties into real sheet
-- data in a later pass. Same reasoning for identity_revealed: a monster/NPC
-- token's real_name is only ever shown to players once the DM checks that
-- box in the legend.
--
-- Draft for you to read and run yourself in the Supabase dashboard's SQL
-- editor, same as every other migration in this folder. Nothing has been
-- run against the live database.

create table if not exists campaign_maps (
    id uuid primary key default gen_random_uuid(),
    campaign_id uuid references campaigns(id) on delete cascade,
    name text not null default 'Map 1',
    is_active boolean not null default false,
    -- { "A1": { "terrain": "wall"|"door"|"trap"|null, "hidden": bool, "fogRevealed": bool }, ... }
    -- "hidden" only means something for terrain like traps — a cell can be
    -- fully fogRevealed (players have seen the room) while its trap stays
    -- hidden until a player token's move actually lands on that cell.
    grid_data jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

-- At most one active map per campaign — the app still has to unset the old
-- one before setting a new one active (two updates, not a transaction;
-- fine at this project's scale), this index is just insurance against a
-- bug ever leaving two flagged active at once.
create unique index if not exists campaign_maps_one_active_idx
    on campaign_maps (campaign_id)
    where is_active;

create table if not exists map_tokens (
    id uuid primary key default gen_random_uuid(),
    map_id uuid references campaign_maps(id) on delete cascade,
    kind text not null check (kind in ('player', 'monster', 'npc')),
    cell text not null,

    -- Display identity: a semantic color role name ('pro'/'success'/
    -- 'accent'/'warning'/'danger') plus a number, auto-assigned the first
    -- time a given monster/NPC library entry is placed on this map —
    -- three goblins placed one after another become the same color,
    -- numbered 1/2/3. Players only ever see color + number; real_name is
    -- DM-only until identity_revealed flips.
    color text not null,
    number integer,
    real_name text not null,

    -- Loose reference to where this token actually came from (a
    -- campaign_submissions row for a player, a monsters_npcs row for a
    -- monster/NPC) — not a hard foreign key, since the source can be
    -- resubmitted/deleted independently and the token should keep
    -- existing on the map either way, same reasoning as loot_awards not
    -- FK'ing to campaign_submissions.
    linked_id uuid,

    -- Player tokens only: matches campaign_submissions.player_name /
    -- character_name, the same pair every other player-identity check in
    -- this project already uses (Submit to Campaign, Claim Loot) — this is
    -- what lets a player's own index.html move only its own token.
    owner_player_name text,
    owner_character_name text,

    speed integer not null default 30,
    vision_range integer not null default 6,
    identity_revealed boolean not null default false,

    updated_at timestamptz not null default now()
);

create index if not exists map_tokens_map_id_idx on map_tokens (map_id);

alter table campaign_maps enable row level security;
alter table map_tokens enable row level security;

-- Same "anyone with the anon key" wide-open policy pattern as every other
-- table in this project.
create policy "campaign_maps readable by anyone with the anon key"
    on campaign_maps for select using (true);
create policy "campaign_maps insertable by anyone with the anon key"
    on campaign_maps for insert with check (true);
create policy "campaign_maps updatable by anyone with the anon key"
    on campaign_maps for update using (true);
create policy "campaign_maps deletable by anyone with the anon key"
    on campaign_maps for delete using (true);

create policy "map_tokens readable by anyone with the anon key"
    on map_tokens for select using (true);
create policy "map_tokens insertable by anyone with the anon key"
    on map_tokens for insert with check (true);
create policy "map_tokens updatable by anyone with the anon key"
    on map_tokens for update using (true);
create policy "map_tokens deletable by anyone with the anon key"
    on map_tokens for delete using (true);
