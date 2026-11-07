-- DM Tools: campaigns + campaign_submissions
--
-- This is a DRAFT for you to review and run yourself in the Supabase
-- dashboard's SQL editor (Project > SQL Editor > New query) whenever
-- you're ready. Nothing here has been run against the live database —
-- I don't have credentials to do that, and a schema change to a database
-- with real customer data in it shouldn't happen without you reading it
-- first anyway.
--
-- Naming/shape deliberately mirrors your existing character_backups
-- table (char_data as jsonb, a plain top-level name column alongside it
-- for easy querying) so this fits the same conventions rather than
-- inventing new ones.

create table if not exists campaigns (
    id uuid primary key default gen_random_uuid(),
    dm_email text not null,
    campaign_name text not null,
    campaign_code text not null unique,       -- the 8-char join code, Randomize-generated
    campaign_password text not null,          -- deliberately plain text, not hashed — this
                                               -- is a shared "room code" the DM always sees
                                               -- and can reset, not a real account password
                                               -- with a recovery flow. See dm-campaign-toolkit-
                                               -- plan memory for why that's the intended design.
    status text not null default 'active' check (status in ('active', 'archived')),
    created_at timestamptz not null default now()
);

create index if not exists campaigns_dm_email_idx on campaigns (dm_email);

create table if not exists campaign_submissions (
    id uuid primary key default gen_random_uuid(),
    campaign_id uuid not null references campaigns(id) on delete cascade,
    character_name text not null,
    player_name text not null,                -- the player's own real name, typed in at
                                               -- submit time — this is what actually lets
                                               -- the DM tell two players apart on the roster
    char_data jsonb not null,                 -- same shape getCharacterData() already
                                               -- produces for Cloud Backup today
    device_id text,                           -- internal only, never shown in any UI — a
                                               -- secondary anti-abuse signal, not the
                                               -- identity a submission is matched on
    submitted_at timestamptz not null default now(),

    -- A resubmission of the same character (by name) from the same player
    -- (by name), from any device, updates this row instead of creating a
    -- duplicate — the decided behavior from the plan doc.
    unique (campaign_id, player_name, character_name)
);

create index if not exists campaign_submissions_campaign_id_idx on campaign_submissions (campaign_id);

-- --- Row Level Security ---
-- Your existing tables (character_backups etc.) are already reachable
-- from client-side code using the publishable/anon key, so presumably
-- either have permissive RLS policies or RLS disabled. These two new
-- tables need the same kind of access — a DM's browser reads/writes its
-- own campaigns, a player's browser writes a submission. Double-check
-- these against however character_backups is actually configured before
-- relying on them; this is a reasonable starting point, not a guarantee.

alter table campaigns enable row level security;
alter table campaign_submissions enable row level security;

create policy "campaigns are readable by anyone with the anon key"
    on campaigns for select
    using (true);

create policy "campaigns can be created by anyone with the anon key"
    on campaigns for insert
    with check (true);

create policy "campaigns can be updated by anyone with the anon key"
    on campaigns for update
    using (true);

create policy "submissions are readable by anyone with the anon key"
    on campaign_submissions for select
    using (true);

create policy "submissions can be created/updated by anyone with the anon key"
    on campaign_submissions for insert
    with check (true);

create policy "submissions can be updated by anyone with the anon key"
    on campaign_submissions for update
    using (true);
