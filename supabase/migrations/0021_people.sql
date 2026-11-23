-- 0021_people.sql — Stage 3 (E1 T2–T3): participants (people without a login), assignment
-- lifecycle (pending/active/suspended/expired), wedding-specific custom roles cloned from system
-- templates, and per-assignment deny overrides (deny beats allow).

create table participant (
  id            uuid primary key default gen_random_uuid(),
  wedding_id    uuid not null references wedding(id) on delete cascade,
  display_name  text not null check (length(trim(display_name)) between 2 and 80),
  phone         text,
  email         text,
  title         text,                                  -- "Mama ji (stage helper)", "Planner"
  user_id       uuid references app_user(id) on delete set null,
  status        text not null default 'active' check (status in ('active','inactive')),
  created_by    uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (wedding_id, user_id)
);
create index participant_wedding_idx on participant(wedding_id, status);

-- ─── assignment lifecycle ───────────────────────────────────────────────────────────────────
alter table user_role
  add column if not exists participant_id uuid references participant(id) on delete cascade,
  add column if not exists status text not null default 'active' check (status in ('pending','active','suspended','expired'));
alter table user_role alter column user_id drop not null;
alter table user_role add constraint user_role_subject check (user_id is not null or participant_id is not null);
create unique index if not exists user_role_participant_unique
  on user_role(participant_id, role_id, coalesce(wedding_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where participant_id is not null;

-- ─── custom roles ───────────────────────────────────────────────────────────────────────────
alter table role
  add column if not exists wedding_id  uuid references wedding(id) on delete cascade,  -- null = system/global
  add column if not exists cloned_from uuid references role(id) on delete set null;

create table user_permission_override (
  id              uuid primary key default gen_random_uuid(),
  assignment_id   uuid not null references user_role(id) on delete cascade,
  permission_key  text not null references permission(key) on delete cascade,
  effect          text not null default 'deny' check (effect = 'deny'),
  created_by      uuid,
  created_at      timestamptz not null default now(),
  unique (assignment_id, permission_key)
);

-- Assignment rules: super_admin wedding-less; wedding roles only in their wedding; no login → pending.
create or replace function authz.check_assignment() returns trigger language plpgsql as $$
declare v_key text; v_role_wedding uuid;
begin
  select key, wedding_id into v_key, v_role_wedding from public.role where id = new.role_id;
  if v_key = 'super_admin' and new.wedding_id is not null then raise exception 'BAD_REQUEST'; end if;
  if v_key <> 'super_admin' and new.wedding_id is null then raise exception 'BAD_REQUEST'; end if;
  if v_role_wedding is not null and v_role_wedding is distinct from new.wedding_id then raise exception 'BAD_REQUEST'; end if;
  if new.user_id is null and new.status = 'active' then new.status := 'pending'; end if;
  return new;
end $$;

-- ─── resolver: status + deny overrides ──────────────────────────────────────────────────────
create or replace function authz.active_assignments(p_user uuid)
returns table(assignment_id uuid, role_id uuid, role_key text, wedding_id uuid)
language sql stable set search_path = public as $$
  select ur.id, r.id, r.key, ur.wedding_id
    from user_role ur
    join role r on r.id = ur.role_id
    join app_user u on u.id = ur.user_id
   where ur.user_id = p_user and u.status = 'active' and ur.status = 'active'
     and now() >= ur.starts_at and (ur.expires_at is null or now() < ur.expires_at)
$$;

create or replace function authz.denied_permissions(p_user uuid, p_wedding uuid)
returns text[] language sql stable set search_path = public as $$
  select coalesce(array_agg(distinct o.permission_key order by o.permission_key), '{}')
    from authz.active_assignments(p_user) a
    join user_permission_override o on o.assignment_id = a.assignment_id
   where a.wedding_id = p_wedding or (a.wedding_id is null and a.role_key = 'super_admin')
$$;

create or replace function authz.effective_permissions(p_user uuid, p_wedding uuid)
returns text[] language sql stable set search_path = public as $$
  select coalesce(array_agg(distinct rp.permission_key order by rp.permission_key), '{}')
    from authz.active_assignments(p_user) a
    join role_permission rp on rp.role_id = a.role_id
   where (a.wedding_id = p_wedding or (a.wedding_id is null and a.role_key = 'super_admin'))
     and rp.permission_key <> all (authz.denied_permissions(p_user, p_wedding))
$$;

create or replace function public.authz_permissions(p_user uuid, p_wedding uuid)
returns jsonb language sql stable set search_path = public, authz as $$
  select jsonb_build_object(
    'permissions', to_jsonb(authz.effective_permissions(p_user, p_wedding)),
    'denied', to_jsonb(authz.denied_permissions(p_user, p_wedding)),
    'roles', coalesce((select jsonb_agg(distinct a.role_key) from authz.active_assignments(p_user) a
                        where a.wedding_id = p_wedding or (a.wedding_id is null and a.role_key = 'super_admin')), '[]'))
$$;

-- authz_context gains "denied" so a deny also blocks Flagsmith grant overrides.
create or replace function public.authz_context(p_user uuid, p_wedding uuid)
returns jsonb language plpgsql stable set search_path = public, authz as $$
declare
  v_status text; v_super boolean; v_weddings jsonb; v_selected uuid; v_roles text[];
begin
  select status into v_status from app_user where id = p_user;
  if not found then return null; end if;
  select exists (select 1 from authz.active_assignments(p_user) where role_key = 'super_admin') into v_super;
  select coalesce(jsonb_agg(jsonb_build_object('id', w.id, 'name', w.name, 'isDemo', w.is_demo, 'roles', w.roles) order by w.name), '[]')
    into v_weddings
    from (
      select wd.id, wd.name, wd.is_demo,
             coalesce((select jsonb_agg(distinct a.role_key) from authz.active_assignments(p_user) a where a.wedding_id = wd.id), '[]') as roles
        from wedding wd
       where v_super or exists (select 1 from authz.active_assignments(p_user) a where a.wedding_id = wd.id)
    ) w;
  select coalesce(
           (select (e->>'id')::uuid from jsonb_array_elements(v_weddings) e where (e->>'id')::uuid = p_wedding),
           (select (e->>'id')::uuid from jsonb_array_elements(v_weddings) e limit 1))
    into v_selected;
  select coalesce(array_agg(distinct a.role_key), '{}') into v_roles
    from authz.active_assignments(p_user) a
   where a.wedding_id = v_selected or (a.wedding_id is null and a.role_key = 'super_admin');
  return jsonb_build_object(
    'status', v_status, 'isSuperAdmin', v_super, 'weddings', v_weddings, 'weddingId', v_selected,
    'roles', to_jsonb(v_roles),
    'permissions', to_jsonb(case when v_selected is null then '{}'::text[] else authz.effective_permissions(p_user, v_selected) end),
    'denied', to_jsonb(case when v_selected is null then '{}'::text[] else authz.denied_permissions(p_user, v_selected) end));
end $$;

-- Last-super-admin guard: assignment status counts too.
create or replace function authz.active_super_admins() returns integer
language sql stable set search_path = public as $$
  select count(distinct ur.user_id)::int
    from user_role ur join role r on r.id = ur.role_id join app_user u on u.id = ur.user_id
   where r.key = 'super_admin' and u.status = 'active' and ur.status = 'active'
     and now() >= ur.starts_at and (ur.expires_at is null or now() < ur.expires_at)
$$;

create or replace function authz.guard_last_super_admin() returns trigger language plpgsql set search_path = public as $$
declare v_touched boolean := false;
begin
  if tg_table_name = 'user_role' then
    v_touched := exists (select 1 from role r where r.id = old.role_id and r.key = 'super_admin')
                 and old.status = 'active' and old.user_id is not null
                 and now() >= old.starts_at and (old.expires_at is null or now() < old.expires_at);
  elsif tg_table_name = 'app_user' then
    v_touched := old.status = 'active' and new.status <> 'active' and exists (
      select 1 from user_role ur join role r on r.id = ur.role_id
       where ur.user_id = old.id and r.key = 'super_admin' and ur.status = 'active'
         and now() >= ur.starts_at and (ur.expires_at is null or now() < ur.expires_at));
  end if;
  if v_touched and authz.active_super_admins() = 0 then raise exception 'LAST_SUPER_ADMIN'; end if;
  return null;
end $$;

-- ─── people functions (audited) ─────────────────────────────────────────────────────────────
-- p = {displayName, phone?, email?, title?, status?}
create or replace function people_upsert(p_actor uuid, p_wedding uuid, p_id uuid, p jsonb)
returns participant language plpgsql set search_path = public as $$
declare v participant;
begin
  if p_id is null then
    insert into participant(wedding_id, display_name, phone, email, title, created_by)
    values (p_wedding, trim(p->>'displayName'), nullif(p->>'phone', ''), nullif(lower(p->>'email'), ''), nullif(p->>'title', ''), p_actor)
    returning * into v;
    perform audit(p_wedding, p_actor, 'participant.create', v.id::text, jsonb_build_object('name', v.display_name));
  else
    update participant set
      display_name = coalesce(nullif(trim(p->>'displayName'), ''), display_name),
      phone = case when p ? 'phone' then nullif(p->>'phone', '') else phone end,
      email = case when p ? 'email' then nullif(lower(p->>'email'), '') else email end,
      title = case when p ? 'title' then nullif(p->>'title', '') else title end,
      status = coalesce(p->>'status', status),
      updated_at = now()
     where id = p_id and wedding_id = p_wedding returning * into v;
    if not found then raise exception 'NOT_FOUND'; end if;
    perform audit(p_wedding, p_actor, 'participant.update', v.id::text, p - 'phone' - 'email');
  end if;
  return v;
end $$;

-- Link a participant to a login (after invite): pending assignments become active.
create or replace function people_link_user(p_actor uuid, p_wedding uuid, p_participant uuid, p_user uuid)
returns participant language plpgsql set search_path = public as $$
declare v participant;
begin
  update participant set user_id = p_user, updated_at = now() where id = p_participant and wedding_id = p_wedding returning * into v;
  if not found then raise exception 'NOT_FOUND'; end if;
  update user_role set user_id = p_user,
         status = case when status = 'pending' then 'active' else status end
   where participant_id = p_participant;
  perform audit(p_wedding, p_actor, 'participant.link_user', p_participant::text, jsonb_build_object('user_id', p_user));
  return v;
end $$;

create or replace function people_assign(p_actor uuid, p_wedding uuid, p_participant uuid, p_role uuid, p_starts timestamptz, p_expires timestamptz)
returns user_role language plpgsql set search_path = public as $$
declare pt participant; v user_role;
begin
  select * into pt from participant where id = p_participant and wedding_id = p_wedding;
  if not found then raise exception 'NOT_FOUND'; end if;
  if exists (select 1 from role where id = p_role and key = 'super_admin') then raise exception 'BAD_REQUEST'; end if;
  insert into user_role(user_id, participant_id, role_id, wedding_id, starts_at, expires_at, created_by, status)
  values (pt.user_id, pt.id, p_role, p_wedding, coalesce(p_starts, now()), p_expires, p_actor, case when pt.user_id is null then 'pending' else 'active' end)
  returning * into v;
  perform audit(p_wedding, p_actor, 'assignment.create', v.id::text,
    jsonb_build_object('participant_id', pt.id, 'user_id', pt.user_id, 'role', (select key from role where id = p_role),
                       'starts_at', v.starts_at, 'expires_at', v.expires_at, 'status', v.status));
  return v;
end $$;

create or replace function assignment_set_status(p_actor uuid, p_assignment uuid, p_status text)
returns user_role language plpgsql set search_path = public as $$
declare v user_role;
begin
  if p_status not in ('active','suspended') then raise exception 'BAD_REQUEST'; end if;
  update user_role set status = p_status where id = p_assignment and status in ('active','suspended') returning * into v;
  if not found then raise exception 'INVALID_TRANSITION'; end if;
  perform audit(v.wedding_id, p_actor, case when p_status = 'suspended' then 'assignment.suspend' else 'assignment.reactivate' end, v.id::text);
  return v;
end $$;

create or replace function assignment_set_override(p_actor uuid, p_assignment uuid, p_key text, p_deny boolean)
returns void language plpgsql set search_path = public as $$
declare v_wedding uuid;
begin
  select wedding_id into v_wedding from user_role where id = p_assignment;
  if not found then raise exception 'NOT_FOUND'; end if;
  if not exists (select 1 from permission where key = p_key) then raise exception 'BAD_REQUEST'; end if;
  if p_deny then
    insert into user_permission_override(assignment_id, permission_key, created_by) values (p_assignment, p_key, p_actor) on conflict do nothing;
  else
    delete from user_permission_override where assignment_id = p_assignment and permission_key = p_key;
  end if;
  perform audit(v_wedding, p_actor, case when p_deny then 'override.deny' else 'override.remove' end, p_assignment::text, jsonb_build_object('permission', p_key));
end $$;

-- Clone a system template (or any role) into a wedding-specific role with a unique key.
create or replace function role_clone(p_actor uuid, p_wedding uuid, p_source uuid, p_name text)
returns role language plpgsql set search_path = public as $$
declare src role; v role; v_key text;
begin
  select * into src from role where id = p_source;
  if not found then raise exception 'NOT_FOUND'; end if;
  if src.key = 'super_admin' then raise exception 'SYSTEM_ROLE'; end if;
  if src.wedding_id is not null and src.wedding_id <> p_wedding then raise exception 'NOT_FOUND'; end if;
  v_key := left(regexp_replace(lower(coalesce(nullif(trim(p_name), ''), src.key)), '[^a-z0-9]+', '_', 'g'), 24) || '_' || substr(md5(random()::text), 1, 6);
  insert into role(key, name, description, is_system, wedding_id, cloned_from)
  values (v_key, coalesce(nullif(trim(p_name), ''), src.name || ' (copy)'), src.description, false, p_wedding, src.id)
  returning * into v;
  insert into role_permission(role_id, permission_key) select v.id, permission_key from role_permission where role_id = src.id;
  perform audit(p_wedding, p_actor, 'role.clone', v.id::text, jsonb_build_object('from', src.key, 'key', v_key));
  return v;
end $$;

-- Edit a wedding-specific role (users.manage in that wedding). Platform-level keys are refused.
create or replace function role_set_wedding_permissions(p_actor uuid, p_wedding uuid, p_role uuid, p_name text, p_permissions text[])
returns role language plpgsql set search_path = public as $$
declare v role; v_before text[];
begin
  select * into v from role where id = p_role and wedding_id = p_wedding for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if exists (select 1 from unnest(coalesce(p_permissions, '{}')) k where k not in (select key from permission) or k in ('roles.manage','weddings.manage')) then
    raise exception 'BAD_REQUEST';
  end if;
  select coalesce(array_agg(permission_key order by permission_key), '{}') into v_before from role_permission where role_id = p_role;
  delete from role_permission where role_id = p_role;
  insert into role_permission(role_id, permission_key) select p_role, unnest(coalesce(p_permissions, '{}')) on conflict do nothing;
  if nullif(trim(p_name), '') is not null then update role set name = trim(p_name) where id = p_role returning * into v; end if;
  perform audit(p_wedding, p_actor, 'role.permissions', p_role::text,
    jsonb_build_object('key', v.key, 'before', to_jsonb(v_before), 'after', to_jsonb(coalesce(p_permissions, '{}'))));
  return v;
end $$;

-- Nightly: flip assignments whose window ended (request-time checks already enforce expiry).
create or replace function expire_assignments()
returns integer language plpgsql set search_path = public as $$
declare n integer;
begin
  update user_role set status = 'expired'
   where status in ('active','pending','suspended') and expires_at is not null and expires_at <= now()
     and not exists (select 1 from role r where r.id = role_id and r.key = 'super_admin');  -- guard keeps the last one
  get diagnostics n = row_count;
  if n > 0 then
    insert into audit_log(action, data) values ('assignment.expire_batch', jsonb_build_object('count', n));
  end if;
  return n;
end $$;

-- Assignments made through the Stage 2 admin API (user, no participant) get their participant.
create or replace function people_attach_participant() returns trigger language plpgsql set search_path = public as $$
declare v_id uuid;
begin
  if new.participant_id is null and new.user_id is not null and new.wedding_id is not null then
    select id into v_id from participant where wedding_id = new.wedding_id and user_id = new.user_id;
    if v_id is null then
      insert into participant(wedding_id, display_name, email, user_id)
      select new.wedding_id, coalesce(u.display_name, split_part(u.email, '@', 1)), u.email, u.id from app_user u where u.id = new.user_id
      on conflict (wedding_id, user_id) do update set updated_at = now()
      returning id into v_id;
    end if;
    new.participant_id := v_id;
  end if;
  return new;
end $$;
create trigger user_role_attach_participant before insert on user_role
  for each row execute function people_attach_participant();

-- Notification recipients: active logins holding one of the roles in a wedding right now.
create or replace function wedding_role_users(p_wedding uuid, p_roles text[])
returns table(user_id uuid, role_key text) language sql stable set search_path = public as $$
  select distinct ur.user_id, r.key
    from user_role ur join role r on r.id = ur.role_id join app_user u on u.id = ur.user_id
   where ur.wedding_id = p_wedding and r.key = any(p_roles) and ur.status = 'active' and u.status = 'active'
     and now() >= ur.starts_at and (ur.expires_at is null or now() < ur.expires_at)
$$;

-- Backfill: every existing login with a role becomes a participant of that wedding.
insert into participant(wedding_id, display_name, email, user_id)
select distinct on (ur.wedding_id, u.id) ur.wedding_id, coalesce(u.display_name, split_part(u.email, '@', 1)), u.email, u.id
  from user_role ur join app_user u on u.id = ur.user_id
 where ur.wedding_id is not null
on conflict (wedding_id, user_id) do nothing;
update user_role ur set participant_id = p.id
  from participant p where p.user_id = ur.user_id and p.wedding_id = ur.wedding_id and ur.participant_id is null;

do $$
begin
  revoke execute on all functions in schema authz from public;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on all functions in schema authz to service_role';
  end if;
end $$;

select lock_down_public();
