import { expect, test } from "@playwright/test";
import { RECEPTION, RECEPTION_TV_KEY, api, loginAs, logout } from "./harness";

/** E3 T6 journeys (run against staging on merge). Check-in → CALL NEXT → TV and guest RSVP live in stage1/guest specs. */
test.describe.configure({ mode: "serial" });

test("admin assigns a role with a short expiry → the user can act, then gets 403", async ({ page }) => {
  await loginAs(page, "admin", "/admin");
  const users = await api<{ users: { id: string; email: string }[] }>(page.request, "GET", "/api/admin/users");
  const kitchen = users.body.users.find((u) => u.email.startsWith("kitchen@"))!;
  const roles = await api<{ roles: { id: string; key: string }[] }>(page.request, "GET", "/api/admin/roles");
  const stage = roles.body.roles.find((r) => r.key === "stage_manager")!;
  const a = await api<{ id: string }>(page.request, "POST", "/api/admin/assignments", { userId: kitchen.id, roleId: stage.id, weddingId: "00000000-0000-4000-8000-000000000001", expiresAt: new Date(Date.now() + 20_000).toISOString() });
  expect(a.status).toBe(201);

  await loginAs(page, "kitchen");
  expect((await page.request.get(`/api/queue/${RECEPTION}`)).status()).toBe(200); // acting as stage manager
  await page.waitForTimeout(21_000);
  expect((await page.request.get(`/api/queue/${RECEPTION}`)).status()).toBe(403); // expired
  await loginAs(page, "admin");
  await api(page.request, "DELETE", `/api/admin/assignments/${a.body.id}`);
});

test("suspend a user mid-session → their next request is denied; reactivate restores it", async ({ browser }) => {
  const kitchenCtx = await browser.newContext();
  const kitchenPage = await kitchenCtx.newPage();
  await loginAs(kitchenPage, "kitchen", "/kitchen");
  expect((await kitchenPage.request.post("/api/kitchen/meal-status", { data: { eventId: RECEPTION, status: "serving" } })).status()).toBe(200);

  const adminPage = await (await browser.newContext()).newPage();
  await loginAs(adminPage, "admin");
  const users = await api<{ users: { id: string; email: string }[] }>(adminPage.request, "GET", "/api/admin/users");
  const kitchen = users.body.users.find((u) => u.email.startsWith("kitchen@"))!;
  expect((await api(adminPage.request, "POST", `/api/admin/users/${kitchen.id}/suspend`)).status).toBe(200);

  expect((await kitchenPage.request.post("/api/kitchen/meal-status", { data: { eventId: RECEPTION, status: "closed" } })).status()).toBe(403);
  expect((await api(adminPage.request, "POST", `/api/admin/users/${kitchen.id}/reactivate`)).status).toBe(200);
});

test("the last super admin cannot be demoted", async ({ page }) => {
  await loginAs(page, "super_admin", "/admin");
  const users = await api<{ users: { id: string; email: string; assignments: { id: string; roleKey: string; active: boolean }[] }[] }>(page.request, "GET", "/api/admin/users?scope=all");
  const supers = users.body.users.filter((u) => u.assignments.some((a) => a.roleKey === "super_admin" && a.active));
  test.skip(supers.length !== 1, "needs exactly one super admin");
  const mine = supers[0]!.assignments.find((a) => a.roleKey === "super_admin")!;
  // the API refuses changing your own account; the database refuses the last super admin either way
  const res = await api<{ error: { code: string } }>(page.request, "DELETE", `/api/admin/assignments/${mine.id}`);
  expect(res.status).toBe(409);
  expect(res.body.error.code).toBe("LAST_SUPER_ADMIN");
});

test("forced TTS failure on staging: TV chimes and the queue still proceeds", async ({ page }) => {
  test.skip(process.env.E2E_SARVAM_FORCE_FAIL !== "1", "Run against staging deployed with SARVAM_FORCE_FAIL=1");
  const telemetry: string[] = [];
  page.on("request", (r) => r.url().includes("/api/tv/telemetry") && telemetry.push(r.postData() ?? ""));
  await page.goto(`/tv/${RECEPTION}?key=${RECEPTION_TV_KEY}`);
  await page.getByTestId("tv").click();
  const stage = await page.context().browser()!.newPage();
  await loginAs(stage, "stage_manager");
  const res = await stage.request.post(`/api/queue/${RECEPTION}/call-next`, { headers: { "idempotency-key": crypto.randomUUID() } });
  test.skip(res.status() === 409, "queue empty or paused");
  await expect.poll(() => telemetry.some((t) => t.includes('"chime"')), { timeout: 15_000 }).toBe(true);
  expect((await stage.request.post(`/api/queue/${RECEPTION}/call-next`, { headers: { "idempotency-key": crypto.randomUUID() } })).status()).not.toBe(500);
  await logout(stage);
});
