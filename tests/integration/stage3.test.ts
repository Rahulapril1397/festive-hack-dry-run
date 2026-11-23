import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { createFixture, dropFixture } from "../../scripts/fixture";

const url = process.env.DATABASE_URL;

/** Stage 3 E1: job runner, people/assignments/deny overrides, tasks. SQL-level (no Supabase needed). */
describe.skipIf(!url)("stage 3 — E1 (requires DATABASE_URL)", () => {
  const sql = postgres(url ?? "postgres://invalid", { max: 12, onnotice: () => {} });
  let fx: Awaited<ReturnType<typeof createFixture>>;
  const tag = randomUUID().slice(0, 8);
  const userIds: string[] = [];
  const roleId = async (key: string) => ((await sql`select id from role where key = ${key} and wedding_id is null`)[0] as { id: string }).id;
  const perms = async (user: string, wedding: string) => ((await sql`select authz.effective_permissions(${user}, ${wedding}) p`)[0] as { p: string[] }).p;
  const newUser = async (name: string) => {
    const id = randomUUID();
    await sql`insert into app_user(id, email) values (${id}, ${`${name}-${tag}@test.local`})`;
    userIds.push(id);
    return id;
  };

  beforeAll(async () => {
    fx = await createFixture(sql, 1);
  });
  afterAll(async () => {
    await sql`delete from job where name like ${"t3_" + tag + "%"}`;
    if (fx) await dropFixture(sql, fx.weddingId);
    if (userIds.length) {
      await sql`delete from user_role where user_id = any(${userIds})`;
      await sql`delete from app_user where id = any(${userIds})`;
    }
    await sql.end();
  });

  // ─── jobs ──────────────────────────────────────────────────────────────────────────────────
  it("parallel claims never hand out the same job twice", async () => {
    const name = `t3_${tag}_par`;
    for (let i = 0; i < 40; i++) await sql`select jobs_enqueue(${name}, ${sql.json({ i })}, now() - interval '1 second', null)`;
    const now = new Date(Date.now() + 1000).toISOString();
    const batches = await Promise.all(Array.from({ length: 8 }, () => sql<{ id: string; name: string }[]>`select id, name from jobs_claim(${now}, 10)`));
    const mine = batches.flat().filter((j) => j.name === name).map((j) => j.id);
    expect(new Set(mine).size).toBe(mine.length);
    expect(mine.length).toBe(40);
  });

  it("dedupe key: a second enqueue is a no-op", async () => {
    const key = `t3_${tag}_dedupe:slot`;
    const [a] = await sql`select jobs_enqueue(${`t3_${tag}_d`}, '{}', now(), ${key}) id`;
    const [b] = await sql`select jobs_enqueue(${`t3_${tag}_d`}, '{}', now(), ${key}) id`;
    expect(a!.id).toBeTruthy();
    expect(b!.id).toBeNull();
  });

  it("failures retry with the given time, then go dead; Retry revives (audited)", async () => {
    const [{ id }] = (await sql`select jobs_enqueue(${`t3_${tag}_fail`}, '{}', now() - interval '1 second', null) id`) as unknown as [{ id: string }];
    for (let attempt = 1; attempt <= 4; attempt++) {
      const claimed = await sql<{ id: string; attempts: number }[]>`select id, attempts from jobs_claim(now() + interval '2 hours', 100) where id = ${id}`;
      // other tests' jobs may be claimed by this call too: put them back
      await sql`update job set status = 'pending' where status = 'running' and id <> ${id} and name like ${"t3_" + tag + "%"}`;
      expect(claimed[0]?.attempts).toBe(attempt);
      const retry = attempt < 4 ? new Date(Date.now() + attempt * 60_000).toISOString() : null;
      const [j] = await sql<{ status: string }[]>`select status from jobs_finish(${id}, false, 'boom', ${retry})`;
      expect(j!.status).toBe(attempt < 4 ? "failed" : "dead");
    }
    await sql`select jobs_retry(${id}, null, ${fx.weddingId})`;
    const [j] = await sql<{ status: string; attempts: number }[]>`select status, attempts from job where id = ${id}`;
    expect(j).toEqual({ status: "pending", attempts: 0 });
    const [{ n }] = (await sql`select count(*)::int n from audit_log where action = 'job.retry' and target = ${id}`) as unknown as [{ n: number }];
    expect(n).toBe(1);
    await expect(sql`select jobs_retry(${id}, null, null)`).rejects.toThrow(/INVALID_TRANSITION/);
  });

  // ─── people ────────────────────────────────────────────────────────────────────────────────
  it("participant without a login: assignment pending, becomes active when linked", async () => {
    const [p] = await sql<{ id: string }[]>`select id from people_upsert(null, ${fx.weddingId}, null, ${sql.json({ displayName: "Mama ji", email: `mama-${tag}@test.local` })})`;
    const [a] = await sql<{ id: string; status: string }[]>`select id, status from people_assign(null, ${fx.weddingId}, ${p!.id}, ${await roleId("stage_manager")}, null, null)`;
    expect(a!.status).toBe("pending");
    const u = await newUser("mama");
    expect(await perms(u, fx.weddingId)).toEqual([]);
    await sql`select people_link_user(null, ${fx.weddingId}, ${p!.id}, ${u})`;
    expect(await perms(u, fx.weddingId)).toContain("queue.call_next");
  });

  it("deny override removes one permission; suspend removes the assignment; both audited", async () => {
    const u = await newUser("stage");
    const [ur] = await sql<{ id: string; participant_id: string }[]>`select id, participant_id from admin_assign(null, ${u}, ${fx.weddingId}, ${await roleId("stage_manager")}, null, null)`;
    expect(ur!.participant_id).toBeTruthy(); // Stage 2 admin path gets a participant automatically
    await sql`select assignment_set_override(null, ${ur!.id}, 'queue.call_next', true)`;
    const p = await perms(u, fx.weddingId);
    expect(p).not.toContain("queue.call_next");
    expect(p).toContain("queue.read");
    const [ctx] = await sql`select authz_context(${u}, ${fx.weddingId}) c`;
    expect((ctx!.c as { denied: string[] }).denied).toEqual(["queue.call_next"]);
    await sql`select assignment_set_override(null, ${ur!.id}, 'queue.call_next', false)`;
    expect(await perms(u, fx.weddingId)).toContain("queue.call_next");
    await sql`select assignment_set_status(null, ${ur!.id}, 'suspended')`;
    expect(await perms(u, fx.weddingId)).toEqual([]);
    await sql`select assignment_set_status(null, ${ur!.id}, 'active')`;
    expect(await perms(u, fx.weddingId)).toContain("queue.read");
    const actions = (await sql`select action from audit_log where target = ${ur!.id} order by id`).map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(["override.deny", "override.remove", "assignment.suspend", "assignment.reactivate"]));
  });

  it("custom roles: cloned per wedding, editable, cannot be used in another wedding", async () => {
    const [r] = await sql<{ id: string; key: string; wedding_id: string }[]>`select id, key, wedding_id from role_clone(null, ${fx.weddingId}, ${await roleId("kitchen")}, 'Halwai helper')`;
    expect(r!.wedding_id).toBe(fx.weddingId);
    expect(r!.key).toMatch(/^halwai_helper_[0-9a-f]{6}$/);
    await sql`select role_set_wedding_permissions(null, ${fx.weddingId}, ${r!.id}, null, ${["kitchen.read"]})`;
    await expect(sql`select role_set_wedding_permissions(null, ${fx.weddingId}, ${r!.id}, null, ${["roles.manage"]})`).rejects.toThrow(/BAD_REQUEST/);
    const u = await newUser("halwai");
    await sql`select admin_assign(null, ${u}, ${fx.weddingId}, ${r!.id}, null, null)`;
    expect(await perms(u, fx.weddingId)).toEqual(["kitchen.read"]);
    const other = await createFixture(sql, 0);
    try {
      await expect(sql`select admin_assign(null, ${u}, ${other.weddingId}, ${r!.id}, null, null)`).rejects.toThrow(/BAD_REQUEST/);
      await expect(sql`select role_clone(null, ${other.weddingId}, ${r!.id}, 'steal')`).rejects.toThrow(/NOT_FOUND/);
    } finally {
      await dropFixture(sql, other.weddingId);
    }
  });

  it("expire_assignments flips ended windows, never super_admin", async () => {
    const u = await newUser("temp");
    const [ur] = await sql<{ id: string }[]>`select id from admin_assign(null, ${u}, ${fx.weddingId}, ${await roleId("kitchen")}, now() - interval '2 days', now() - interval '1 day')`;
    await sql`select expire_assignments()`;
    const [row] = await sql`select status from user_role where id = ${ur!.id}`;
    expect(row!.status).toBe("expired");
    const supers = await sql`select count(*)::int n from user_role ur join role r on r.id = ur.role_id where r.key = 'super_admin' and ur.status = 'expired'`;
    expect(supers[0]!.n).toBe(0);
  });

  // ─── tasks ─────────────────────────────────────────────────────────────────────────────────
  it("task lifecycle: transitions enforced, history append-only, escalation once per level", async () => {
    const [p] = await sql<{ id: string }[]>`select id from people_upsert(null, ${fx.weddingId}, null, ${sql.json({ displayName: "Owner" })})`;
    const [t] = await sql<{ id: string; status: string }[]>`select id, status from task_create(null, ${fx.weddingId}, ${sql.json({ title: "Book dhol", ownerParticipantId: p!.id, dueAt: new Date(Date.now() - 3 * 3600_000).toISOString(), eventId: fx.eventId })})`;
    expect(t!.status).toBe("open");
    await expect(sql`select task_set_status(null, ${fx.weddingId}, ${t!.id}, 'done', null)`).rejects.toThrow(/INVALID_TRANSITION/);
    await sql`select task_set_status(null, ${fx.weddingId}, ${t!.id}, 'in_progress', null)`;
    await sql`select task_comment(null, ${fx.weddingId}, ${t!.id}, 'Called him, waiting')`;
    expect((await sql`select task_escalate(${t!.id}, 1, '{}') r`)[0]!.r).toBe(true);
    expect((await sql`select task_escalate(${t!.id}, 1, '{}') r`)[0]!.r).toBe(false);
    // a new due date resets escalation
    await sql`select task_update(null, ${fx.weddingId}, ${t!.id}, ${sql.json({ dueAt: new Date(Date.now() + 86400_000).toISOString() })})`;
    expect((await sql`select escalation_level l from task where id = ${t!.id}`)[0]!.l).toBe(0);
    await sql`select task_set_status(null, ${fx.weddingId}, ${t!.id}, 'done', 'booked')`;
    expect((await sql`select task_escalate(${t!.id}, 1, '{}') r`)[0]!.r).toBe(false);
    await expect(sql`select task_update(null, ${fx.weddingId}, ${t!.id}, ${sql.json({ title: "x" })})`).rejects.toThrow(/INVALID_TRANSITION/);
    const types = (await sql`select type from task_event where task_id = ${t!.id} order by id`).map((r) => r.type);
    expect(types).toEqual(["created", "assigned", "status_changed", "comment", "escalated", "updated", "status_changed"]);
    await expect(sql`update task_event set data = '{}' where task_id = ${t!.id}`).rejects.toThrow(/append-only/);
    await expect(sql`delete from task_event where task_id = ${t!.id}`).rejects.toThrow(/append-only/);
  });

  it("task in another wedding is not reachable; foreign owner refused", async () => {
    const other = await createFixture(sql, 0);
    try {
      const [p] = await sql<{ id: string }[]>`select id from people_upsert(null, ${other.weddingId}, null, ${sql.json({ displayName: "Elsewhere" })})`;
      await expect(sql`select task_create(null, ${fx.weddingId}, ${sql.json({ title: "Nope", ownerParticipantId: p!.id })})`).rejects.toThrow(/NOT_FOUND/);
      const [t] = await sql<{ id: string }[]>`select id from task_create(null, ${other.weddingId}, ${sql.json({ title: "Theirs" })})`;
      await expect(sql`select task_set_status(null, ${fx.weddingId}, ${t!.id}, 'in_progress', null)`).rejects.toThrow(/NOT_FOUND/);
    } finally {
      await dropFixture(sql, other.weddingId); // cascades tasks + their history
    }
  });

  it("notification recipients: only active logins holding the role now", async () => {
    const u = await newUser("coord");
    await sql`select admin_assign(null, ${u}, ${fx.weddingId}, ${await roleId("coordinator")}, null, null)`;
    const rows = await sql`select user_id from wedding_role_users(${fx.weddingId}, ${["coordinator"]})`;
    expect(rows.map((r) => r.user_id)).toContain(u);
    await sql`update app_user set status = 'suspended' where id = ${u}`;
    const after = await sql`select user_id from wedding_role_users(${fx.weddingId}, ${["coordinator"]})`;
    expect(after.map((r) => r.user_id)).not.toContain(u);
  });
});
