-- 0201_views.sql — E3: kitchen plates view and meal status.

create table meal_status (
  event_id    uuid primary key references event(id) on delete cascade,
  status      text not null default 'not_started' check (status in ('not_started','serving','closed')),
  updated_by  uuid,
  updated_at  timestamptz not null default now()
);

-- Per event: planned plates (sum of attending headcount) and arrivals (check-ins). No PII.
create or replace view v_event_plates with (security_invoker = true) as
select e.id as event_id, e.wedding_id, e.name, e.starts_at,
       coalesce((select sum(r.headcount) from rsvp r where r.event_id = e.id and r.status = 'yes'), 0)::int as planned_plates,
       (select count(*) from rsvp r where r.event_id = e.id and r.status = 'yes')::int                   as attending_families,
       (select count(*) from checkin c where c.event_id = e.id)::int                                     as arrived_families,
       coalesce((select sum(case when r.status = 'yes' then r.headcount else 1 end)
                   from checkin c left join rsvp r on r.family_id = c.family_id and r.event_id = c.event_id
                  where c.event_id = e.id), 0)::int                                                       as arrived_guests_est,
       coalesce(ms.status, 'not_started') as meal_status
  from event e
  left join meal_status ms on ms.event_id = e.id;

create or replace function meal_status_set(p_event uuid, p_actor uuid, p_status text)
returns meal_status language plpgsql set search_path = public, extensions as $$
declare v meal_status; v_wedding uuid;
begin
  select wedding_id into v_wedding from event where id = p_event;
  if not found then raise exception 'EVENT_NOT_FOUND'; end if;
  if p_status not in ('not_started','serving','closed') then raise exception 'BAD_REQUEST'; end if;
  insert into meal_status(event_id, status, updated_by, updated_at) values (p_event, p_status, p_actor, now())
  on conflict (event_id) do update set status = excluded.status, updated_by = excluded.updated_by, updated_at = now()
  returning * into v;
  insert into audit_log(wedding_id, actor, action, target, data)
  values (v_wedding, p_actor, 'kitchen.meal_status', p_event::text, jsonb_build_object('status', p_status));
  return v;
end $$;

-- Host actions: add a family (returns the one-time check-in code) and create a function.
create or replace function host_add_family(p_wedding uuid, p_actor uuid, p_name text, p_phone text, p_language app_language)
returns jsonb language plpgsql set search_path = public, extensions as $$
declare v_id uuid; v_code text := lpad((floor(random() * 9000) + 1000)::int::text, 4, '0'); v_link text;
begin
  if p_phone is not null and exists (select 1 from family where wedding_id = p_wedding and phone = p_phone) then
    raise exception 'FAMILY_EXISTS';
  end if;
  insert into family(wedding_id, name, phone, language) values (p_wedding, p_name, p_phone, coalesce(p_language, 'en'))
  returning id, link_key into v_id, v_link;
  perform set_checkin_code(v_id, v_code);
  insert into rsvp(family_id, event_id) select v_id, id from event where wedding_id = p_wedding;
  insert into audit_log(wedding_id, actor, action, target) values (p_wedding, p_actor, 'family.add', v_id::text);
  return jsonb_build_object('familyId', v_id, 'code', v_code, 'linkKey', v_link);
end $$;

create or replace function host_create_event(p_wedding uuid, p_actor uuid, p_name text, p_starts_at timestamptz, p_language app_language)
returns event language plpgsql set search_path = public, extensions as $$
declare v event;
begin
  insert into event(wedding_id, name, starts_at, language) values (p_wedding, p_name, p_starts_at, coalesce(p_language, 'en'))
  returning * into v;
  insert into rsvp(family_id, event_id) select id, v.id from family where wedding_id = p_wedding;
  insert into audit_log(wedding_id, actor, action, target) values (p_wedding, p_actor, 'event.create', v.id::text);
  return v;
end $$;

select lock_down_public();
