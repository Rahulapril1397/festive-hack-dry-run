-- 0001_core.sql — Schema v0 (E1, Stage 1).
-- Every table P0 needs so E2/E3 build against real tables. E2/E3 refine their own tables
-- (rsvp, ledger_entry, batch, photo*, clock_calibration, translation) in their migration ranges.
--
-- Access model for Stage 1: the server talks to Postgres with the service role only.
-- RLS is enabled on every table with NO policies, so the public anon key exposed to browsers
-- cannot read or write anything through PostgREST. Real policies arrive with Stage 2.

create extension if not exists pgcrypto;   -- crypt()/gen_salt() for check-in codes (Supabase: schema "extensions")

-- ─── enums ──────────────────────────────────────────────────────────────────────────────────
create type stage_action as enum ('called','skipped','paused','resumed','on_stage','served','no_show');
create type queue_status as enum ('waiting','called','on_stage','served','no_show');
create type app_language as enum ('en','hi');

create sequence queue_position_seq;

-- ─── wedding / event / family ───────────────────────────────────────────────────────────────
create table wedding (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  is_demo           boolean not null default false,   -- drives the "Demo" banner
  next_token_number integer not null default 1 check (next_token_number > 0),
  created_at        timestamptz not null default now()
);

create table event (
  id          uuid primary key default gen_random_uuid(),
  wedding_id  uuid not null references wedding(id) on delete cascade,
  name        text not null,
  starts_at   timestamptz,
  language    app_language not null default 'en',      -- language of the venue TV
  tv_key      text not null unique default replace(gen_random_uuid()::text, '-', ''),
  created_at  timestamptz not null default now()
);
create index event_wedding_idx on event(wedding_id);

create table family (
  id                uuid primary key default gen_random_uuid(),
  wedding_id        uuid not null references wedding(id) on delete cascade,
  name              text not null,
  phone             text,                                 -- normalised: 10 digits, no country code
  link_key          text not null unique default replace(gen_random_uuid()::text, '-', ''),
  language          app_language not null default 'en',
  checkin_code_hash text,                                 -- bcrypt via pgcrypto
  token_number      integer,                              -- allocated at first check-in, kept for the wedding
  is_walk_in        boolean not null default false,
  created_at        timestamptz not null default now(),
  unique (wedding_id, token_number)
);
create unique index family_wedding_phone_uidx on family(wedding_id, phone) where phone is not null;
create index family_wedding_name_idx on family(wedding_id, lower(name));

create table rsvp (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null references family(id) on delete cascade,
  event_id    uuid not null references event(id) on delete cascade,
  status      text not null default 'pending' check (status in ('pending','yes','no')),
  headcount   integer not null default 0 check (headcount >= 0),
  updated_at  timestamptz not null default now(),
  unique (family_id, event_id)
);

-- ─── check-in and queue ─────────────────────────────────────────────────────────────────────
create table checkin (
  id             uuid primary key default gen_random_uuid(),
  event_id       uuid not null references event(id) on delete cascade,
  family_id      uuid not null references family(id) on delete cascade,
  method         text not null check (method in ('self','desk','walk_in')),
  by_user        uuid,
  checked_in_at  timestamptz not null default now(),
  unique (event_id, family_id)
);

-- Failed/successful self check-in attempts, for the 5-in-15-minutes lockout.
create table checkin_attempt (
  id          bigint generated always as identity primary key,
  family_id   uuid not null references family(id) on delete cascade,
  event_id    uuid not null references event(id) on delete cascade,
  success     boolean not null,
  created_at  timestamptz not null default now()
);
create index checkin_attempt_family_idx on checkin_attempt(family_id, created_at desc) where not success;

create table queue_entry (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null references event(id) on delete cascade,
  family_id     uuid not null references family(id) on delete cascade,
  token_number  integer not null,
  position      bigint not null default nextval('queue_position_seq'),
  status        queue_status not null default 'waiting',
  skip_count    integer not null default 0,
  called_at     timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (event_id, family_id),
  unique (event_id, token_number)
);
create index queue_entry_waiting_idx on queue_entry(event_id, position) where status = 'waiting';

create table queue_state (
  event_id          uuid primary key references event(id) on delete cascade,
  paused            boolean not null default false,
  current_entry_id  uuid references queue_entry(id) on delete set null,
  updated_at        timestamptz not null default now()
);

