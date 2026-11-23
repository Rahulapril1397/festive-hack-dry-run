-- 0020_jobs.sql — Stage 3 (E1 T1): scheduled job runner + in-app notifications.
-- Jobs are claimed with FOR UPDATE SKIP LOCKED, so parallel /api/jobs/tick calls never run a
-- job twice. Retries: 1 min, 5 min, 30 min; the 4th failed attempt marks the job dead.

create table job (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  payload     jsonb not null default '{}',
  run_at      timestamptz not null default now(),
  status      text not null default 'pending' check (status in ('pending','running','done','failed','dead')),
  attempts    integer not null default 0,
  last_error  text,
  locked_at   timestamptz,
  dedupe_key  text unique,                     -- recurring/idempotent enqueues (e.g. "task_escalation_scan:2026-12-13T10:15")
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  finished_at timestamptz
);
create index job_due_idx on job(run_at) where status in ('pending','failed');
create index job_status_idx on job(status, updated_at desc);

create table notification (
  id          uuid primary key default gen_random_uuid(),
  wedding_id  uuid not null references wedding(id) on delete cascade,
  user_id     uuid references app_user(id) on delete cascade,
  family_id   uuid references family(id) on delete cascade,
  title       text not null,
  body        text not null default '',
  link        text,
  kind        text,
  created_at  timestamptz not null default now(),
  read_at     timestamptz,
  check (user_id is not null or family_id is not null)
);
create index notification_user_idx on notification(user_id, created_at desc);
create index notification_family_idx on notification(family_id, created_at desc);

-- Enqueue; with a dedupe key a second enqueue is a no-op (returns null).
create or replace function jobs_enqueue(p_name text, p_payload jsonb, p_run_at timestamptz, p_dedupe text)
returns uuid language sql set search_path = public as $$
  insert into job(name, payload, run_at, dedupe_key) values (p_name, coalesce(p_payload, '{}'), coalesce(p_run_at, now()), p_dedupe)
  on conflict (dedupe_key) do nothing
  returning id;
$$;

-- Claim due jobs (pending/failed whose run_at passed, or running ones stuck > 10 minutes).
create or replace function jobs_claim(p_now timestamptz, p_limit integer)
returns setof job language sql set search_path = public as $$
  update job j
     set status = 'running', locked_at = p_now, attempts = j.attempts + 1, updated_at = now()
   where j.id in (
     select id from job
      where (status in ('pending','failed') and run_at <= p_now)
         or (status = 'running' and locked_at < p_now - interval '10 minutes')
      order by run_at
      limit greatest(1, least(p_limit, 100))
      for update skip locked)
  returning j.*;
$$;

-- Finish one claimed job. p_retry_at null + not ok = dead.
create or replace function jobs_finish(p_id uuid, p_ok boolean, p_error text, p_retry_at timestamptz)
returns job language plpgsql set search_path = public as $$
declare v job;
begin
  update job set
    status = case when p_ok then 'done' when p_retry_at is null then 'dead' else 'failed' end,
    last_error = case when p_ok then last_error else left(p_error, 2000) end,
    run_at = coalesce(p_retry_at, run_at),
    locked_at = null,
    finished_at = case when p_ok or p_retry_at is null then now() end,
    updated_at = now()
  where id = p_id and status = 'running'
  returning * into v;
  return v;
end $$;

-- Admin Retry from /admin/jobs (audited).
create or replace function jobs_retry(p_id uuid, p_actor uuid, p_wedding uuid)
returns job language plpgsql set search_path = public as $$
declare v job;
begin
  update job set status = 'pending', attempts = 0, run_at = now(), last_error = null, locked_at = null, finished_at = null, updated_at = now()
   where id = p_id and status in ('failed','dead') returning * into v;
  if not found then raise exception 'INVALID_TRANSITION'; end if;
  insert into audit_log(wedding_id, actor, action, target, data) values (p_wedding, p_actor, 'job.retry', p_id::text, jsonb_build_object('name', v.name));
  return v;
end $$;

-- Nightly housekeeping: finished jobs older than 30 days, read notifications older than 90.
create or replace function jobs_cleanup()
returns integer language plpgsql set search_path = public as $$
declare n integer; m integer;
begin
  delete from job where status = 'done' and finished_at < now() - interval '30 days';
  get diagnostics n = row_count;
  delete from notification where read_at is not null and read_at < now() - interval '90 days';
  get diagnostics m = row_count;
  return n + m;
end $$;

insert into permission(key, description) values ('jobs.manage', 'See and retry background jobs')
on conflict (key) do update set description = excluded.description;
insert into role_permission(role_id, permission_key)
select r.id, 'jobs.manage' from role r where r.key in ('super_admin','admin') on conflict do nothing;

select lock_down_public();
