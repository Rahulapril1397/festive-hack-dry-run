-- 0101_guest.sql — E2: RSVP rules, translation cache, NudgeBee recommendations.

-- C6 rsvp shape (published to E3): rsvp(family_id, event_id, status 'pending'|'yes'|'no', headcount 0..10, updated_at)
alter table rsvp add constraint rsvp_headcount_max check (headcount between 0 and 10);
alter table rsvp add constraint rsvp_no_means_zero check (status <> 'no' or headcount = 0);

-- Upsert every RSVP of one family in one transaction. p_rsvps = [{eventId, attending, headcount}]
create or replace function rsvp_save(p_family uuid, p_rsvps jsonb)
returns setof rsvp language plpgsql set search_path = public, extensions as $$
declare v_wedding uuid; r jsonb; v_event uuid;
begin
  select wedding_id into v_wedding from family where id = p_family;
  if not found then raise exception 'NOT_FOUND'; end if;
  for r in select * from jsonb_array_elements(p_rsvps) loop
    v_event := (r->>'eventId')::uuid;
    if not exists (select 1 from event where id = v_event and wedding_id = v_wedding) then
      raise exception 'EVENT_NOT_FOUND';
    end if;
    insert into rsvp(family_id, event_id, status, headcount, updated_at)
    values (p_family, v_event,
            case when (r->>'attending')::boolean then 'yes' else 'no' end,
            case when (r->>'attending')::boolean then (r->>'headcount')::int else 0 end,
            now())
    on conflict (family_id, event_id) do update
      set status = excluded.status, headcount = excluded.headcount, updated_at = now();
  end loop;
  return query select * from rsvp where family_id = p_family;
end $$;

-- Translation cache by (wedding, language, English source). Source text is static UI copy only.
drop table if exists translation;
create table translation (
  wedding_id   uuid not null references wedding(id) on delete cascade,
  language     app_language not null,
  source_text  text not null,
  text         text not null,
  created_at   timestamptz not null default now(),
  primary key (wedding_id, language, source_text)
);

-- NudgeBee recommendations (one scenario: turn voice_calls OFF after TTS failures).
create table recommendation (
  id               uuid primary key default gen_random_uuid(),
  external_id      text unique,                 -- NudgeBee's id; replays are ignored
  text             text not null,
  proposed_action  text not null check (proposed_action in ('voice_calls_off')),
  status           text not null default 'pending'
                   check (status in ('pending','approved','done','approved_awaiting_manual_toggle','rejected')),
  detail           text,
  approved_by      uuid,
  approved_at      timestamptz,
  verified_at      timestamptz,
  created_at       timestamptz not null default now()
);

-- pending -> approved (claims the row so two operators cannot both act); audit.
create or replace function recommendation_approve(p_id uuid, p_actor uuid, p_wedding uuid)
returns recommendation language plpgsql set search_path = public, extensions as $$
declare v recommendation;
begin
  select * into v from recommendation where id = p_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v.status not in ('pending','approved_awaiting_manual_toggle') then raise exception 'INVALID_TRANSITION'; end if;
  update recommendation set status = 'approved', approved_by = p_actor, approved_at = now() where id = p_id returning * into v;
  insert into audit_log(wedding_id, actor, action, target, data)
  values (p_wedding, p_actor, 'ops.recommendation.approve', p_id::text, jsonb_build_object('action', v.proposed_action));
  return v;
end $$;

-- approved -> done | approved_awaiting_manual_toggle; audit.
create or replace function recommendation_finish(p_id uuid, p_actor uuid, p_wedding uuid, p_status text, p_detail text)
returns recommendation language plpgsql set search_path = public, extensions as $$
declare v recommendation;
begin
  if p_status not in ('done','approved_awaiting_manual_toggle') then raise exception 'BAD_REQUEST'; end if;
  update recommendation
     set status = p_status, detail = p_detail,
         verified_at = case when p_status = 'done' then now() else verified_at end
   where id = p_id and status = 'approved'
  returning * into v;
  if not found then raise exception 'INVALID_TRANSITION'; end if;
  insert into audit_log(wedding_id, actor, action, target, data)
  values (p_wedding, p_actor, 'ops.recommendation.' || p_status, p_id::text, jsonb_build_object('detail', p_detail));
  return v;
end $$;

select lock_down_public();
