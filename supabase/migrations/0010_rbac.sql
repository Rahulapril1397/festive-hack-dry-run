-- 0010_rbac.sql — Stage 2 (E1): Postgres-backed RBAC replaces the static role map.
--   permission catalogue · system roles with default permission sets · time-boxed assignments ·
--   user suspension · authz.has_permission() · "last super admin" guard.
-- The TypeScript fixture src/lib/authz/staticMap.ts must equal the defaults seeded here
-- (tests/integration/rbac.test.ts checks it).

create schema if not exists authz;
revoke all on schema authz from public;

-- ─── users ──────────────────────────────────────────────────────────────────────────────────
alter table app_user
  add column if not exists status       text not null default 'active' check (status in ('active','suspended')),
  add column if not exists language     app_language not null default 'en',
  add column if not exists invited_at   timestamptz,
  add column if not exists suspended_at timestamptz,
  add column if not exists last_seen_at timestamptz;

-- ─── roles ──────────────────────────────────────────────────────────────────────────────────
alter table role
  add column if not exists is_system   boolean not null default false,
  add column if not exists description text,
  add column if not exists created_at  timestamptz not null default now();

update role set key = 'stage_manager', name = 'Stage manager' where key = 'stage';
insert into role(key, name) values ('coordinator', 'Coordinator'), ('super_admin', 'Super admin')
  on conflict (key) do nothing;
update role set is_system = true
 where key in ('host','stage_manager','kitchen','photographer','coordinator','admin','finance','super_admin');
update role set description = case key
  when 'super_admin'   then 'Platform owner: every wedding, roles and weddings'
  when 'admin'         then 'Runs one wedding: users, audit, integrations and every screen'
  when 'host'          then 'The family hosting: overview, families, RSVP, ledger totals'
  when 'coordinator'   then 'Wedding planner: families, RSVP, check-in desk, kitchen view'
  when 'stage_manager' then 'Runs the stage queue and check-in desk'
  when 'kitchen'       then 'Plates and arrivals only'
  when 'photographer'  then 'Uploads, calibrates and reviews photos'
  when 'finance'       then 'Shagun ledger'
end where is_system;

-- ─── permission catalogue ───────────────────────────────────────────────────────────────────
-- Stage 1 used family.read / family.write / rsvp.write; Stage 2 names them families.* / rsvp.manage.
delete from role_permission where permission_key in ('family.read','family.write','rsvp.write','users.manage_legacy');
delete from permission where key in ('family.read','family.write','rsvp.write');

insert into permission(key, description) values
  ('queue.read',       'See the stage console and waiting list (includes family names)'),
  ('queue.call_next',  'CALL NEXT'),
  ('queue.manage',     'Pause, resume, on stage, served, no-show'),
  ('queue.skip',       'Skip a family (stage managers receive it through the Flagsmith override)'),
  ('queue.checkin',    'Check-in desk: lookup, desk check-in, walk-ins'),
  ('clock.read',       'Clock QR for photographer calibration'),
  ('host.read',        'Host overview and functions'),
  ('families.read',    'Families list (phone shown as last 4 digits)'),
  ('families.write',   'Add, import families; rotate family links'),
  ('event.write',      'Create functions'),
  ('rsvp.read',        'RSVP counts'),
  ('rsvp.manage',      'Edit an RSVP on behalf of a family'),
  ('photos.upload',    'Upload and calibrate photo batches'),
  ('photos.review',    'Confirm or reject photo matches; album'),
  ('kitchen.read',     'Plates and arrivals'),
  ('kitchen.write',    'Meal status'),
  ('ledger.read',      'Shagun amounts and totals'),
  ('ledger.write',     'Add, reverse, reconcile ledger entries'),
  ('ledger.export',    'Export the ledger as CSV'),
  ('users.manage',     'Invite, suspend users; assign roles in the wedding'),
  ('roles.manage',     'Create roles and edit role permissions (all weddings)'),
  ('weddings.manage',  'Create weddings'),
  ('audit.read',       'Read the audit log'),
  ('ops.approve',      'Approve NudgeBee recommendations'),
  ('integrations.read','Integration status (TTS, flags, recommendations)'),
  ('assistant.use',    'Use the PinkyBua assistant')
