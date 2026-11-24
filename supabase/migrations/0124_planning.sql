-- 0124_planning.sql — wedding planning (E2/E3 shared): rooms and allocation, driver pickups, the
-- venue/station/airport names, planning settings, and the link from a vendor to its own login.
-- Permissions: planning.read (see the plan), planning.write (rooms, drivers, settings), vendor.portal (a vendor's own bookings).

alter table wedding
  add column if not exists venue_name   text check (venue_name is null or length(venue_name) <= 120),
  add column if not exists venue_city   text check (venue_city is null or length(venue_city) <= 80),
  add column if not exists station_name text check (station_name is null or length(station_name) <= 120),
  add column if not exists airport_name text check (airport_name is null or length(airport_name) <= 120),
  add column if not exists plan_settings jsonb not null default '{}'::jsonb;

alter table guest_profile add column if not exists departure_at timestamptz;

alter table vendor add column if not exists login_user_id uuid references app_user(id) on delete set null;
create unique index if not exists vendor_login_uidx on vendor(login_user_id) where login_user_id is not null;

create table if not exists room (
  id          uuid primary key default gen_random_uuid(),
  wedding_id  uuid not null references wedding(id) on delete cascade,
  block       text not null default '' check (length(block) <= 40),
  floor       text check (floor is null or length(floor) <= 20),
  label       text not null check (length(trim(label)) between 1 and 20),
  capacity    integer not null default 6 check (capacity between 1 and 20),
  beds        integer not null default 2 check (beds between 0 and 20),
  created_at  timestamptz not null default now(),
  unique (wedding_id, block, label)
);

-- One family per room; a big family holds several rooms.
create table if not exists room_allocation (
  room_id      uuid primary key references room(id) on delete cascade,
  family_id    uuid not null references family(id) on delete cascade,
  assigned_by  uuid,
  assigned_at  timestamptz not null default now()
);
create index if not exists room_allocation_family_idx on room_allocation(family_id);

-- The driver the admin assigned to meet a family; the family sees name, number and vehicle.
create table if not exists pickup_assignment (
  family_id     uuid primary key references family(id) on delete cascade,
  vendor_id     uuid references vendor(id) on delete set null,
  driver_name   text not null check (length(trim(driver_name)) between 2 and 80),
  driver_phone  text not null check (driver_phone ~ '^[0-9]{10}$'),
  vehicle       text check (vehicle is null or length(vehicle) <= 40),
  assigned_by   uuid,
  updated_at    timestamptz not null default now()
);

-- People per family: what they said is travelling, else the largest attending headcount. Families not attending anything are left out.
create or replace view v_family_people with (security_invoker = true) as
select f.id as family_id, f.wedding_id, f.name,
       coalesce(gp.arriving_count, r.max_yes, 0)::int as people
  from family f
  join (select family_id, max(headcount) as max_yes from rsvp where status = 'yes' group by family_id) r on r.family_id = f.id
  left join guest_profile gp on gp.family_id = f.id;

-- Give unallocated families rooms, filling free rooms in block / floor / label order. Families stay together:
-- a family takes as many whole rooms as its people need. Families that do not fit are returned, not partly placed.
create or replace function rooms_autoallocate(p_wedding uuid, p_actor uuid)
returns jsonb language plpgsql set search_path = public as $$
declare
  fam record; free_ids uuid[]; take uuid[]; cap integer; i integer;
  placed integer := 0; used integer := 0; missing jsonb := '[]'::jsonb;
begin
  perform 1 from wedding where id = p_wedding for update;   -- one allocation run at a time
  for fam in
    select v.family_id, v.name, v.people from v_family_people v
     where v.wedding_id = p_wedding and v.people > 0
       and not exists (select 1 from room_allocation a where a.family_id = v.family_id)
     order by v.people desc, v.name
  loop
    select array_agg(id order by block, floor nulls last, label) into free_ids
      from room r where r.wedding_id = p_wedding and not exists (select 1 from room_allocation a where a.room_id = r.id);
    take := '{}'; cap := 0;
    for i in 1 .. coalesce(array_length(free_ids, 1), 0) loop
      exit when cap >= fam.people;
      take := take || free_ids[i];
      cap := cap + (select capacity from room where id = free_ids[i]);
    end loop;
    if cap >= fam.people and array_length(take, 1) is not null then
      insert into room_allocation(room_id, family_id, assigned_by) select unnest(take), fam.family_id, p_actor;
      placed := placed + 1; used := used + array_length(take, 1);
    else
      missing := missing || jsonb_build_array(jsonb_build_object('family', fam.name, 'people', fam.people));
    end if;
  end loop;
  insert into audit_log(wedding_id, actor, action, target, data)
  values (p_wedding, p_actor, 'rooms.autoallocate', p_wedding::text, jsonb_build_object('families', placed, 'rooms', used, 'unplaced', jsonb_array_length(missing)));
  return jsonb_build_object('families', placed, 'rooms', used, 'unplaced', missing);
end $$;

-- Put a room with a family (moving it if another family had it), or free it (family null).
create or replace function room_assign(p_wedding uuid, p_actor uuid, p_room uuid, p_family uuid)
returns void language plpgsql set search_path = public as $$
begin
  perform 1 from room where id = p_room and wedding_id = p_wedding;
  if not found then raise exception 'NOT_FOUND'; end if;
  if p_family is null then
    delete from room_allocation where room_id = p_room;
  else
    perform 1 from family where id = p_family and wedding_id = p_wedding;
    if not found then raise exception 'NOT_FOUND'; end if;
    insert into room_allocation(room_id, family_id, assigned_by) values (p_room, p_family, p_actor)
    on conflict (room_id) do update set family_id = excluded.family_id, assigned_by = excluded.assigned_by, assigned_at = now();
  end if;
  insert into audit_log(wedding_id, actor, action, target, data)
  values (p_wedding, p_actor, 'rooms.assign', p_room::text, jsonb_build_object('family', p_family));
end $$;

create or replace function rooms_clear_all(p_wedding uuid, p_actor uuid)
returns integer language plpgsql set search_path = public as $$
declare n integer;
begin
  delete from room_allocation a using room r where a.room_id = r.id and r.wedding_id = p_wedding;
  get diagnostics n = row_count;
  insert into audit_log(wedding_id, actor, action, target, data)
  values (p_wedding, p_actor, 'rooms.clear', p_wedding::text, jsonb_build_object('rooms', n));
  return n;
end $$;

insert into permission(key, description) values
  ('planning.read',  'See the wedding plan: arrivals by day, rooms, plates, housekeeping, transport'),
  ('planning.write', 'Edit rooms, allocate rooms, assign drivers, set venue and planning settings'),
  ('vendor.portal',  'A vendor sees its own bookings, tasks and, for transport, the arrivals plan')
on conflict (key) do update set description = excluded.description;
insert into role_permission(role_id, permission_key)
select r.id, k from role r, unnest(array['planning.read','planning.write','vendor.portal']) k where r.key in ('super_admin','admin')
on conflict do nothing;
insert into role_permission(role_id, permission_key)
select r.id, k from role r, unnest(array['planning.read','planning.write']) k where r.key = 'host'
on conflict do nothing;
insert into role_permission(role_id, permission_key)
select r.id, 'planning.read' from role r where r.key = 'coordinator'
on conflict do nothing;
-- A custom "vendor" role, when the wedding has one, gets its own-bookings page.
insert into role_permission(role_id, permission_key)
select r.id, 'vendor.portal' from role r where r.key = 'vendor'
on conflict do nothing;

select lock_down_public();
