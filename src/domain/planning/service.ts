import "server-only";
import { db, rpc } from "@/lib/db/service";
import { AppError } from "@/lib/errors";
import type { CreateRoomsInput as CreateRoomsT, PickupInput as PickupT, SettingsInput as SettingsT } from "@/contracts/planning";
import { arrivalSlots, dayTotals, foodSplit, housekeeping, pickupPoint, roomsNeeded, vehiclePlan, withDefaults, type Arrival, type FoodSplit, type PlanSettingsT } from "./calc";

/** A one-to-one embed (room_allocation has the room as its key) comes back as an object, a one-to-many as an array. */
const many = <T,>(v: T | T[] | null | undefined): T[] => (v == null ? [] : Array.isArray(v) ? v : [v]);

/** PostgREST caps a response at 1000 rows: read big tables a page at a time. */
async function all<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await page(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if ((data ?? []).length < 1000) return out;
  }
}

export type WeddingPlanInfo = { venueName: string | null; venueCity: string | null; stationName: string | null; airportName: string | null; settings: PlanSettingsT };

export async function weddingPlanInfo(weddingId: string): Promise<WeddingPlanInfo> {
  const { data, error } = await db().from("wedding").select("venue_name, venue_city, station_name, airport_name, plan_settings").eq("id", weddingId).single();
  if (error || !data) throw new AppError("NOT_FOUND");
  return { venueName: data.venue_name, venueCity: data.venue_city, stationName: data.station_name, airportName: data.airport_name, settings: withDefaults(data.plan_settings) };
}

type PeopleRow = { family_id: string; name: string; people: number };
type ProfileRow = { family_id: string; travel_mode: string | null; travel_number: string | null; arrival_at: string | null; arriving_count: number | null; food_pref: string | null };

async function peopleByFamily(weddingId: string) {
  const rows = await all<PeopleRow>((a, b) => db().from("v_family_people").select("family_id, name, people").eq("wedding_id", weddingId).range(a, b));
  return new Map(rows.map((r) => [r.family_id, r]));
}
async function profilesFor(familyIds: string[]) {
  const out: ProfileRow[] = [];
  for (let i = 0; i < familyIds.length; i += 200) {
    const { data, error } = await db().from("guest_profile").select("family_id, travel_mode, travel_number, arrival_at, arriving_count, food_pref").in("family_id", familyIds.slice(i, i + 200));
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as ProfileRow[]));
  }
  return new Map(out.map((p) => [p.family_id, p]));
}

/** Every family attending something, with how it travels. Arrival rows only for families that gave a time. */
async function arrivalsFor(weddingId: string) {
  const people = await peopleByFamily(weddingId);
  const profiles = await profilesFor([...people.keys()]);
  const arrivals: Arrival[] = [];
  for (const [id, p] of people) {
    const g = profiles.get(id);
    if (g?.arrival_at) arrivals.push({ familyId: id, family: p.name, people: g.arriving_count ?? p.people, mode: g.travel_mode, number: g.travel_number, arrivalAt: g.arrival_at });
  }
  return { people, profiles, arrivals };
}

export type PlanFunction = {
  eventId: string; name: string; startsAt: string | null;
  attendingFamilies: number; people: number; plates: number; food: FoodSplit;
  vendors: { id: string; name: string; category: string; scope: string | null }[];
  tasks: { id: string; title: string; status: string; priority: string; dueAt: string | null; owner: string | null; vendor: string | null }[];
};

