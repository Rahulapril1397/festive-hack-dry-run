import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { createFixture, dropFixture } from "../../scripts/fixture";

const url = process.env.DATABASE_URL;

/** Room allocation, pickup assignment and the planning permissions, at SQL level. */
describe.skipIf(!url)("planning (requires DATABASE_URL)", () => {
  const sql = postgres(url ?? "postgres://invalid", { max: 6, onnotice: () => {} });
  let fx: Awaited<ReturnType<typeof createFixture>>;
  let fam: string[] = [];
  const actor = randomUUID();
  const room = async (label: string, capacity = 6) => ((await sql`insert into room(wedding_id, block, label, capacity) values (${fx.weddingId}, 'A', ${label}, ${capacity}) returning id`)[0] as { id: string }).id;
  const yes = (family: string, headcount: number) => sql`insert into rsvp(family_id, event_id, status, headcount) values (${family}, ${fx.eventId}, 'yes', ${headcount}) on conflict (family_id, event_id) do update set status = 'yes', headcount = ${headcount}`;
  const holder = async (family: string) => (await sql`select count(*)::int n from room_allocation where family_id = ${family}`)[0]!.n as number;

  beforeAll(async () => {
    fx = await createFixture(sql, 4);
    fam = (await sql`select id from family where wedding_id = ${fx.weddingId} order by name`).map((r) => r.id as string);
    await sql`insert into app_user(id, email) values (${actor}, ${`planner-${actor.slice(0, 8)}@test.local`})`;
  });
  afterAll(async () => {
    if (fx) await dropFixture(sql, fx.weddingId);
    await sql`delete from app_user where id = ${actor}`;
    await sql.end();
  });

  it("a family takes whole rooms, 6 to a room, and families stay together", async () => {
    for (let i = 1; i <= 5; i++) await room(String(100 + i));
    await yes(fam[0]!, 7); // 2 rooms
    await yes(fam[1]!, 6); // 1 room
    await yes(fam[2]!, 2); // 1 room
    await sql`update family set name = 'No answer family' where id = ${fam[3]!}`; // no yes rsvp: gets nothing
    const r = (await sql`select rooms_autoallocate(${fx.weddingId}, ${actor}) r`)[0]!.r as { families: number; rooms: number; unplaced: unknown[] };
    expect(r.families).toBe(3);
    expect(r.rooms).toBe(4);
    expect(r.unplaced).toEqual([]);
    expect([await holder(fam[0]!), await holder(fam[1]!), await holder(fam[2]!), await holder(fam[3]!)]).toEqual([2, 1, 1, 0]);
  });

  it("running it again changes nothing", async () => {
    const r = (await sql`select rooms_autoallocate(${fx.weddingId}, ${actor}) r`)[0]!.r as { families: number };
    expect(r.families).toBe(0);
    expect((await sql`select count(*)::int n from room_allocation a join room r on r.id = a.room_id where r.wedding_id = ${fx.weddingId}`)[0]!.n).toBe(4);
  });

  it("a family that does not fit is reported, not partly placed; smaller ones still fit", async () => {
    await yes(fam[3]!, 5);
    await sql`insert into guest_profile(family_id, arriving_count) values (${fam[3]!}, 13) on conflict (family_id) do update set arriving_count = 13`; // 13 travelling: needs 3 rooms, only 1 free
    const extra = await room("200");
    void extra;
    const r = (await sql`select rooms_autoallocate(${fx.weddingId}, ${actor}) r`)[0]!.r as { families: number; unplaced: { family: string; people: number }[] };
    expect(r.families).toBe(0);
    expect(r.unplaced).toEqual([{ family: "No answer family", people: 13 }]);
    expect(await holder(fam[3]!)).toBe(0);
  });

  it("a manual assignment moves a room, and null frees it; other weddings' rooms are refused", async () => {
    const r1 = (await sql`select id from room where wedding_id = ${fx.weddingId} and label = '200'`)[0]!.id as string;
    await sql`select room_assign(${fx.weddingId}, ${actor}, ${r1}, ${fam[2]!})`;
    expect(await holder(fam[2]!)).toBe(2);
    await sql`select room_assign(${fx.weddingId}, ${actor}, ${r1}, ${fam[1]!})`; // moved
    expect([await holder(fam[2]!), await holder(fam[1]!)]).toEqual([1, 2]);
    await sql`select room_assign(${fx.weddingId}, ${actor}, ${r1}, ${null})`;
    expect(await holder(fam[1]!)).toBe(1);
    const other = await createFixture(sql, 1);
    try {
      const foreign = (await sql`insert into room(wedding_id, label) values (${other.weddingId}, 'X') returning id`)[0]!.id as string;
      await expect(sql`select room_assign(${fx.weddingId}, ${actor}, ${foreign}, ${fam[0]!})`).rejects.toThrow(/NOT_FOUND/);
    } finally {
      await dropFixture(sql, other.weddingId);
    }
  });

  it("clearing frees every room and is audited", async () => {
    const n = (await sql`select rooms_clear_all(${fx.weddingId}, ${actor}) n`)[0]!.n as number;
    expect(n).toBe(4);
    expect((await sql`select count(*)::int n from audit_log where wedding_id = ${fx.weddingId} and action like 'rooms.%'`)[0]!.n).toBeGreaterThanOrEqual(3);
  });

  it("people per family is what they said is travelling, else the largest attending headcount", async () => {
    await sql`insert into guest_profile(family_id, arriving_count) values (${fam[0]!}, 9) on conflict (family_id) do update set arriving_count = 9`;
    const rows = await sql`select family_id, people from v_family_people where wedding_id = ${fx.weddingId}`;
    const by = Object.fromEntries(rows.map((r) => [r.family_id as string, r.people as number]));
    expect(by[fam[0]!]).toBe(9);
    expect(by[fam[1]!]).toBe(6);
  });

  it("a driver phone must be a 10-digit number, and the family keeps one assignment", async () => {
    await expect(sql`insert into pickup_assignment(family_id, driver_name, driver_phone) values (${fam[0]!}, 'Ramesh', '12345')`).rejects.toThrow();
    await sql`insert into pickup_assignment(family_id, driver_name, driver_phone, vehicle) values (${fam[0]!}, 'Ramesh', '9876501234', 'RJ14 AB 1234')`;
    await expect(sql`insert into pickup_assignment(family_id, driver_name, driver_phone) values (${fam[0]!}, 'Suresh', '9876501235')`).rejects.toThrow();
  });

  it("the new permissions: admin and host plan, coordinator reads, a vendor role gets only the portal", async () => {
    const has = async (role: string) => (await sql`select permission_key k from role_permission rp join role r on r.id = rp.role_id where r.key = ${role} and r.wedding_id is null and permission_key in ('planning.read','planning.write','vendor.portal')`).map((x) => x.k as string).sort();
    expect(await has("admin")).toEqual(["planning.read", "planning.write", "vendor.portal"]);
    expect(await has("host")).toEqual(["planning.read", "planning.write"]);
    expect(await has("coordinator")).toEqual(["planning.read"]);
    expect(await has("kitchen")).toEqual([]);
  });
});
