-- Panel's database. Everything lives in the `app` schema, which Supabase does not
-- expose through its public Data API, and every table has row level security on
-- with no policies, so only the server (connecting with DATABASE_URL) can read or
-- write it. The browser only ever talks to Supabase for sign-in.

create table if not exists app.reviews (
  id text primary key,
  created_at bigint not null,
  updated_at bigint not null,
  -- Owner: a signed-in account, or (before sign-in) the browser that made it.
  user_id uuid,
  anon_id text,
  stage text not null,
  stage_detail text,
  error text,
  answers jsonb not null,
  intent jsonb not null,
  board jsonb not null,
  title text,
  video jsonb,
  ledger jsonb,
  notes jsonb,
  discussion jsonb,
  synthesis jsonb,
  validation jsonb,
  cost jsonb not null default '{"usd":0,"calls":[]}',
  -- Media files already copied to Supabase Storage (for signed-in owners).
  stored_files jsonb not null default '[]'
);
create index if not exists reviews_user on app.reviews (user_id, created_at desc);
create index if not exists reviews_anon on app.reviews (anon_id) where user_id is null;
create index if not exists reviews_stage on app.reviews (stage, created_at);

create table if not exists app.jobs (
  id bigserial primary key,
  review_id text not null references app.reviews (id) on delete cascade,
  kind text not null,
  payload jsonb not null default '{}',
  status text not null default 'pending',
  attempts int not null default 0,
  error text,
  created_at bigint not null,
  started_at bigint,
  finished_at bigint
);
create index if not exists jobs_status on app.jobs (status, id);

create table if not exists app.followups (
  id bigserial primary key,
  review_id text not null references app.reviews (id) on delete cascade,
  reviewer_id text not null,
  role text not null,
  content text not null,
  created_at bigint not null
);
create index if not exists followups_thread on app.followups (review_id, reviewer_id, id);

-- Every paid API call, for the app-wide daily and monthly caps.
create table if not exists app.spend (
  id bigserial primary key,
  at bigint not null,
  label text not null,
  model text not null,
  usd double precision not null,
  review_id text
);
create index if not exists spend_at on app.spend (at);

-- Per-person usage. client_key is a keyed hash of the visitor's IP address (never
-- the address itself). Rows are reserved before the paid work starts, inside a
-- per-key lock, so parallel tabs can't slip past a limit.
create table if not exists app.usage (
  id bigserial primary key,
  at bigint not null,
  client_key text not null,
  kind text not null,
  review_id text
);
create index if not exists usage_key on app.usage (client_key, kind, at);
create index if not exists usage_review on app.usage (review_id, kind);

alter table app.reviews enable row level security;
alter table app.jobs enable row level security;
alter table app.followups enable row level security;
alter table app.spend enable row level security;
alter table app.usage enable row level security;

-- Private bucket for signed-in users' review media (video, poster, captions, frames).
-- 50 MB per file is the Supabase free-plan maximum.
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('review-media', 'review-media', false, 52428800, array['video/mp4', 'image/jpeg', 'text/vtt'])
    on conflict (id) do nothing;
  end if;
end $$;
