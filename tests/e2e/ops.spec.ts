import { expect, test, type Page } from "@playwright/test";

/** E3 T8. Seeded DB, non-prod quick-login. */
async function loginAs(page: Page, role: string, next = "/") {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByTestId(`quick-${role}`).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

test("finance: add cash + UPI entries, totals update, reconcile, export", async ({ page }) => {
  await loginAs(page, "finance", "/ledger");
  await expect(page.getByTestId("cash-total")).toBeVisible();
  const before = await page.getByTestId("cash-total").innerText();

  const form = page.getByTestId("entry-form");
  await form.getByTestId("token-ref").fill(`E2E-${Date.now()}`);
  await form.getByTestId("method").selectOption("cash");
  await form.getByTestId("amount").fill("1100");
  await form.getByTestId("add-entry").click();
  await expect(page.getByTestId("ledger-msg")).toHaveText("Entry added");
  await expect(page.getByTestId("cash-total")).not.toHaveText(before);

  await form.getByTestId("token-ref").fill(`E2E-UPI-${Date.now()}`);
  await form.getByTestId("method").selectOption("upi");
  await form.getByTestId("amount").fill("2100");
  await form.getByTestId("add-entry").click();
  await expect(page.getByTestId("ledger-msg")).toHaveText("Entry added");

  await page.getByRole("button", { name: "Reconcile" }).first().click();
  await page.getByTestId("family-search").last().fill("Sharma");
  await page.getByRole("button", { name: /Sharma/ }).first().click();
  await expect(page.getByTestId("ledger-msg")).toContainText("Reconciled");

  const res = await page.request.get("/api/ledger/export");
  expect(res.headers()["content-type"]).toContain("text/csv");
});

test("kitchen: ledger menu absent, /ledger denied, API forbidden", async ({ page }) => {
  await loginAs(page, "kitchen");
  await expect(page.getByTestId("nav-ledger")).toHaveCount(0);
  await page.goto("/ledger");
  await expect(page.getByTestId("access-denied")).toBeVisible();
  expect((await page.request.get("/api/ledger")).status()).toBe(403);
});

test("host: no ledger amounts leak to a role without ledger.read", async ({ page }) => {
  // stage has neither ledger.read nor ledger.write → 403 (no data at all)
  await loginAs(page, "stage");
  expect((await page.request.get("/api/ledger")).status()).toBe(403);
});

test("every seeded role lands on a screen and every nav item opens", async ({ page }) => {
  for (const role of ["host", "stage", "kitchen", "photographer", "admin", "finance"]) {
    await page.context().clearCookies();
    await loginAs(page, role);
    const links = await page.getByTestId("side-nav").locator("a").evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).getAttribute("href")!));
    for (const href of links) {
      const res = await page.goto(href);
      expect(res?.status(), `${role} → ${href}`).toBeLessThan(400);
      await expect(page.getByTestId("access-denied")).toHaveCount(0);
    }
  }
});
