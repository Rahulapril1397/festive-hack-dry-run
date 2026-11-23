-- 0110_assistant.sql — Stage 2 (E2): PinkyBua assistant, live integration logs.
-- The model never touches the database: rows here are written by the assistant service with the
-- caller's identity. Codes: NOT_FOUND, ACTION_INVALID, ACTION_EXPIRED, ACTION_USED.

create table assistant_session (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('staff','guest')),
  user_id     uuid references app_user(id) on delete cascade,
  family_id   uuid references family(id) on delete cascade,
  wedding_id  uuid not null references wedding(id) on delete cascade,
  created_at  timestamptz not null default now(),
  last_at     timestamptz not null default now(),
  check ((kind = 'staff' and user_id is not null and family_id is null) or (kind = 'guest' and family_id is not null and user_id is null))
);
create index assistant_session_user_idx on assistant_session(user_id, last_at desc);
create index assistant_session_family_idx on assistant_session(family_id, last_at desc);

-- One row per conversation turn (user text, assistant content, tool results), replayed in order.
create table assistant_message (
  id          bigint generated always as identity primary key,
  session_id  uuid not null references assistant_session(id) on delete cascade,
  role        text not null check (role in ('user','assistant','tool_results')),
  content     jsonb not null,
  created_at  timestamptz not null default now()
);
create index assistant_message_session_idx on assistant_message(session_id, id);

create table assistant_action (
  id                  uuid primary key default gen_random_uuid(),
  session_id          uuid not null references assistant_session(id) on delete cascade,
  tool                text not null,
  args_json           jsonb not null,
  args_hash           text not null,
  summary             text not null,
  status              text not null default 'pending' check (status in ('pending','executing','executed','cancelled','expired','failed')),
  confirm_token_hash  text not null,
  expires_at          timestamptz not null,
  executed_at         timestamptz,
  error               text,
  created_at          timestamptz not null default now()
);
create index assistant_action_session_idx on assistant_action(session_id);

-- Atomically claim a pending action for execution: owner, single-use token, 5-minute expiry.
create or replace function assistant_claim_action(p_id uuid, p_token_hash text, p_user uuid, p_family uuid)
returns assistant_action language plpgsql set search_path = public as $$
declare a assistant_action; s assistant_session;
begin
  select * into a from assistant_action where id = p_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  select * into s from assistant_session where id = a.session_id;
  if s.user_id is distinct from p_user or s.family_id is distinct from p_family then raise exception 'NOT_FOUND'; end if;
  if a.status <> 'pending' then raise exception 'ACTION_USED'; end if;
  if a.confirm_token_hash <> p_token_hash then raise exception 'ACTION_INVALID'; end if;
  if a.expires_at <= now() then
    update assistant_action set status = 'expired' where id = p_id;
    return null;  -- caller maps to ACTION_EXPIRED (a raise would roll back the status change)
  end if;
  update assistant_action set status = 'executing' where id = p_id returning * into a;
  return a;
end $$;

create or replace function assistant_finish_action(p_id uuid, p_ok boolean, p_error text, p_wedding uuid, p_actor uuid)
returns void language plpgsql set search_path = public as $$
declare a assistant_action;
begin
  update assistant_action
     set status = case when p_ok then 'executed' else 'failed' end,
         executed_at = case when p_ok then now() end, error = p_error
   where id = p_id and status = 'executing' returning * into a;
  if not found then raise exception 'ACTION_USED'; end if;
  insert into audit_log(wedding_id, actor, action, target, data)
  values (p_wedding, p_actor, 'assistant.' || a.tool || case when p_ok then '' else '.failed' end, p_id::text,
          jsonb_build_object('args', a.args_json, 'error', p_error));
end $$;

-- Flagsmith override evaluations (grant-only overrides for allowlisted roles).
create table feature_flag_eval_log (
  id          bigint generated always as identity primary key,
  wedding_id  uuid references wedding(id) on delete set null,
  role        text not null,
  flag        text not null,
  permission  text not null,
  result      boolean not null,
  fallback    boolean not null default false,
  created_at  timestamptz not null default now()
);
create index feature_flag_eval_log_idx on feature_flag_eval_log(created_at desc);

-- TTS results for /ops/integrations: enums and numbers only, no text, no family data.
create table tts_event (
  id          bigint generated always as identity primary key,
  result      text not null check (result in ('success','failure','timeout','disabled')),
  source      text check (source in ('memory','storage','sarvam')),
  language    app_language,
  latency_ms  integer,
  created_at  timestamptz not null default now()
);
create index tts_event_idx on tts_event(created_at desc);

-- Pre-generated announcement audio (scripts/pregen-tts.ts), private.
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets(id, name, public) values ('tts', 'tts', false) on conflict (id) do nothing;
  end if;
end $$;

select lock_down_public();
