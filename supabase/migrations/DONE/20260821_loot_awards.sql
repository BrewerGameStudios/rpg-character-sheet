-- Loot Awards — the actual hand-off between "planned loot" (the DM's prep
-- list) and a specific player's inventory.
--
-- Planned Loot already exists (campaigns.planned_loot, a jsonb array —
-- see 20260819_planned_loot.sql) but it's purely the DM's own prep list;
-- nothing in it is tied to a real player. This adds that missing link: a
-- DM assigns a loot entry (or sends money directly) to a specific player's
-- specific character, and that character's own index.html picks it up on
-- next load/refresh and claims it into a real container or coin stack.
--
-- Matched by (player_name, character_name), the exact same pair
-- campaign_submissions is keyed on (see submitToCampaign() in index.html)
-- — not a foreign key to campaign_submissions.id, since a DM should still
-- be able to assign loot even if that submission row is later deleted or
-- resubmitted, and a player's own index.html already has player_name
-- (localStorage 'playerRealName') and character_name (the live charName
-- field) on hand without needing to track a submission id separately.
--
-- Draft for you to read and run yourself in the Supabase dashboard's SQL
-- editor, same as every other migration in this folder. Nothing has been
-- run against the live database.

create table if not exists loot_awards (
    id uuid primary key default gen_random_uuid(),
    campaign_id uuid references campaigns(id) on delete cascade,
    player_name text not null,
    character_name text not null,

    -- 'item' uses item_name/description/worth/other_info/source (mirrors a
    -- Planned Loot card). 'money' uses cp/sp/ep/gp/pp instead — kept as a
    -- separate kind rather than cramming a coin amount into "worth" (free
    -- text) since claiming money needs real numbers to hand to
    -- addCoinStack(), not a string to parse.
    kind text not null default 'item' check (kind in ('item', 'money')),

    item_name text,
    description text,
    worth text,
    other_info text,
    source text,

    cp integer not null default 0,
    sp integer not null default 0,
    ep integer not null default 0,
    gp integer not null default 0,
    pp integer not null default 0,

    claimed boolean not null default false,
    created_at timestamptz not null default now(),
    claimed_at timestamptz
);

create index if not exists loot_awards_pending_idx
    on loot_awards (player_name, character_name)
    where claimed = false;

alter table loot_awards enable row level security;

-- Same "anyone with the anon key" wide-open policy pattern as every other
-- table in this project — this app has no real per-user auth yet, so real
-- access control isn't in scope here any more than it is anywhere else.
create policy "loot_awards readable by anyone with the anon key"
    on loot_awards for select using (true);
create policy "loot_awards insertable by anyone with the anon key"
    on loot_awards for insert with check (true);
create policy "loot_awards updatable by anyone with the anon key"
    on loot_awards for update using (true);
create policy "loot_awards deletable by anyone with the anon key"
    on loot_awards for delete using (true);
