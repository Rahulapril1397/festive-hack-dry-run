-- 0203_photos.sql — E3: photographer batches, photos, time-matched candidates. No face recognition.

drop table if exists photo_candidate;
drop table if exists photo;
drop table if exists batch;

create table batch (
  id                    uuid primary key default gen_random_uuid(),
  event_id              uuid not null references event(id) on delete cascade,
  photographer_user_id  uuid,
  camera_name           text not null,
  clock_offset_ms       bigint,                 -- qr_t_ms - exif_time_ms of the calibration photo
  calibrated_at         timestamptz,
  uploaded_at           timestamptz not null default now()
);

create table photo (
  id             uuid primary key default gen_random_uuid(),
  batch_id       uuid not null references batch(id) on delete cascade,
  storage_path   text not null unique,
  captured_at    timestamptz,                   -- raw EXIF capture time; never overwritten
  corrected_at   timestamptz,                   -- captured_at + batch.clock_offset_ms
  family_id      uuid references family(id),
  stage_log_id   uuid references stage_log(id),
  review_status  text not null default 'unmatched' check (review_status in ('unmatched','check','matched')),
  created_at     timestamptz not null default now()
);
create index photo_batch_idx on photo(batch_id);

create function photo_captured_at_immutable() returns trigger language plpgsql as $$
begin
  if new.captured_at is distinct from old.captured_at then
    raise exception 'photo.captured_at is immutable' using errcode = 'P0002';
  end if;
  return new;
end $$;
create trigger photo_captured_at_guard before update on photo
  for each row execute function photo_captured_at_immutable();

create table photo_candidate (
  id            uuid primary key default gen_random_uuid(),
  photo_id      uuid not null references photo(id) on delete cascade,
  stage_log_id  uuid not null references stage_log(id),
  delta_ms      integer not null,
  decision      text not null default 'pending' check (decision in ('pending','confirmed','rejected')),
  decided_by    uuid,
  decided_at    timestamptz,
  unique (photo_id, stage_log_id)
);

-- Save the clock offset and recompute corrected_at for the whole batch.
create or replace function photo_calibrate(p_batch uuid, p_actor uuid, p_offset_ms bigint)
returns batch language plpgsql set search_path = public, extensions as $$
declare v batch; v_wedding uuid;
begin
  update batch set clock_offset_ms = p_offset_ms, calibrated_at = now() where id = p_batch returning * into v;
  if not found then raise exception 'NOT_FOUND'; end if;
  update photo set corrected_at = captured_at + make_interval(secs => p_offset_ms / 1000.0)
   where batch_id = p_batch and captured_at is not null;
  select e.wedding_id into v_wedding from event e where e.id = v.event_id;
  insert into audit_log(wedding_id, actor, action, target, data)
  values (v_wedding, p_actor, 'photos.calibrate', p_batch::text, jsonb_build_object('offset_ms', p_offset_ms));
  return v;
end $$;

-- Replace the pending candidates of a photo. p_candidates = [{stageLogId, deltaMs}] ranked best first.
create or replace function photo_set_candidates(p_photo uuid, p_candidates jsonb)
returns void language plpgsql set search_path = public, extensions as $$
declare v_status text;
begin
  select review_status into v_status from photo where id = p_photo for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_status = 'matched' then return; end if;   -- never touch a human decision
  delete from photo_candidate where photo_id = p_photo and decision = 'pending';
  insert into photo_candidate(photo_id, stage_log_id, delta_ms)
  select p_photo, (c->>'stageLogId')::uuid, (c->>'deltaMs')::int from jsonb_array_elements(p_candidates) c
  on conflict (photo_id, stage_log_id) do nothing;
  update photo set review_status = case when exists (select 1 from photo_candidate where photo_id = p_photo and decision = 'pending')
                                        then 'check' else 'unmatched' end
   where id = p_photo;
end $$;

-- Human confirmation (never automatic).
create or replace function photo_decide(p_candidate uuid, p_actor uuid, p_decision text)
returns photo language plpgsql set search_path = public, extensions as $$
declare c photo_candidate; p photo; v_family uuid; v_wedding uuid;
begin
  if p_decision not in ('confirmed','rejected') then raise exception 'BAD_REQUEST'; end if;
  select * into c from photo_candidate where id = p_candidate for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  select * into p from photo where id = c.photo_id for update;
  if c.decision <> 'pending' or p.review_status = 'matched' then raise exception 'INVALID_TRANSITION'; end if;

  update photo_candidate set decision = p_decision, decided_by = p_actor, decided_at = now() where id = c.id;
  if p_decision = 'confirmed' then
    select qe.family_id, e.wedding_id into v_family, v_wedding
      from stage_log sl join queue_entry qe on qe.id = sl.queue_entry_id join event e on e.id = sl.event_id
     where sl.id = c.stage_log_id;
    update photo set family_id = v_family, stage_log_id = c.stage_log_id, review_status = 'matched' where id = p.id returning * into p;
  else
    select e.wedding_id into v_wedding from stage_log sl join event e on e.id = sl.event_id where sl.id = c.stage_log_id;
    update photo set review_status = case when exists (select 1 from photo_candidate where photo_id = p.id and decision = 'pending')
                                          then 'check' else 'unmatched' end
     where id = p.id returning * into p;
  end if;
  insert into audit_log(wedding_id, actor, action, target, data)
  values (v_wedding, p_actor, 'photos.' || p_decision, p.id::text, jsonb_build_object('candidate_id', c.id));
  return p;
end $$;

-- Private Storage bucket (Supabase only; plain Postgres in CI has no storage schema).
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets(id, name, public) values ('photos', 'photos', false) on conflict (id) do nothing;
  end if;
end $$;

select lock_down_public();