on conflict (key) do update set description = excluded.description;

-- Default permission sets (spec §3.2 as interpreted for Stage 2). Re-running resets system roles.
with defaults(role_key, keys) as (values
  ('super_admin',   (select array_agg(key) from permission)),
  ('admin',         (select array_agg(key) from permission where key not in ('roles.manage','weddings.manage'))),
  ('host',          array['host.read','queue.read','queue.checkin','families.read','families.write','event.write','rsvp.read','rsvp.manage','photos.review','kitchen.read','ledger.read','integrations.read','assistant.use']),
  ('coordinator',   array['host.read','queue.read','queue.checkin','families.read','rsvp.read','rsvp.manage','photos.review','kitchen.read','assistant.use']),
  ('stage_manager', array['queue.read','queue.call_next','queue.manage','queue.checkin','clock.read','assistant.use']),
  ('kitchen',       array['kitchen.read','kitchen.write','assistant.use']),
  ('photographer',  array['clock.read','photos.upload','photos.review','assistant.use']),
  ('finance',       array['ledger.read','ledger.write','ledger.export','families.read','assistant.use'])
), cleared as (
  delete from role_permission rp using role r where rp.role_id = r.id and r.key in (select role_key from defaults)
)
insert into role_permission(role_id, permission_key)
select r.id, unnest(d.keys) from defaults d join role r on r.key = d.role_key
on conflict do nothing;

-- ─── assignments (user_role) ────────────────────────────────────────────────────────────────
alter table user_role
  add column if not exists id         uuid not null default gen_random_uuid(),
  add column if not exists starts_at  timestamptz not null default now(),
  add column if not exists expires_at timestamptz,
  add column if not exists created_by uuid,
  add column if not exists created_at timestamptz not null default now();
