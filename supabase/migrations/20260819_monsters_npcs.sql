-- DM Tools: monsters_npcs
--
-- Same deal as the campaigns migration — a draft for you to read and run
-- yourself in the Supabase dashboard's SQL editor. Nothing has been run
-- against the live database.
--
-- Per the plan (dm-campaign-toolkit-plan memory): this is a personal
-- library owned by the DM directly (dm_email), NOT scoped to any one
-- campaign — build a goblin once, use it in every campaign you run.

create table if not exists monsters_npcs (
    id uuid primary key default gen_random_uuid(),
    dm_email text not null,
    name text not null,
    kind text not null default 'Monster' check (kind in ('Monster', 'NPC')),
    stat_block jsonb not null,   -- AC, HP, speed, abilities, attacks, notes —
                                 -- same shape convention as a player's char_data
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists monsters_npcs_dm_email_idx on monsters_npcs (dm_email);

alter table monsters_npcs enable row level security;

create policy "monsters_npcs are readable by anyone with the anon key"
    on monsters_npcs for select
    using (true);

create policy "monsters_npcs can be created by anyone with the anon key"
    on monsters_npcs for insert
    with check (true);

create policy "monsters_npcs can be updated by anyone with the anon key"
    on monsters_npcs for update
    using (true);

create policy "monsters_npcs can be deleted by anyone with the anon key"
    on monsters_npcs for delete
    using (true);
