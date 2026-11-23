-- 0022_tasks.sql — Stage 3 (E1 T4–T5): tasks with owner, due date, status machine, append-only
-- history, reminders and escalation levels. vendor_id is a plain uuid here; 0211 adds the FK once
-- the vendor table exists.

alter table wedding add column if not exists task_escalation_hours numeric not null default 2
  check (task_escalation_hours > 0 and task_escalation_hours <= 72);

create table task (
  id                    uuid primary key default gen_random_uuid(),
  wedding_id            uuid not null references wedding(id) on delete cascade,
  title                 text not null check (length(trim(title)) between 2 and 160),
  description           text,
  owner_participant_id  uuid references participant(id) on delete set null,
  event_id              uuid references event(id) on delete set null,
  vendor_id             uuid,
  due_at                timestamptz,
  status                text not null default 'open' check (status in ('open','in_progress','blocked','done','cancelled')),
  priority              text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  escalation_level      integer not null default 0,
  created_by            uuid,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  completed_at          timestamptz
);
create index task_wedding_idx on task(wedding_id, status, due_at);
create index task_owner_idx on task(owner_participant_id);

create table task_event (
  id          bigint generated always as identity primary key,
  task_id     uuid not null references task(id) on delete cascade,
  type        text not null check (type in ('created','updated','assigned','status_changed','reminder_sent','escalated','comment')),
  actor       uuid,
  data        jsonb not null default '{}',
  created_at  timestamptz not null default now()
);
create index task_event_task_idx on task_event(task_id, id);

-- Append-only: no UPDATE; DELETE only as part of deleting the task itself (cascade).
create or replace function task_event_append_only() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' and not exists (select 1 from task where id = old.task_id) then return old; end if;
  raise exception 'task_event is append-only (% blocked)', tg_op using errcode = 'P0002';
end $$;
create trigger task_event_append_only before update or delete on task_event
  for each row execute function task_event_append_only();

-- Transitions (mirrors src/domain/tasks/status.ts).
create or replace function task_transition_ok(p_from text, p_to text) returns boolean language sql immutable as $$
  select (p_from, p_to) in (
    ('open','in_progress'), ('open','cancelled'),
    ('in_progress','blocked'), ('in_progress','done'), ('in_progress','cancelled'), ('in_progress','open'),
    ('blocked','in_progress'), ('blocked','done'), ('blocked','cancelled'))
$$;

-- p = {title, description?, ownerParticipantId?, eventId?, vendorId?, dueAt?, priority?}
create or replace function task_create(p_actor uuid, p_wedding uuid, p jsonb)
returns task language plpgsql set search_path = public as $$
declare v task;
begin
  if nullif(p->>'ownerParticipantId', '') is not null and not exists (
       select 1 from participant where id = (p->>'ownerParticipantId')::uuid and wedding_id = p_wedding) then raise exception 'NOT_FOUND'; end if;
  if nullif(p->>'eventId', '') is not null and not exists (
       select 1 from event where id = (p->>'eventId')::uuid and wedding_id = p_wedding) then raise exception 'EVENT_NOT_FOUND'; end if;
  insert into task(wedding_id, title, description, owner_participant_id, event_id, vendor_id, due_at, priority, created_by)
  values (p_wedding, trim(p->>'title'), nullif(p->>'description', ''), nullif(p->>'ownerParticipantId', '')::uuid,
          nullif(p->>'eventId', '')::uuid, nullif(p->>'vendorId', '')::uuid, nullif(p->>'dueAt', '')::timestamptz,
          coalesce(nullif(p->>'priority', ''), 'normal'), p_actor)
  returning * into v;
  insert into task_event(task_id, type, actor, data) values (v.id, 'created', p_actor, jsonb_build_object('title', v.title));
  if v.owner_participant_id is not null then
    insert into task_event(task_id, type, actor, data) values (v.id, 'assigned', p_actor, jsonb_build_object('owner', v.owner_participant_id));
  end if;
  perform audit(p_wedding, p_actor, 'task.create', v.id::text, jsonb_build_object('title', v.title));
  return v;
end $$;

