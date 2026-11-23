import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { randomUUID, createHash } from "node:crypto";
import { createFixture, dropFixture } from "../../scripts/fixture";
import { DEFAULT_ROLE_PERMISSIONS } from "../../src/lib/authz/staticMap";
import { PERMISSIONS } from "../../src/lib/authz/catalogue";

const url = process.env.DATABASE_URL;

describe.skipIf(!url)("Stage 2 RBAC, admin, assistant SQL (requires DATABASE_URL)", () => {
  const sql = postgres(url ?? "postgres://invalid", { max: 4, onnotice: () => {} });
  let fx: Awaited<ReturnType<typeof createFixture>>;
  let other: Awaited<ReturnType<typeof createFixture>>;
  const users: Record<string, string> = {};
  const roleId = async (key: string) => ((await sql`select id from role where key = ${key}`)[0] as { id: string }).id;
  const perms = async (user: string, wedding: string) => ((await sql`select authz.effective_permissions(${user}, ${wedding}) p`)[0] as { p: string[] }).p;
  const mkUser = async (name: string) => {
    const id = randomUUID();
    await sql`insert into app_user(id, email) values (${id}, ${`${name}-${id.slice(0, 6)}@test.local`})`;
    users[name] = id;
    return id;
  };
  const assign = async (user: string, role: string, wedding: string | null, starts: string | null = null, expires: string | null = null) =>
    ((await sql`select id from admin_assign(${users.actor ?? null}, ${user}, ${wedding}, ${await roleId(role)}, ${starts}, ${expires})`)[0] as { id: string }).id;

  beforeAll(async () => {
    fx = await createFixture(sql, 2);
    other = await createFixture(sql, 1);
    await mkUser("actor");
    // tests below manage super admins; start from a known state
    await sql`delete from user_role where role_id in (select id from role where key = 'super_admin') and user_id in (select id from app_user where email like '%@test.local')`;
  });
  afterAll(async () => {
    await sql`delete from user_role where user_id in (select id from app_user where email like '%@test.local') and role_id <> (select id from role where key = 'super_admin')`;
    // leave super admin rows of test users until the end: drop them in one go (guard counts only active ones)
    await sql`update user_role set expires_at = null where false`;
    await sql.begin(async (tx) => {
      await tx`alter table user_role disable trigger user_role_last_super_admin`;
      await tx`alter table app_user disable trigger app_user_last_super_admin`;
      await tx`delete from user_role where user_id in (select id from app_user where email like '%@test.local')`;
      await tx`delete from app_user where email like '%@test.local'`;
      await tx`alter table user_role enable trigger user_role_last_super_admin`;
      await tx`alter table app_user enable trigger app_user_last_super_admin`;
    });
    if (fx) await dropFixture(sql, fx.weddingId);
    if (other) await dropFixture(sql, other.weddingId);
    await sql.end();
  });

  it("permission catalogue and system role defaults equal the TypeScript fixture", async () => {
    const cat = (await sql`select key from permission order by key`).map((r) => r.key);
    expect(cat).toEqual([...PERMISSIONS].sort());
    for (const [role, keys] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
      const rows = await sql`select rp.permission_key k from role_permission rp join role r on r.id = rp.role_id where r.key = ${role} order by 1`;
      expect(rows.map((r) => r.k), role).toEqual([...keys].sort());
    }
  });

  it("resolver: active window, wedding match, suspension, super admin everywhere", async () => {
    const u = await mkUser("stage");
    await assign(u, "stage_manager", fx.weddingId);
    expect(await perms(u, fx.weddingId)).toContain("queue.call_next");
    expect(await perms(u, other.weddingId)).toEqual([]); // other wedding
    expect(await perms(u, fx.weddingId)).not.toContain("ledger.read");

    const future = await mkUser("future");
    await assign(future, "kitchen", fx.weddingId, new Date(Date.now() + 3600_000).toISOString());
    expect(await perms(future, fx.weddingId)).toEqual([]);

    const expiring = await mkUser("expiring");
    const id = await assign(expiring, "kitchen", fx.weddingId, new Date(Date.now() - 60_000).toISOString(), new Date(Date.now() + 1500).toISOString());
    expect(await perms(expiring, fx.weddingId)).toContain("kitchen.read");
    await new Promise((r) => setTimeout(r, 1700));
    expect(await perms(expiring, fx.weddingId)).toEqual([]); // expired → 403
    expect(id).toBeTruthy();

    await sql`select admin_set_user_status(null, ${fx.weddingId}, ${u}, 'suspended')`;
    expect(await perms(u, fx.weddingId)).toEqual([]); // suspended → 403 immediately
    await sql`select admin_set_user_status(null, ${fx.weddingId}, ${u}, 'active')`;
    expect(await perms(u, fx.weddingId)).toContain("queue.read");

    const sa = await mkUser("super1");
    await assign(sa, "super_admin", null);
    expect(await perms(sa, other.weddingId)).toEqual([...PERMISSIONS].sort());
  });

  it("only super_admin may be wedding-less, and super_admin is always wedding-less", async () => {
    const u = await mkUser("bad");
    await expect(assign(u, "host", null)).rejects.toThrow(/BAD_REQUEST/);
    await expect(assign(u, "super_admin", fx.weddingId)).rejects.toThrow(/BAD_REQUEST/);
  });

  it("has_permission() reads the JWT subject (for RLS)", async () => {
    const u = users.stage!;
    const [r] = await sql.begin(async (tx) => {
      await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: u })}, true)`;
      return tx`select authz.has_permission(${fx.weddingId}, 'queue.read') a, authz.has_permission(${fx.weddingId}, 'ledger.read') b`;
    });
    expect(r).toEqual({ a: true, b: false });
  });

  it("the last super admin cannot be removed, suspended or expired; a second one makes it possible", async () => {
    const [{ n }] = (await sql`select authz.active_super_admins() n`) as unknown as [{ n: number }];
    expect(n).toBeGreaterThanOrEqual(1);
    // make super1 the only active super admin
    await sql.begin(async (tx) => {
      await tx`alter table user_role disable trigger user_role_last_super_admin`;
      await tx`update user_role set expires_at = now() - interval '1 second', starts_at = now() - interval '1 day'
                 where role_id = (select id from role where key = 'super_admin') and user_id <> ${users.super1!}`;
      await tx`alter table user_role enable trigger user_role_last_super_admin`;
    });
    const [only] = (await sql`select id from user_role where user_id = ${users.super1!}`) as unknown as [{ id: string }];
    await expect(sql`select admin_unassign(null, ${only.id})`).rejects.toThrow(/LAST_SUPER_ADMIN/);
    await expect(sql`select admin_set_user_status(null, null, ${users.super1!}, 'suspended')`).rejects.toThrow(/LAST_SUPER_ADMIN/);
    await expect(sql`update user_role set expires_at = now() + interval '1 millisecond', starts_at = now() - interval '1 day' where id = ${only.id}`).resolves.toBeDefined(); // still active at commit
    await expect(sql`update user_role set expires_at = now() - interval '1 second' where id = ${only.id}`).rejects.toThrow(/LAST_SUPER_ADMIN/);
    await sql`update user_role set expires_at = null where id = ${only.id}`;

    const second = await mkUser("super2");
    await assign(second, "super_admin", null);
    await sql`select admin_unassign(null, ${only.id})`; // allowed now
  });

  it("roles: unique keys, super_admin is not editable, every change is audited", async () => {
    const before = ((await sql`select count(*)::int n from audit_log where action like 'role.%'`)[0] as { n: number }).n;
    const [r] = await sql`select id from admin_create_role(${users.actor!}, 'decorator_t', 'Decorator', null, ${["kitchen.read"]})`;
    await expect(sql`select admin_create_role(null, 'decorator_t', 'Again', null, ${[]})`).rejects.toThrow(/ROLE_EXISTS/);
    await expect(sql`select admin_create_role(null, 'bad_perm_t', 'X', null, ${["ledger.steal"]})`).rejects.toThrow(/BAD_REQUEST/);
    await sql`select admin_set_role_permissions(null, ${r!.id}, ${["kitchen.read", "kitchen.write"]})`;
    await expect(sql`select admin_set_role_permissions(null, ${await roleId("super_admin")}, ${[]})`).rejects.toThrow(/SYSTEM_ROLE/);
    const after = ((await sql`select count(*)::int n from audit_log where action like 'role.%'`)[0] as { n: number }).n;
    expect(after - before).toBe(2);
    await sql`delete from role where id = ${r!.id}`;
  });

  it("persistence journey: create wedding without seed data, import 10 families, check in, read back", async () => {
    const host = await mkUser("host");
    const [{ r }] = (await sql`select admin_create_wedding(${users.actor!}, ${sql.json({ name: "Real wedding T" })}, ${sql.json([{ name: "Haldi" }, { name: "Reception", language: "hi" }])}, ${host}) r`) as unknown as [{ r: { weddingId: string; events: { id: string }[] } }];
    expect(r.events).toHaveLength(2);
    expect(await perms(host, r.weddingId)).toContain("families.write");
    const rows = Array.from({ length: 10 }, (_, i) => ({ row: i + 2, name: `Family ${i}`, phone: `97${String(i).padStart(8, "0")}`, language: i % 2 ? "hi" : "en", headcountMax: 4, code: String(1000 + i) }));
    rows.push({ row: 12, name: "Dup", phone: rows[0]!.phone, language: "en", headcountMax: 4, code: "2000" });
    const [{ out }] = (await sql`select families_import(${users.actor!}, ${r.weddingId}, ${sql.json(rows)}) out`) as unknown as [{ out: { row: number; status: string; linkKey?: string; familyId?: string; error?: string }[] }];
    expect(out.filter((x) => x.status === "created")).toHaveLength(10);
    expect(out.find((x) => x.row === 12)).toMatchObject({ status: "error" });
    const [{ v }] = (await sql`select checkin_verify(${rows[3]!.phone}, ${rows[3]!.code}, ${r.events[0]!.id}) v`) as unknown as [{ v: { outcome: string; token: number } }];
    expect(v.outcome).toBe("ok");
    // "reload": a fresh connection sees everything
    const fresh = postgres(url!, { max: 1, onnotice: () => {} });
    const [{ fams, rsvps, checkins }] = (await fresh`select (select count(*)::int from family where wedding_id = ${r.weddingId}) fams,
      (select count(*)::int from rsvp join family f on f.id = rsvp.family_id where f.wedding_id = ${r.weddingId}) rsvps,
      (select count(*)::int from checkin where event_id = ${r.events[0]!.id}) checkins`) as unknown as [{ fams: number; rsvps: number; checkins: number }];
    await fresh.end();
    expect({ fams, rsvps, checkins }).toEqual({ fams: 10, rsvps: 20, checkins: 1 });

    // rotate link: old key stops resolving
    const fam = out[0]!;
    const [{ k }] = (await sql`select family_rotate_link(null, ${r.weddingId}, ${fam.familyId!}) k`) as unknown as [{ k: string }];
    expect(k).not.toBe(fam.linkKey);
    expect(await sql`select 1 from family where link_key = ${fam.linkKey!}`).toHaveLength(0);
    await expect(sql`select family_rotate_link(null, ${fx.weddingId}, ${fam.familyId!})`).rejects.toThrow(/NOT_FOUND/); // other wedding

    // staff edits an RSVP on behalf of the family
    await sql`select * from rsvp_save_by_staff(null, ${r.weddingId}, ${fam.familyId!}, ${sql.json([{ eventId: r.events[1]!.id, attending: true, headcount: 3 }])})`;
    const [rs] = await sql`select status, headcount from rsvp where family_id = ${fam.familyId!} and event_id = ${r.events[1]!.id}`;
    expect(rs).toEqual({ status: "yes", headcount: 3 });

    await sql.begin(async (tx) => {
      await tx`delete from audit_log where wedding_id = ${r.weddingId}`;
      await tx`alter table stage_log disable trigger stage_log_no_update_delete`;
      await tx`delete from wedding where id = ${r.weddingId}`;
      await tx`alter table stage_log enable trigger stage_log_no_update_delete`;
    });
  });

  describe("assistant confirmations", () => {
    const h = (s: string) => createHash("sha256").update(s).digest("hex");
    let session: string;
    let famId: string;
    const action = async (token: string, expiresInMs = 300_000) =>
      ((await sql`insert into assistant_action(session_id, tool, args_json, args_hash, summary, confirm_token_hash, expires_at)
                  values (${session}, 'set_my_language', ${sql.json({ language: "hi" })}, 'h', 's', ${h(token)}, ${new Date(Date.now() + expiresInMs)}) returning id`)[0] as { id: string }).id;
    beforeAll(async () => {
      famId = ((await sql`select id from family where wedding_id = ${fx.weddingId} limit 1`)[0] as { id: string }).id;
      session = ((await sql`insert into assistant_session(kind, family_id, wedding_id) values ('guest', ${famId}, ${fx.weddingId}) returning id`)[0] as { id: string }).id;
    });

    it("right token claims once; reuse is refused", async () => {
      const id = await action("tok-1");
      const [a] = await sql`select (assistant_claim_action(${id}, ${h("tok-1")}, null, ${famId})).status s`;
      expect(a!.s).toBe("executing");
      await expect(sql`select assistant_claim_action(${id}, ${h("tok-1")}, null, ${famId})`).rejects.toThrow(/ACTION_USED/);
      await sql`select assistant_finish_action(${id}, true, null, ${fx.weddingId}, null)`;
      const [audit] = await sql`select action from audit_log where target = ${id}`;
      expect(audit!.action).toBe("assistant.set_my_language");
    });
    it("wrong token is refused and the action stays pending", async () => {
      const id = await action("tok-2");
      await expect(sql`select assistant_claim_action(${id}, ${h("nope")}, null, ${famId})`).rejects.toThrow(/ACTION_INVALID/);
      expect((await sql`select status from assistant_action where id = ${id}`)[0]!.status).toBe("pending");
    });
    it("expired token is refused and marked expired", async () => {
      const id = await action("tok-3", -1000);
      const [r] = await sql`select assistant_claim_action(${id}, ${h("tok-3")}, null, ${famId}) a`;
      expect(r!.a).toBeNull();
      expect((await sql`select status from assistant_action where id = ${id}`)[0]!.status).toBe("expired");
    });
    it("another family (or a staff user) cannot claim it", async () => {
      const id = await action("tok-4");
      const otherFam = ((await sql`select id from family where wedding_id = ${other.weddingId} limit 1`)[0] as { id: string }).id;
      await expect(sql`select assistant_claim_action(${id}, ${h("tok-4")}, null, ${otherFam})`).rejects.toThrow(/NOT_FOUND/);
      await expect(sql`select assistant_claim_action(${id}, ${h("tok-4")}, ${users.actor!}, null)`).rejects.toThrow(/NOT_FOUND/);
    });
  });
});
