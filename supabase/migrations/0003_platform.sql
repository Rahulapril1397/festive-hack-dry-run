-- 0003_platform.sql — wedding settings used by guest (E2) and photos (E3); PostgREST lock-down helper (E1).

alter table wedding
  add column couple_names          text,
  add column wedding_date          date,
  add column contact_phone         text,                 -- "Contact organiser" on the family pass
  add column invitation_text       text,                 -- approved copy; may be sent to Sarvam
  add column photo_match_window_ms integer not null default 3000 check (photo_match_window_ms between 0 and 60000);

-- Functions are EXECUTE-able by PUBLIC by default, which would expose them to the anon key via
-- PostgREST /rpc. Every migration that adds functions or tables ends with `select lock_down_public();`.
create or replace function lock_down_public() returns void language plpgsql as $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
  revoke execute on all functions in schema public from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke execute on all functions in schema public from anon, authenticated';
    execute 'revoke all on all tables in schema public from anon, authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on all functions in schema public to service_role';
  end if;
end $$;

-- Generic append-only guard (stage_log has its own from 0001).
create or replace function append_only() returns trigger language plpgsql as $$
begin
  raise exception '% is append-only (% blocked)', tg_table_name, tg_op using errcode = 'P0002';
end $$;

select lock_down_public();