create table stage_log (
  id               uuid primary key default gen_random_uuid(),
  event_id         uuid not null references event(id),
  queue_entry_id   uuid references queue_entry(id),
  token_number     integer,
  action           stage_action not null,
  actor            uuid,
  idempotency_key  text not null,
  created_at       timestamptz not null default now(),
  unique (event_id, idempotency_key)
);
create index stage_log_event_idx on stage_log(event_id, created_at desc);

-- Append-only: no UPDATE, DELETE or TRUNCATE, for anyone (including the service role).
create function stage_log_append_only() returns trigger language plpgsql as $$
begin
  raise exception 'stage_log is append-only (% blocked)', tg_op using errcode = 'P0002';
end $$;
create trigger stage_log_no_update_delete before update or delete on stage_log
  for each row execute function stage_log_append_only();
create trigger stage_log_no_truncate before truncate on stage_log
  for each statement execute function stage_log_append_only();

-- What the venue TV may see. Deliberately nothing else: no names, phones, amounts.
create table tv_feed (
  event_id         uuid primary key references event(id) on delete cascade,
  token            integer,
  next_token       integer,
  instruction      text,
  language         app_language not null default 'en',
  announcement_id  uuid,          -- = stage_log.id of the latest "called"
  updated_at       timestamptz not null default now()
);

-- ─── minimal tables for E2 / E3 (they refine in their own ranges) ──────────────────────────
create table ledger_entry (
  id            uuid primary key default gen_random_uuid(),
  wedding_id    uuid not null references wedding(id) on delete cascade,
  family_id     uuid references family(id),
  event_id      uuid references event(id),
  amount_paise  bigint not null,
  kind          text not null,
  note          text,
  created_by    uuid,
  created_at    timestamptz not null default now()
);

create table batch (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references event(id) on delete cascade,
  kind        text not null,
  status      text not null default 'open',
  created_at  timestamptz not null default now()
);

create table photo (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null references event(id) on delete cascade,
  storage_path  text not null,
  taken_at      timestamptz,
  uploaded_by   uuid,
  created_at    timestamptz not null default now()
);

create table photo_candidate (
  id          uuid primary key default gen_random_uuid(),
  photo_id    uuid not null references photo(id) on delete cascade,
  family_id   uuid not null references family(id) on delete cascade,
  stage_log_id uuid references stage_log(id),
  score       real,
  status      text not null default 'pending',
  created_at  timestamptz not null default now()
);

create table clock_calibration (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid references event(id) on delete cascade,
  device_id   text not null,
  user_id     uuid,
  offset_ms   bigint not null,
  created_at  timestamptz not null default now()
);

create table translation (
  id        uuid primary key default gen_random_uuid(),
  key       text not null,
  language  app_language not null,
  text      text not null,
  unique (key, language)
);

-- ─── users, roles, permissions, audit ───────────────────────────────────────────────────────
-- app_user.id = auth.users.id (no FK so the migration also runs on plain Postgres in tests).
create table app_user (
  id            uuid primary key,
  email         text not null unique,
  display_name  text,
  created_at    timestamptz not null default now()
);

create table role (
  id    uuid primary key default gen_random_uuid(),
  key   text not null unique,       -- host | stage | kitchen | photographer | admin | finance
  name  text not null
);

create table permission (
  key          text primary key,
  description  text
);

create table role_permission (
  role_id        uuid not null references role(id) on delete cascade,
  permission_key text not null references permission(key) on delete cascade,
  primary key (role_id, permission_key)
);

create table user_role (
  user_id     uuid not null references app_user(id) on delete cascade,
  role_id     uuid not null references role(id) on delete cascade,
  wedding_id  uuid not null references wedding(id) on delete cascade,
  primary key (user_id, role_id, wedding_id)
);

create table audit_log (
  id          bigint generated always as identity primary key,
  wedding_id  uuid references wedding(id),
  actor       uuid,
  action      text not null,
  target      text,
  data        jsonb not null default '{}',
  created_at  timestamptz not null default now()
);

-- Roles exist from day one (Stage 2 fills role_permission from staticMap.ts).
insert into role(key, name) values
  ('host','Host'), ('stage','Stage manager'), ('kitchen','Kitchen'),
  ('photographer','Photographer'), ('admin','Admin'), ('finance','Finance');

-- ─── lock down PostgREST exposure ───────────────────────────────────────────────────────────
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
end $$;