alter table user_role drop constraint if exists user_role_pkey;
alter table user_role add primary key (id);
alter table user_role alter column wedding_id drop not null;
alter table user_role add constraint user_role_window check (expires_at is null or expires_at > starts_at);
create unique index if not exists user_role_unique
  on user_role(user_id, role_id, coalesce(wedding_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index if not exists user_role_user_idx on user_role(user_id);

-- Only super_admin assignments may be wedding-less; super_admin is always wedding-less.
create or replace function authz.check_assignment() returns trigger language plpgsql as $$
declare v_key text;
begin
  select key into v_key from public.role where id = new.role_id;
  if v_key = 'super_admin' and new.wedding_id is not null then raise exception 'BAD_REQUEST'; end if;
  if v_key <> 'super_admin' and new.wedding_id is null then raise exception 'BAD_REQUEST'; end if;
  return new;
end $$;
drop trigger if exists user_role_check on user_role;
create trigger user_role_check before insert or update on user_role
  for each row execute function authz.check_assignment();

-- ─── resolver ───────────────────────────────────────────────────────────────────────────────
-- Guide §5.3: active user · active assignment window · role permission · wedding match ·
-- super_admin is wedding-less and applies everywhere.
create or replace function authz.active_assignments(p_user uuid)
returns table(assignment_id uuid, role_id uuid, role_key text, wedding_id uuid)
language sql stable set search_path = public as $$
  select ur.id, r.id, r.key, ur.wedding_id
    from user_role ur
    join role r on r.id = ur.role_id
    join app_user u on u.id = ur.user_id
   where ur.user_id = p_user and u.status = 'active'
     and now() >= ur.starts_at and (ur.expires_at is null or now() < ur.expires_at)
$$;

create or replace function authz.effective_permissions(p_user uuid, p_wedding uuid)
returns text[] language sql stable set search_path = public as $$
  select coalesce(array_agg(distinct rp.permission_key order by rp.permission_key), '{}')
    from authz.active_assignments(p_user) a
    join role_permission rp on rp.role_id = a.role_id
   where a.wedding_id = p_wedding or (a.wedding_id is null and a.role_key = 'super_admin')
$$;

create or replace function authz.user_has_permission(p_user uuid, p_wedding uuid, p_key text)
returns boolean language sql stable set search_path = public as $$
  select p_key = any(authz.effective_permissions(p_user, p_wedding))
$$;

-- For RLS / PostgREST callers: the JWT subject (what auth.uid() returns on Supabase).
create or replace function authz.has_permission(p_wedding uuid, p_key text)
returns boolean language sql stable security definer set search_path = public, authz as $$
  select authz.user_has_permission(
    nullif(coalesce(current_setting('request.jwt.claim.sub', true),
                    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')), '')::uuid,
    p_wedding, p_key)
$$;

-- One call per request: who the user is, which weddings they can open, their roles and
-- permissions in the selected wedding (p_wedding, else the first accessible one).
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
    'status', v_status,
    'isSuperAdmin', v_super,
    'weddings', v_weddings,
    'weddingId', v_selected,
    'roles', to_jsonb(v_roles),
    'permissions', to_jsonb(case when v_selected is null then '{}'::text[] else authz.effective_permissions(p_user, v_selected) end));
end $$;

create or replace function public.authz_permissions(p_user uuid, p_wedding uuid)
returns jsonb language sql stable set search_path = public, authz as $$
  select jsonb_build_object(
    'permissions', to_jsonb(authz.effective_permissions(p_user, p_wedding)),
    'roles', coalesce((select jsonb_agg(distinct a.role_key) from authz.active_assignments(p_user) a
                        where a.wedding_id = p_wedding or (a.wedding_id is null and a.role_key = 'super_admin')), '[]'))
$$;

-- ─── last super admin guard ─────────────────────────────────────────────────────────────────
create or replace function authz.active_super_admins() returns integer
language sql stable set search_path = public as $$
  select count(distinct ur.user_id)::int
    from user_role ur join role r on r.id = ur.role_id join app_user u on u.id = ur.user_id
   where r.key = 'super_admin' and u.status = 'active'
     and now() >= ur.starts_at and (ur.expires_at is null or now() < ur.expires_at)
$$;

-- Fires only when the change touched an active super_admin, so systems with none can still work.
create or replace function authz.guard_last_super_admin() returns trigger language plpgsql set search_path = public as $$
declare v_touched boolean := false;
begin
  if tg_table_name = 'user_role' then
    v_touched := exists (select 1 from role r where r.id = old.role_id and r.key = 'super_admin')
                 and now() >= old.starts_at and (old.expires_at is null or now() < old.expires_at);
  elsif tg_table_name = 'app_user' then
    v_touched := old.status = 'active' and new.status <> 'active' and exists (
      select 1 from user_role ur join role r on r.id = ur.role_id
       where ur.user_id = old.id and r.key = 'super_admin'
         and now() >= ur.starts_at and (ur.expires_at is null or now() < ur.expires_at));
  end if;
  if v_touched and authz.active_super_admins() = 0 then
    raise exception 'LAST_SUPER_ADMIN';
  end if;
  return null;
end $$;
drop trigger if exists user_role_last_super_admin on user_role;
create trigger user_role_last_super_admin after update or delete on user_role
  for each row execute function authz.guard_last_super_admin();
drop trigger if exists app_user_last_super_admin on app_user;
create trigger app_user_last_super_admin after update of status on app_user
  for each row execute function authz.guard_last_super_admin();

-- Stage 1 helper, replaced by authz_context.
drop function if exists public.session_role(uuid);

do $$
begin
  revoke execute on all functions in schema authz from public;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant usage on schema authz to service_role';
    execute 'grant execute on all functions in schema authz to service_role';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    -- has_permission() is the one function RLS policies may call as the signed-in user.
    execute 'grant usage on schema authz to authenticated';
    execute 'grant execute on function authz.has_permission(uuid, text) to authenticated';
  end if;
end $$;

select lock_down_public();
