-- 0123_guest_profile.sql — what a family tells us about its trip and its food (E2).
-- One row per family, written only by the family itself (signed link cookie) through the app.
-- No tickets or PNRs are stored: the guest types the train or flight number and the arrival time.

create table if not exists guest_profile (
  family_id      uuid primary key references family(id) on delete cascade,
  travel_mode    text check (travel_mode in ('train','flight','car','bus','other')),
  travel_number  text check (travel_number is null or length(travel_number) <= 12),
  arrival_at     timestamptz,
  arriving_count integer check (arriving_count is null or arriving_count between 0 and 30),
  food_pref      text check (food_pref in ('veg','non_veg','jain','vegan')),
  food_note      text check (food_note is null or length(food_note) <= 200),
  updated_at     timestamptz not null default now()
);

select lock_down_public();
