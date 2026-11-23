-- 0011_admin.sql — Stage 2 (E1): audited admin mutations, real weddings without seed data,
-- family CSV import and link rotation. Every function = one transaction + one audit_log row.
-- Codes: NOT_FOUND, BAD_REQUEST, ROLE_EXISTS, SYSTEM_ROLE, LAST_SUPER_ADMIN (from 0010 triggers).

alter table family add column if not exists headcount_max integer check (headcount_max between 0 and 20);

-- audit_log: entity (= target) + details (= data) per the Stage 2 contract; kept as views of the
-- Stage 1 columns so existing writers keep working.
create index if not exists audit_log_wedding_id_idx on audit_log(wedding_id, id desc);
create index if not exists audit_log_actor_idx on audit_log(actor, id desc);
create index if not exists audit_log_action_idx on audit_log(action, id desc);

create or replace function audit(p_wedding uuid, p_actor uuid, p_action text, p_entity text, p_details jsonb default '{}')
returns void language sql set search_path = public as $$
  insert into audit_log(wedding_id, actor, action, target, data) values (p_wedding, p_actor, p_action, p_entity, coalesce(p_details, '{}'));
$$;

-- ─── users ──────────────────────────────────────────────────────────────────────────────────
-- Called after Supabase Auth created/invited the auth user (id = auth.users.id).
create or replace function admin_upsert_user(p_actor uuid, p_wedding uuid, p_user uuid, p_email text, p_name text)
returns app_user language plpgsql set search_path = public as $$
declare v app_user;
begin
  insert into app_user(id, email, display_name, invited_at)
  values (p_user, lower(p_email), nullif(trim(p_name), ''), now())
  on conflict (id) do update set email = excluded.email,
    display_name = coalesce(excluded.display_name, app_user.display_name)
  returning * into v;
  perform audit(p_wedding, p_actor, 'user.invite', p_user::text, jsonb_build_object('email', lower(p_email)));
  return v;
end $$;

create or replace function admin_set_user_status(p_actor uuid, p_wedding uuid, p_user uuid, p_status text)
returns app_user language plpgsql set search_path = public as $$
declare v app_user;
begin
  if p_status not in ('active','suspended') then raise exception 'BAD_REQUEST'; end if;
  update app_user set status = p_status,
         suspended_at = case when p_status = 'suspended' then now() else null end
   where id = p_user returning * into v;
  if not found then raise exception 'NOT_FOUND'; end if;
  perform audit(p_wedding, p_actor, case when p_status = 'suspended' then 'user.suspend' else 'user.reactivate' end, p_user::text);
  return v;
end $$;

-- ─── assignments ────────────────────────────────────────────────────────────────────────────
create or replace function admin_assign(p_actor uuid, p_user uuid, p_wedding uuid, p_role uuid,
                                        p_starts timestamptz, p_expires timestamptz)
returns user_role language plpgsql set search_path = public as $$
declare v user_role;
begin
  if not exists (select 1 from app_user where id = p_user) then raise exception 'NOT_FOUND'; end if;
  if not exists (select 1 from role where id = p_role) then raise exception 'NOT_FOUND'; end if;
  if p_wedding is not null and not exists (select 1 from wedding where id = p_wedding) then raise exception 'NOT_FOUND'; end if;
  insert into user_role(user_id, role_id, wedding_id, starts_at, expires_at, created_by)
  values (p_user, p_role, p_wedding, coalesce(p_starts, now()), p_expires, p_actor)
  on conflict (user_id, role_id, coalesce(wedding_id, '00000000-0000-0000-0000-000000000000'::uuid))
  do update set starts_at = excluded.starts_at, expires_at = excluded.expires_at, created_by = excluded.created_by
  returning * into v;
  perform audit(p_wedding, p_actor, 'assignment.create', v.id::text,
    jsonb_build_object('user_id', p_user, 'role', (select key from role where id = p_role), 'starts_at', v.starts_at, 'expires_at', v.expires_at));
  return v;
end $$;

