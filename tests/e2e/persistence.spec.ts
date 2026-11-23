import { expect, test } from "@playwright/test";
import { api, createWeddingFixture, loginAs, reloginAndOpen, selectWedding } from "./harness";

/** E3 T2: create or edit a record, reload, log out and in — the record is still there. */
test.describe.configure({ mode: "serial" });

test("host: function created on a real wedding survives reload and re-login", async ({ page }) => {
  const w = await createWeddingFixture(page);
  await selectWedding(page, w.weddingId);
  const name = `Mehendi ${Date.now() % 10000}`;
  await page.goto("/host/functions");
  await page.getByTestId("create-function").getByLabel("Name (e.g. Mehendi)").fill(name);
  await page.getByTestId("create-function").getByRole("button").click();
  await expect(page.getByText(name)).toBeVisible();
  await reloginAndOpen(page, "super_admin", "/host/functions");
  await selectWedding(page, w.weddingId);
  await page.reload();
  await expect(page.getByText(name)).toBeVisible();
});

test("kitchen: meal status persists and shows who changed it", async ({ page }) => {
  await loginAs(page, "kitchen", "/kitchen");
  await page.getByTestId("kitchen-Reception").getByRole("button", { name: "Serving" }).click();
  await expect(page.getByTestId("kitchen-Reception").getByTestId("meal-updated-by")).toContainText("kitchen");
  await reloginAndOpen(page, "kitchen", "/kitchen");
  await expect(page.getByTestId("kitchen-Reception")).toContainText("serving");
});

test("ledger: an entry survives reload and re-login", async ({ page }) => {
  const ref = `PERSIST-${Date.now()}`;
  await loginAs(page, "finance", "/ledger");
  const form = page.getByTestId("entry-form");
  await form.getByTestId("token-ref").fill(ref);
  await form.getByTestId("amount").fill("501");
  await form.getByTestId("add-entry").click();
  await expect(page.getByTestId("ledger-table")).toContainText(ref);
  await reloginAndOpen(page, "finance", "/ledger");
  await expect(page.getByTestId("ledger-table")).toContainText(ref);
});

test("photographer: a batch survives reload and can be continued", async ({ page }) => {
  const camera = `E2E cam ${Date.now() % 10000}`;
  await loginAs(page, "photographer", "/photographer");
  await page.getByTestId("camera-name").fill(camera);
  await page.getByTestId("start-batch").click();
  await expect(page.getByTestId("calibration")).toContainText(camera);
  await reloginAndOpen(page, "photographer", "/photographer");
  await expect(page.getByTestId("continue-batch")).toContainText(camera);
});

test("admin: a role assignment survives reload and re-login", async ({ page }) => {
  await loginAs(page, "admin", "/admin");
  const users = await api<{ users: { id: string; email: string; assignments: { roleKey: string }[] }[] }>(page.request, "GET", "/api/admin/users");
  const photographer = users.body.users.find((u) => u.email.startsWith("photographer@"))!;
  const roles = await api<{ roles: { id: string; key: string }[] }>(page.request, "GET", "/api/admin/roles");
  const coordinator = roles.body.roles.find((r) => r.key === "coordinator")!;
  const created = await api<{ id: string }>(page.request, "POST", "/api/admin/assignments", { userId: photographer.id, roleId: coordinator.id, weddingId: "00000000-0000-4000-8000-000000000001", expiresAt: new Date(Date.now() + 3600_000).toISOString() });
  expect(created.status).toBe(201);
  await reloginAndOpen(page, "admin", "/admin");
  await expect(page.getByTestId(`user-${photographer.email}`)).toContainText("Coordinator");
  await api(page.request, "DELETE", `/api/admin/assignments/${created.body.id}`);
});

test("album: confirmed photos are listed by token after reload (needs photo fixtures)", async ({ page }) => {
  test.skip(!process.env.E2E_PHOTO_FIXTURES, "Set E2E_PHOTO_FIXTURES=1 when tests/fixtures/photos is present");
  await loginAs(page, "host", "/host/album");
  await page.reload();
  await expect(page.locator("main")).toContainText("Token");
});
