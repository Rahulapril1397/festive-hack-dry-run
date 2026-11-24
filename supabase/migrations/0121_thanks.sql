-- 0121_thanks.sql — Stage 3 (E2 T2–T3): thank-you notes with an A/B template test, per-family
-- drafts (variant fixed by a stable hash of the family id), optional photo + gift, open tracking
-- (first open counted once), and the guest's language source for the suggestion banner.

create table thank_template (
  wedding_id  uuid not null references wedding(id) on delete cascade,
  variant     text not null check (variant in ('A','B')),
  body        text not null check (length(trim(body)) between 10 and 1500),   -- English with {family} {gift} {couple}
  updated_by  uuid,
  updated_at  timestamptz not null default now(),
  primary key (wedding_id, variant)
);

create table thank_note (
  id               uuid primary key default gen_random_uuid(),
  wedding_id       uuid not null references wedding(id) on delete cascade,
  family_id        uuid not null references family(id) on delete cascade,
  variant          text not null check (variant in ('A','B')),
  language         app_language not null default 'en',
  body             text not null,                -- final text shown to the family (in `language`)
  body_en          text not null,                -- English version (fallback + host preview)
  translated       boolean not null default false, -- false for a non-English family = Sarvam unavailable, English shown
  photo_id         uuid,                         -- FK to photo(id) is added by 0211 (0203 recreates photo)
  gift_claim_id    uuid references gift_claim(id) on delete set null,
  status           text not null default 'draft' check (status in ('draft','sent')),
  sent_at          timestamptz,
  opened_at        timestamptz,                  -- first open only (the A/B metric)
  open_count       integer not null default 0,
  created_by       uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (wedding_id, family_id)
);
create index thank_note_wedding_idx on thank_note(wedding_id, status, variant);

create or replace function thanks_set_template(p_actor uuid, p_wedding uuid, p_variant text, p_body text)
returns thank_template language plpgsql set search_path = public as $$
declare v thank_template;
begin
  insert into thank_template(wedding_id, variant, body, updated_by) values (p_wedding, p_variant, trim(p_body), p_actor)
  on conflict (wedding_id, variant) do update set body = excluded.body, updated_by = excluded.updated_by, updated_at = now()
  returning * into v;
  perform audit(p_wedding, p_actor, 'thanks.template', p_variant);
  return v;
end $$;

-- Create or replace a family's draft (a sent note is never rewritten). p = {variant, language, body,
-- bodyEn, translated, photoId?, giftClaimId?}
create or replace function thanks_save_draft(p_actor uuid, p_wedding uuid, p_family uuid, p jsonb)
returns thank_note language plpgsql set search_path = public as $$
declare v thank_note;
begin
  if not exists (select 1 from family where id = p_family and wedding_id = p_wedding) then raise exception 'NOT_FOUND'; end if;
  if nullif(p->>'photoId', '') is not null and not exists (
       select 1 from photo where id = (p->>'photoId')::uuid and family_id = p_family and review_status = 'matched') then raise exception 'BAD_REQUEST'; end if;
  if nullif(p->>'giftClaimId', '') is not null and not exists (
       select 1 from gift_claim where id = (p->>'giftClaimId')::uuid and family_id = p_family and status <> 'released') then raise exception 'BAD_REQUEST'; end if;
  insert into thank_note(wedding_id, family_id, variant, language, body, body_en, translated, photo_id, gift_claim_id, created_by)
  values (p_wedding, p_family, p->>'variant', (p->>'language')::app_language, p->>'body', p->>'bodyEn', coalesce((p->>'translated')::boolean, false),
          nullif(p->>'photoId', '')::uuid, nullif(p->>'giftClaimId', '')::uuid, p_actor)
  on conflict (wedding_id, family_id) do update set
    variant = excluded.variant, language = excluded.language, body = excluded.body, body_en = excluded.body_en,
    translated = excluded.translated, photo_id = excluded.photo_id, gift_claim_id = excluded.gift_claim_id, updated_at = now()
    where thank_note.status = 'draft'
  returning * into v;
  if v.id is null then raise exception 'INVALID_TRANSITION'; end if;   -- already sent
  return v;
end $$;

create or replace function thanks_send(p_actor uuid, p_wedding uuid, p_ids uuid[])
returns integer language plpgsql set search_path = public as $$
declare n integer;
begin
  with s as (
    update thank_note set status = 'sent', sent_at = now(), updated_at = now()
     where wedding_id = p_wedding and id = any(p_ids) and status = 'draft'
    returning id, family_id
  ), notes as (
    insert into notification(wedding_id, family_id, title, body, link, kind)
    select p_wedding, s.family_id, 'A thank-you note for you', '', null, 'thank_you' from s
    returning 1
  )
  select count(*) into n from s;
  perform audit(p_wedding, p_actor, 'thanks.send', null, jsonb_build_object('count', n));
  return n;
end $$;

-- Guest opened their note. opened_at is set once; open_count counts every view.
create or replace function thanks_open(p_family uuid)
returns thank_note language plpgsql set search_path = public as $$
declare v thank_note;
begin
  update thank_note set open_count = open_count + 1, opened_at = coalesce(opened_at, now())
   where family_id = p_family and status = 'sent' returning * into v;
  return v;   -- null when there is no sent note
end $$;

create or replace view v_thanks_results as
select wedding_id, variant,
       count(*) filter (where status = 'sent')::int          as sent,
       count(*) filter (where opened_at is not null)::int     as opened,
       count(*) filter (where status = 'draft')::int          as drafts,
       count(*) filter (where status = 'sent' and not translated and language <> 'en')::int as untranslated
  from thank_note group by wedding_id, variant;

-- Language suggestion (T4): where the family's language came from. 'default' = never chosen.
alter table family add column if not exists language_source text not null default 'default'
  check (language_source in ('default','host','manual','browser','location'));

insert into permission(key, description) values ('thanks.manage', 'Write and send thank-you notes; see A/B results')
on conflict (key) do update set description = excluded.description;
insert into role_permission(role_id, permission_key)
select r.id, 'thanks.manage' from role r where r.key in ('super_admin','admin','host') and r.wedding_id is null
on conflict do nothing;

select lock_down_public();