create or replace function admin_unassign(p_actor uuid, p_assignment uuid)
returns void language plpgsql set search_path = public as $$
declare v user_role;
begin
  delete from user_role where id = p_assignment returning * into v;   -- LAST_SUPER_ADMIN trigger may refuse
  if not found then raise exception 'NOT_FOUND'; end if;
  perform audit(v.wedding_id, p_actor, 'assignment.delete', p_assignment::text,
    jsonb_build_object('user_id', v.user_id, 'role', (select key from role where id = v.role_id)));
end $$;

-- ─── roles ──────────────────────────────────────────────────────────────────────────────────
create or replace function admin_create_role(p_actor uuid, p_key text, p_name text, p_description text, p_permissions text[])
returns role language plpgsql set search_path = public as $$
declare v role;
begin
  if p_key !~ '^[a-z][a-z0-9_]{2,39}$' then raise exception 'BAD_REQUEST'; end if;
  if exists (select 1 from role where key = p_key) then raise exception 'ROLE_EXISTS'; end if;
  if exists (select 1 from unnest(coalesce(p_permissions, '{}')) k where k not in (select key from permission)) then
    raise exception 'BAD_REQUEST';
  end if;
  insert into role(key, name, description, is_system) values (p_key, p_name, p_description, false) returning * into v;
  insert into role_permission(role_id, permission_key) select v.id, unnest(coalesce(p_permissions, '{}')) on conflict do nothing;
  perform audit(null, p_actor, 'role.create', v.id::text, jsonb_build_object('key', p_key, 'permissions', to_jsonb(coalesce(p_permissions, '{}'))));
  return v;
end $$;

create or replace function admin_set_role_permissions(p_actor uuid, p_role uuid, p_permissions text[])
returns text[] language plpgsql set search_path = public as $$
declare v_key text; v_before text[];
begin
  select key into v_key from role where id = p_role;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_key = 'super_admin' then raise exception 'SYSTEM_ROLE'; end if;   -- would lock everyone out
  if exists (select 1 from unnest(coalesce(p_permissions, '{}')) k where k not in (select key from permission)) then
    raise exception 'BAD_REQUEST';
  end if;
  select coalesce(array_agg(permission_key order by permission_key), '{}') into v_before from role_permission where role_id = p_role;
  delete from role_permission where role_id = p_role;
  insert into role_permission(role_id, permission_key) select p_role, unnest(coalesce(p_permissions, '{}')) on conflict do nothing;
  perform audit(null, p_actor, 'role.permissions', p_role::text,
    jsonb_build_object('key', v_key, 'before', to_jsonb(v_before), 'after', to_jsonb(coalesce(p_permissions, '{}'))));
  return p_permissions;
end $$;

-- ─── weddings ───────────────────────────────────────────────────────────────────────────────
-- p_wedding = {name, coupleNames?, weddingDate?, contactPhone?, invitationText?}
-- p_events  = [{name, startsAt?, language?}]
create or replace function admin_create_wedding(p_actor uuid, p_wedding jsonb, p_events jsonb, p_host_user uuid)
returns jsonb language plpgsql set search_path = public as $$
declare v_id uuid; e jsonb; v_events jsonb := '[]';
begin
  if coalesce(trim(p_wedding->>'name'), '') = '' then raise exception 'BAD_REQUEST'; end if;
  insert into wedding(name, is_demo, couple_names, wedding_date, contact_phone, invitation_text)
  values (trim(p_wedding->>'name'), false, nullif(trim(p_wedding->>'coupleNames'), ''),
          nullif(p_wedding->>'weddingDate', '')::date, nullif(trim(p_wedding->>'contactPhone'), ''),
          nullif(trim(p_wedding->>'invitationText'), ''))
  returning id into v_id;
  for e in select * from jsonb_array_elements(coalesce(p_events, '[]')) loop
    if coalesce(trim(e->>'name'), '') = '' then raise exception 'BAD_REQUEST'; end if;
    with ins as (
      insert into event(wedding_id, name, starts_at, language)
      values (v_id, trim(e->>'name'), nullif(e->>'startsAt', '')::timestamptz, coalesce(nullif(e->>'language', ''), 'en')::app_language)
      returning id, name)
    select v_events || jsonb_build_object('id', ins.id, 'name', ins.name) into v_events from ins;
  end loop;
  if p_host_user is not null then
    if not exists (select 1 from app_user where id = p_host_user) then raise exception 'NOT_FOUND'; end if;
    insert into user_role(user_id, role_id, wedding_id, created_by)
    select p_host_user, id, v_id, p_actor from role where key = 'host';
  end if;
  perform audit(v_id, p_actor, 'wedding.create', v_id::text,
    jsonb_build_object('events', jsonb_array_length(v_events), 'host_user', p_host_user));
  return jsonb_build_object('weddingId', v_id, 'events', v_events);
