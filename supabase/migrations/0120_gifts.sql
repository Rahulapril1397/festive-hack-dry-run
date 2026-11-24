-- 0120_gifts.sql — Stage 3 (E2 T1): gift wishlist with transaction-safe claims.
-- A claim locks the gift row (FOR UPDATE), so 20 families pressing "I'll bring this" at once on a
-- gift with quantity 3 produce exactly 3 claims. Guests never see who claimed what.

create table gift (
  id          uuid primary key default gen_random_uuid(),
  wedding_id  uuid not null references wedding(id) on delete cascade,
  title       text not null check (length(trim(title)) between 2 and 120),
  description text check (description is null or length(description) <= 1000),
  link        text check (link is null or link ~ '^https?://'),
  price_band  text check (price_band in ('under_2k','2k_5k','5k_10k','10k_25k','25k_plus')),
  image_path  text,                                         -- private bucket "gifts"
  quantity    integer not null default 1 check (quantity between 1 and 50),
  status      text not null default 'active' check (status in ('active','hidden')),
  sort        integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index gift_wedding_idx on gift(wedding_id, status, sort);

create table gift_claim (
  id            uuid primary key default gen_random_uuid(),
  gift_id       uuid not null references gift(id) on delete cascade,
  family_id     uuid not null references family(id) on delete cascade,
  quantity      integer not null default 1 check (quantity between 1 and 10),
  status        text not null default 'claimed' check (status in ('claimed','released','fulfilled')),
  created_at    timestamptz not null default now(),
  released_at   timestamptz,
  fulfilled_at  timestamptz
);
-- one live claim per family per gift
create unique index gift_claim_live on gift_claim(gift_id, family_id) where status <> 'released';
create index gift_claim_family_idx on gift_claim(family_id);

create or replace function gift_claimed_qty(p_gift uuid) returns integer language sql stable set search_path = public as $$
  select coalesce(sum(quantity), 0)::int from gift_claim where gift_id = p_gift and status <> 'released'
$$;

-- Guest claim. Idempotent for a family that already holds a live claim on this gift.
create or replace function gift_claim_create(p_family uuid, p_gift uuid, p_qty integer)
returns gift_claim language plpgsql set search_path = public as $$
declare g gift; v gift_claim; v_wedding uuid;
begin
  select wedding_id into v_wedding from family where id = p_family;
  select * into g from gift where id = p_gift for update;              -- serialises claims on this gift
  if not found or g.wedding_id is distinct from v_wedding or g.status <> 'active' then raise exception 'NOT_FOUND'; end if;
  select * into v from gift_claim where gift_id = p_gift and family_id = p_family and status <> 'released';
  if found then return v; end if;
  if p_qty < 1 or p_qty > 10 then raise exception 'BAD_REQUEST'; end if;
  if gift_claimed_qty(p_gift) + p_qty > g.quantity then raise exception 'GIFT_UNAVAILABLE'; end if;
  insert into gift_claim(gift_id, family_id, quantity) values (p_gift, p_family, p_qty) returning * into v;
  return v;
end $$;

-- Guest release of their own claim (not after the host marked it received).
create or replace function gift_claim_release(p_family uuid, p_claim uuid)
returns gift_claim language plpgsql set search_path = public as $$
declare v gift_claim;
begin
  update gift_claim set status = 'released', released_at = now()
   where id = p_claim and family_id = p_family and status = 'claimed' returning * into v;
  if not found then
    if exists (select 1 from gift_claim where id = p_claim and family_id = p_family and status = 'fulfilled') then raise exception 'INVALID_TRANSITION'; end if;
    raise exception 'NOT_FOUND';
  end if;
  return v;
end $$;

-- Host: p = {title, description?, link?, priceBand?, quantity?, status?, sort?, imagePath?}
create or replace function gift_upsert(p_actor uuid, p_wedding uuid, p_id uuid, p jsonb)
returns gift language plpgsql set search_path = public as $$
declare v gift;
begin
  if p_id is null then
    insert into gift(wedding_id, title, description, link, price_band, quantity, status, sort, image_path)
    values (p_wedding, trim(p->>'title'), nullif(p->>'description', ''), nullif(p->>'link', ''), nullif(p->>'priceBand', ''),
            coalesce((p->>'quantity')::int, 1), coalesce(nullif(p->>'status', ''), 'active'), coalesce((p->>'sort')::int, 0), nullif(p->>'imagePath', ''))
    returning * into v;
    perform audit(p_wedding, p_actor, 'gift.create', v.id::text, jsonb_build_object('title', v.title, 'quantity', v.quantity));
  else
    select * into v from gift where id = p_id and wedding_id = p_wedding for update;
    if not found then raise exception 'NOT_FOUND'; end if;
    if p ? 'quantity' and (p->>'quantity')::int < gift_claimed_qty(p_id) then raise exception 'GIFT_QTY_BELOW_CLAIMS'; end if;
    update gift set
      title = coalesce(nullif(trim(p->>'title'), ''), title),
      description = case when p ? 'description' then nullif(p->>'description', '') else description end,
      link = case when p ? 'link' then nullif(p->>'link', '') else link end,
      price_band = case when p ? 'priceBand' then nullif(p->>'priceBand', '') else price_band end,
      quantity = coalesce((p->>'quantity')::int, quantity),
      status = coalesce(nullif(p->>'status', ''), status),
      sort = coalesce((p->>'sort')::int, sort),
      image_path = case when p ? 'imagePath' then nullif(p->>'imagePath', '') else image_path end,
      updated_at = now()
    where id = p_id returning * into v;
    perform audit(p_wedding, p_actor, 'gift.update', v.id::text, p - 'description');
  end if;
  return v;
end $$;

-- Host marks a claimed gift received (or undoes it).
create or replace function gift_claim_fulfil(p_actor uuid, p_wedding uuid, p_claim uuid, p_fulfilled boolean)
returns gift_claim language plpgsql set search_path = public as $$
declare v gift_claim;
begin
  update gift_claim c set status = case when p_fulfilled then 'fulfilled' else 'claimed' end,
         fulfilled_at = case when p_fulfilled then now() end
    from gift g
   where c.id = p_claim and g.id = c.gift_id and g.wedding_id = p_wedding
     and c.status = case when p_fulfilled then 'claimed' else 'fulfilled' end
  returning c.* into v;
  if not found then raise exception 'INVALID_TRANSITION'; end if;
  perform audit(p_wedding, p_actor, case when p_fulfilled then 'gift.fulfil' else 'gift.unfulfil' end, p_claim::text);
  return v;
end $$;

insert into permission(key, description) values ('gifts.manage', 'Manage the gift wishlist and see who is bringing what')
on conflict (key) do update set description = excluded.description;
insert into role_permission(role_id, permission_key)
select r.id, 'gifts.manage' from role r where r.key in ('super_admin','admin','host','coordinator') and r.wedding_id is null
on conflict do nothing;

do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets(id, name, public) values ('gifts', 'gifts', false) on conflict (id) do nothing;
  end if;
end $$;

select lock_down_public();