-- Partial update of editable fields; owner change writes "assigned", due change resets escalation.
create or replace function task_update(p_actor uuid, p_wedding uuid, p_task uuid, p jsonb)
returns task language plpgsql set search_path = public as $$
declare o task; v task;
begin
  select * into o from task where id = p_task and wedding_id = p_wedding for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if o.status in ('done','cancelled') then raise exception 'INVALID_TRANSITION'; end if;
  if p ? 'ownerParticipantId' and nullif(p->>'ownerParticipantId', '') is not null and not exists (
       select 1 from participant where id = (p->>'ownerParticipantId')::uuid and wedding_id = p_wedding) then raise exception 'NOT_FOUND'; end if;
  if p ? 'eventId' and nullif(p->>'eventId', '') is not null and not exists (
       select 1 from event where id = (p->>'eventId')::uuid and wedding_id = p_wedding) then raise exception 'EVENT_NOT_FOUND'; end if;
  update task set
    title = coalesce(nullif(trim(p->>'title'), ''), title),
    description = case when p ? 'description' then nullif(p->>'description', '') else description end,
    owner_participant_id = case when p ? 'ownerParticipantId' then nullif(p->>'ownerParticipantId', '')::uuid else owner_participant_id end,
    event_id = case when p ? 'eventId' then nullif(p->>'eventId', '')::uuid else event_id end,
    vendor_id = case when p ? 'vendorId' then nullif(p->>'vendorId', '')::uuid else vendor_id end,
    due_at = case when p ? 'dueAt' then nullif(p->>'dueAt', '')::timestamptz else due_at end,
    priority = coalesce(nullif(p->>'priority', ''), priority),
    escalation_level = case when p ? 'dueAt' and (nullif(p->>'dueAt', '')::timestamptz is distinct from due_at) then 0 else escalation_level end,
    updated_at = now()
  where id = p_task returning * into v;
  if v.owner_participant_id is distinct from o.owner_participant_id then
    insert into task_event(task_id, type, actor, data) values (v.id, 'assigned', p_actor, jsonb_build_object('owner', v.owner_participant_id, 'from', o.owner_participant_id));
  end if;
  insert into task_event(task_id, type, actor, data) values (v.id, 'updated', p_actor, p - 'description');
  perform audit(p_wedding, p_actor, 'task.update', v.id::text, p - 'description');
  return v;
end $$;

create or replace function task_set_status(p_actor uuid, p_wedding uuid, p_task uuid, p_status text, p_note text)
returns task language plpgsql set search_path = public as $$
declare o task; v task;
begin
  select * into o from task where id = p_task and wedding_id = p_wedding for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if not task_transition_ok(o.status, p_status) then raise exception 'INVALID_TRANSITION'; end if;
  update task set status = p_status, updated_at = now(),
         completed_at = case when p_status in ('done','cancelled') then now() else null end
   where id = p_task returning * into v;
  insert into task_event(task_id, type, actor, data) values (v.id, 'status_changed', p_actor, jsonb_build_object('from', o.status, 'to', p_status, 'note', p_note));
  perform audit(p_wedding, p_actor, 'task.status', v.id::text, jsonb_build_object('from', o.status, 'to', p_status));
  return v;
end $$;

create or replace function task_comment(p_actor uuid, p_wedding uuid, p_task uuid, p_body text)
returns void language plpgsql set search_path = public as $$
begin
  if not exists (select 1 from task where id = p_task and wedding_id = p_wedding) then raise exception 'NOT_FOUND'; end if;
  if length(trim(coalesce(p_body, ''))) = 0 then raise exception 'BAD_REQUEST'; end if;
  insert into task_event(task_id, type, actor, data) values (p_task, 'comment', p_actor, jsonb_build_object('body', left(p_body, 2000)));
  perform audit(p_wedding, p_actor, 'task.comment', p_task::text);
end $$;

-- Reminder / escalation bookkeeping by the job runner (no actor).
create or replace function task_log_event(p_task uuid, p_type text, p_data jsonb)
returns void language sql set search_path = public as $$
  insert into task_event(task_id, type, data) values (p_task, p_type, coalesce(p_data, '{}'));
$$;

-- Raise the escalation level once (returns false if it was already at/above that level).
create or replace function task_escalate(p_task uuid, p_level integer, p_data jsonb)
returns boolean language plpgsql set search_path = public as $$
begin
  update task set escalation_level = p_level, updated_at = now()
   where id = p_task and escalation_level < p_level and status not in ('done','cancelled');
  if not found then return false; end if;
  insert into task_event(task_id, type, data) values (p_task, 'escalated', jsonb_build_object('level', p_level) || coalesce(p_data, '{}'));
  return true;
end $$;

insert into permission(key, description) values
  ('tasks.read', 'See the wedding''s tasks'),
  ('tasks.manage', 'Create, assign and edit any task'),
  ('tasks.update_own', 'Change status of and comment on tasks you own')
on conflict (key) do update set description = excluded.description;
insert into role_permission(role_id, permission_key)
select r.id, k from role r, unnest(array['tasks.read','tasks.manage','tasks.update_own']) k
 where r.key in ('super_admin','admin','host','coordinator')
on conflict do nothing;
insert into role_permission(role_id, permission_key)
select r.id, k from role r, unnest(array['tasks.read','tasks.update_own']) k
 where r.key in ('stage_manager','kitchen','photographer','finance')
on conflict do nothing;

select lock_down_public();