end $$;

-- ─── families ───────────────────────────────────────────────────────────────────────────────
-- p_rows = [{row, name, phone|null, language, headcountMax|null, code}] — already normalised and
-- validated per row by the API; codes are generated server-side. Duplicate phones (already in the
-- wedding, or earlier in the same file) become row errors; the rest of the batch still imports.
create or replace function families_import(p_actor uuid, p_wedding uuid, p_rows jsonb)
returns jsonb language plpgsql set search_path = public, extensions as $$
declare r jsonb; v_id uuid; v_link text; v_out jsonb := '[]'; v_ok int := 0; v_err int := 0;
begin
  if not exists (select 1 from wedding where id = p_wedding) then raise exception 'NOT_FOUND'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    if nullif(r->>'phone', '') is not null
       and exists (select 1 from family where wedding_id = p_wedding and phone = r->>'phone') then
      v_out := v_out || jsonb_build_object('row', r->'row', 'status', 'error', 'error', 'Phone already belongs to a family in this wedding');
      v_err := v_err + 1;
      continue;
    end if;
    insert into family(wedding_id, name, phone, language, headcount_max)
    values (p_wedding, r->>'name', nullif(r->>'phone', ''), coalesce(nullif(r->>'language', ''), 'en')::app_language,
            nullif(r->>'headcountMax', '')::int)
    returning id, link_key into v_id, v_link;
    perform set_checkin_code(v_id, r->>'code');
    insert into rsvp(family_id, event_id) select v_id, id from event where wedding_id = p_wedding on conflict do nothing;
    v_out := v_out || jsonb_build_object('row', r->'row', 'status', 'created', 'familyId', v_id, 'linkKey', v_link);
    v_ok := v_ok + 1;
  end loop;
  perform audit(p_wedding, p_actor, 'families.import', p_wedding::text, jsonb_build_object('created', v_ok, 'errors', v_err));
  return v_out;
end $$;

create or replace function family_rotate_link(p_actor uuid, p_wedding uuid, p_family uuid)
returns text language plpgsql set search_path = public as $$
declare v_link text;
begin
  update family set link_key = replace(gen_random_uuid()::text, '-', '')
   where id = p_family and wedding_id = p_wedding returning link_key into v_link;
  if not found then raise exception 'NOT_FOUND'; end if;
  perform audit(p_wedding, p_actor, 'family.rotate_link', p_family::text);
  return v_link;
end $$;

-- Staff edits an RSVP on behalf of a family (rsvp.manage); same rules as the guest's rsvp_save.
create or replace function rsvp_save_by_staff(p_actor uuid, p_wedding uuid, p_family uuid, p_rsvps jsonb)
returns setof rsvp language plpgsql set search_path = public as $$
begin
  if not exists (select 1 from family where id = p_family and wedding_id = p_wedding) then raise exception 'NOT_FOUND'; end if;
  perform audit(p_wedding, p_actor, 'rsvp.edit_on_behalf', p_family::text, jsonb_build_object('events', jsonb_array_length(p_rsvps)));
  return query select * from rsvp_save(p_family, p_rsvps);
end $$;

select lock_down_public();