export async function planningOverview(weddingId: string) {
  const [info, events, rsvps, rooms, assignments, tasks] = await Promise.all([
    weddingPlanInfo(weddingId),
    db().from("event").select("id, name, starts_at").eq("wedding_id", weddingId).order("starts_at", { ascending: true }).then((r) => r.data ?? []),
    all<{ family_id: string; event_id: string; status: string; headcount: number; family: { wedding_id: string } | null }>((a, b) =>
      db().from("rsvp").select("family_id, event_id, status, headcount, family:family_id!inner(wedding_id)").eq("family.wedding_id", weddingId).eq("status", "yes").range(a, b) as never),
    db().from("room").select("id, capacity, beds, allocation:room_allocation(family_id)").eq("wedding_id", weddingId).then((r) => r.data ?? []),
    db().from("vendor_event_assignment").select("event_id, scope, vendor:vendor_id!inner(id, name, wedding_id, category:category_id(name))").eq("vendor.wedding_id", weddingId).then((r) => (r.data ?? []) as unknown as { event_id: string; scope: string | null; vendor: { id: string; name: string; category: { name: string } | null } }[]),
    db().from("task").select("id, title, status, priority, due_at, event_id, owner:owner_participant_id(display_name), vendor:vendor_id(name)").eq("wedding_id", weddingId).not("event_id", "is", null).not("status", "in", "(done,cancelled)").order("due_at", { ascending: true, nullsFirst: false }).then((r) => (r.data ?? []) as unknown as { id: string; title: string; status: string; priority: string; due_at: string | null; event_id: string; owner: { display_name: string } | null; vendor: { name: string } | null }[]),
  ]);
  const { people, profiles, arrivals } = await arrivalsFor(weddingId);

  const functions: PlanFunction[] = events.map((e) => {
    const yes = rsvps.filter((r) => r.event_id === e.id);
    return {
      eventId: e.id, name: e.name, startsAt: e.starts_at,
      attendingFamilies: yes.length,
      people: yes.reduce((n, r) => n + r.headcount, 0),
      plates: yes.reduce((n, r) => n + r.headcount, 0),
      food: foodSplit(yes.map((r) => ({ people: r.headcount, food: profiles.get(r.family_id)?.food_pref ?? null }))),
      vendors: assignments.filter((a) => a.event_id === e.id).map((a) => ({ id: a.vendor.id, name: a.vendor.name, category: a.vendor.category?.name ?? "Other", scope: a.scope })),
      tasks: tasks.filter((t) => t.event_id === e.id).map((t) => ({ id: t.id, title: t.title, status: t.status, priority: t.priority, dueAt: t.due_at, owner: t.owner?.display_name ?? null, vendor: t.vendor?.name ?? null })),
    };
  });

  const slots = arrivalSlots(arrivals);
  const allocated = rooms.filter((r) => many(r.allocation as unknown).length);
  const roomsNeededTotal = [...people.values()].reduce((n, p) => n + roomsNeeded(p.people, info.settings.roomCapacity), 0);
  const peopleInRooms = (() => {
    const fams = new Set(allocated.flatMap((r) => many(r.allocation as { family_id: string } | { family_id: string }[] | null).map((x) => x.family_id)));
    return [...fams].reduce((n, id) => n + (people.get(id)?.people ?? 0), 0);
  })();
  const peak = Math.max(0, ...functions.map((f) => f.people));
  return {
    info, functions,
    coverage: { families: people.size, gaveArrival: arrivals.length, gaveFood: [...people.keys()].filter((id) => profiles.get(id)?.food_pref).length },
    days: dayTotals(slots),
    rooms: { total: rooms.length, allocated: allocated.length, free: rooms.length - allocated.length, needed: roomsNeededTotal, short: Math.max(0, roomsNeededTotal - rooms.length) },
    housekeeping: housekeeping({ roomsOccupied: allocated.length || Math.min(rooms.length, roomsNeededTotal), peopleInRooms: peopleInRooms || [...people.values()].reduce((n, p) => n + p.people, 0), peakGuests: peak }, info.settings),
  };
}

export type RoomRow = { id: string; block: string; floor: string | null; label: string; capacity: number; beds: number; familyId: string | null; family: string | null };
export type FamilyRoomRow = { familyId: string; name: string; people: number; roomsNeeded: number; rooms: string[] };

const roomName = (r: { block: string; label: string }) => (r.block ? `${r.block}-${r.label}` : r.label);

export async function roomsView(weddingId: string) {
  const info = await weddingPlanInfo(weddingId);
  const [{ data: rooms, error }, people] = await Promise.all([
    db().from("room").select("id, block, floor, label, capacity, beds, allocation:room_allocation(family_id, family:family_id(name))").eq("wedding_id", weddingId).order("block").order("label"),
    peopleByFamily(weddingId),
  ]);
  if (error) throw new Error(error.message);
  type Alloc = { family_id: string; family: { name: string } | null };
  const rows: RoomRow[] = ((rooms ?? []) as unknown as (Omit<RoomRow, "familyId" | "family"> & { allocation: Alloc | Alloc[] | null })[]).map((r) => {
    const a = many(r.allocation)[0];
    return { id: r.id, block: r.block, floor: r.floor, label: r.label, capacity: r.capacity, beds: r.beds, familyId: a?.family_id ?? null, family: a?.family?.name ?? null };
  });
  const families: FamilyRoomRow[] = [...people.values()]
    .map((p) => ({ familyId: p.family_id, name: p.name, people: p.people, roomsNeeded: roomsNeeded(p.people, info.settings.roomCapacity), rooms: rows.filter((r) => r.familyId === p.family_id).map(roomName) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { info, rooms: rows, families };
}

export async function createRooms(weddingId: string, input: CreateRoomsT) {
  const rows = Array.from({ length: input.to - input.from + 1 }, (_, i) => ({
    wedding_id: weddingId, block: input.block, floor: input.floor || null, label: `${input.prefix}${input.from + i}`, capacity: input.capacity, beds: input.beds,
  }));
  const { data, error } = await db().from("room").upsert(rows, { onConflict: "wedding_id,block,label", ignoreDuplicates: true }).select("id");
  if (error) throw new Error(error.message);
  return { created: data?.length ?? 0, skipped: rows.length - (data?.length ?? 0) };
}

export async function deleteRoom(weddingId: string, roomId: string) {
  const { data: alloc } = await db().from("room_allocation").select("room_id").eq("room_id", roomId).maybeSingle();
  if (alloc) throw new AppError("ROOM_TAKEN", "Free this room before deleting it");
  const { error } = await db().from("room").delete().eq("id", roomId).eq("wedding_id", weddingId);
  if (error) throw new Error(error.message);
}

export const autoallocateRooms = (weddingId: string, actor: string) => rpc<{ families: number; rooms: number; unplaced: { family: string; people: number }[] }>("rooms_autoallocate", { p_wedding: weddingId, p_actor: actor });
export const clearRooms = (weddingId: string, actor: string) => rpc<number>("rooms_clear_all", { p_wedding: weddingId, p_actor: actor });
export const assignRoom = (weddingId: string, actor: string, roomId: string, familyId: string | null) => rpc("room_assign", { p_wedding: weddingId, p_actor: actor, p_room: roomId, p_family: familyId });

/** Venue names and the ratios: only the fields sent change; settings merge into the stored object. */
export async function saveSettings(weddingId: string, input: SettingsT) {
  const info = await weddingPlanInfo(weddingId);
  const { venueName, venueCity, stationName, airportName, ...ratios } = input;
  const settings = withDefaults({ ...info.settings, ...Object.fromEntries(Object.entries(ratios).filter(([, v]) => v !== undefined)) });
  const patch: Record<string, unknown> = { plan_settings: settings };
  const text = (v: string | null | undefined) => (v === undefined ? undefined : v ? v : null);
  for (const [col, v] of [["venue_name", text(venueName)], ["venue_city", text(venueCity)], ["station_name", text(stationName)], ["airport_name", text(airportName)]] as const) if (v !== undefined) patch[col] = v;
  const { error } = await db().from("wedding").update(patch).eq("id", weddingId);
  if (error) throw new Error(error.message);
  return weddingPlanInfo(weddingId);
}

export async function savePickup(weddingId: string, actor: string, input: PickupT) {
  const { data: fam } = await db().from("family").select("id").eq("id", input.familyId).eq("wedding_id", weddingId).maybeSingle();
  if (!fam) throw new AppError("NOT_FOUND");
  if (!input.driver) {
    const { error } = await db().from("pickup_assignment").delete().eq("family_id", input.familyId);
    if (error) throw new Error(error.message);
  } else {
    if (input.driver.vendorId) {
      const { data: v } = await db().from("vendor").select("id").eq("id", input.driver.vendorId).eq("wedding_id", weddingId).maybeSingle();
      if (!v) throw new AppError("NOT_FOUND", "Vendor not found");
    }
    const { error } = await db().from("pickup_assignment").upsert({
      family_id: input.familyId, vendor_id: input.driver.vendorId ?? null, driver_name: input.driver.name, driver_phone: input.driver.phone,
      vehicle: input.driver.vehicle || null, assigned_by: actor, updated_at: new Date().toISOString(),
    });
    if (error) throw new Error(error.message);
  }
  await db().from("audit_log").insert({ wedding_id: weddingId, actor, action: input.driver ? "pickup.assign" : "pickup.clear", target: input.familyId, data: {} });
}

export async function linkVendorLogin(weddingId: string, actor: string, vendorId: string, email: string | null) {
  const { data: v } = await db().from("vendor").select("id").eq("id", vendorId).eq("wedding_id", weddingId).maybeSingle();
  if (!v) throw new AppError("NOT_FOUND", "Vendor not found");
  let userId: string | null = null;
  if (email) {
    const { data: u } = await db().from("app_user").select("id").ilike("email", email).maybeSingle();
    if (!u) throw new AppError("NOT_FOUND", "No user with that email. Create the login first.");
    userId = u.id;
  }
  const { error } = await db().from("vendor").update({ login_user_id: userId }).eq("id", vendorId);
  if (error) throw new Error(error.message.includes("vendor_login_uidx") ? "That login is already linked to another vendor" : error.message);
  await db().from("audit_log").insert({ wedding_id: weddingId, actor, action: "vendor.login_link", target: vendorId, data: { linked: !!userId } });
}

export type PickupRow = { familyId: string; driverName: string; driverPhone: string; vehicle: string | null; vendorId: string | null };

/** Transport planning: arrivals by pickup point and hour with a vehicle recommendation, the driver per family, and the transport vendors. */
export async function transportView(weddingId: string) {
  const info = await weddingPlanInfo(weddingId);
  const { arrivals, people } = await arrivalsFor(weddingId);
  const { data: pk } = await db().from("pickup_assignment").select("family_id, driver_name, driver_phone, vehicle, vendor_id").in("family_id", [...people.keys()].slice(0, 1000));
  const pickups = new Map<string, PickupRow>((pk ?? []).map((p) => [p.family_id, { familyId: p.family_id, driverName: p.driver_name, driverPhone: p.driver_phone, vehicle: p.vehicle, vendorId: p.vendor_id }]));
  const { data: vend } = await db().from("vendor").select("id, name, login_user_id, category:category_id!inner(key)").eq("wedding_id", weddingId).eq("category.key", "transport");
  const slots = arrivalSlots(arrivals).map((s) => ({ ...s, plan: vehiclePlan(s.people, info.settings.vehicles, info.settings.vehicleBuffer), points: [...new Set(s.items.map((i) => pickupPoint(i.mode, info) ?? "Own transport / not given"))] }));
  return {
    info, slots, pickups: Object.fromEntries(pickups),
    vendors: (vend ?? []).map((v) => ({ id: v.id, name: v.name, linked: !!v.login_user_id })),
    coverage: { families: people.size, gaveArrival: arrivals.length },
  };
}

/** What a vendor sees: its own function bookings, tasks, the plates for those functions, and for transport the arrivals plan. Never phones, payments or other vendors. */
export async function vendorPortal(userId: string, weddingId: string) {
  const { data: v } = await db().from("vendor").select("id, name, services, category:category_id(key, name)").eq("wedding_id", weddingId).eq("login_user_id", userId).maybeSingle();
  if (!v) return null;
  const category = v.category as unknown as { key: string; name: string } | null;
  const { data: ass } = await db().from("vendor_event_assignment").select("scope, arrival_at, event:event_id(id, name, starts_at)").eq("vendor_id", v.id);
  const bookings = ((ass ?? []) as unknown as { scope: string | null; arrival_at: string | null; event: { id: string; name: string; starts_at: string | null } }[])
    .map((a) => ({ eventId: a.event.id, name: a.event.name, startsAt: a.event.starts_at, scope: a.scope, arriveAt: a.arrival_at }))
    .sort((a, b) => (a.startsAt ?? "").localeCompare(b.startsAt ?? ""));
  const { data: tasks } = await db().from("task").select("id, title, status, priority, due_at, event:event_id(name)").eq("wedding_id", weddingId).eq("vendor_id", v.id).not("status", "in", "(done,cancelled)").order("due_at", { ascending: true, nullsFirst: false });
  let plates: Record<string, number> = {};
  if (bookings.length) {
    const { data: pl } = await db().from("v_event_plates").select("event_id, planned_plates").in("event_id", bookings.map((b) => b.eventId));
    plates = Object.fromEntries((pl ?? []).map((p) => [p.event_id, p.planned_plates]));
  }
  let transport = null as Awaited<ReturnType<typeof transportForDriver>> | null;
  if (category?.key === "transport") transport = await transportForDriver(weddingId, v.id);
  return {
    vendor: { id: v.id, name: v.name, category: category?.name ?? "Other", services: v.services },
    bookings: bookings.map((b) => ({ ...b, plates: plates[b.eventId] ?? 0 })),
    tasks: ((tasks ?? []) as unknown as { id: string; title: string; status: string; priority: string; due_at: string | null; event: { name: string } | null }[]).map((t) => ({ id: t.id, title: t.title, status: t.status, priority: t.priority, dueAt: t.due_at, event: t.event?.name ?? null })),
    transport,
  };
}

/** Driver view: arrivals by hour with the vehicles recommended, plus the pickups assigned to this vendor. No phone numbers of guests. */
async function transportForDriver(weddingId: string, vendorId: string) {
  const info = await weddingPlanInfo(weddingId);
  const { arrivals } = await arrivalsFor(weddingId);
  const slots = arrivalSlots(arrivals).map((s) => ({
    day: s.day, hour: s.hour, people: s.people, families: s.families, byMode: s.byMode,
    plan: vehiclePlan(s.people, info.settings.vehicles, info.settings.vehicleBuffer),
    arrivals: s.items.map((i) => ({ family: i.family, people: i.people, mode: i.mode, number: i.number, at: i.arrivalAt, point: pickupPoint(i.mode, info) })),
  }));
  const { data: mine } = await db().from("pickup_assignment").select("family_id, driver_name, vehicle").eq("vendor_id", vendorId);
  return { slots, assigned: (mine ?? []).length, coverage: { gaveArrival: arrivals.length } };
}

/** The family's own stay and pickup, for its pass: rooms and the driver once the admin has set them. */
export async function guestStay(familyId: string, weddingId: string, mode: string | null) {
  const info = await weddingPlanInfo(weddingId);
  const [{ data: rooms }, { data: drv }] = await Promise.all([
    db().from("room_allocation").select("room:room_id(block, floor, label)").eq("family_id", familyId),
    db().from("pickup_assignment").select("driver_name, driver_phone, vehicle").eq("family_id", familyId).maybeSingle(),
  ]);
  return {
    rooms: ((rooms ?? []) as unknown as { room: { block: string; floor: string | null; label: string } }[]).map((r) => r.room).sort((a, b) => (a.block + a.label).localeCompare(b.block + b.label)),
    driver: drv ? { name: drv.driver_name, phone: drv.driver_phone, vehicle: drv.vehicle } : null,
    pickupPoint: pickupPoint(mode, info),
    venue: info.venueName ? `${info.venueName}${info.venueCity ? `, ${info.venueCity}` : ""}` : null,
  };
}
