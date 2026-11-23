import { expect, test } from "@playwright/test";
import { ROLES, loginAs } from "./harness";
import { EXPECTED_NAV, FORBIDDEN } from "./expectedNav";

for (const role of ROLES) {
  test(`${role}: nav, forbidden page and forbidden API`, async ({ page }) => {
    await loginAs(page, role);
    const nav = await page.getByTestId("side-nav").locator("a").evaluateAll((as) => as.map((a) => a.getAttribute("data-testid")!.replace(/^nav-/, "")));
    expect(nav).toEqual(EXPECTED_NAV[role]);

    for (const key of nav) {
      const href = await page.getByTestId(`nav-${key}`).getAttribute("href");
      const res = await page.goto(href!);
      expect(res?.status(), `${role} → ${href}`).toBeLessThan(400);
      await expect(page.getByTestId("access-denied"), `${role} → ${href}`).toHaveCount(0);
    }

    const f = FORBIDDEN[role];
    if (f) {
      await page.goto(f.page);
      await expect(page.getByTestId("access-denied")).toBeVisible();
      const res = await page.request.fetch(f.api[1], { method: f.api[0], headers: { "idempotency-key": crypto.randomUUID(), "content-type": "application/json" }, data: f.api[0] === "POST" ? {} : undefined });
      expect(res.status(), `${role} ${f.api.join(" ")}`).toBe(403);
    }
  });
}

test("a guest session cannot call ops or admin routes", async ({ page }) => {
  await page.context().clearCookies();
  await page.goto(process.env.E2E_FAMILY_LINK ?? "/f/demo000700000007");
  for (const [m, u] of [["POST", "/api/ops/recommendations/00000000-0000-4000-8000-000000000000/approve"], ["GET", "/api/admin/users"], ["GET", "/api/ledger"]] as const) {
    expect((await page.request.fetch(u, { method: m })).status(), u).toBe(401);
  }
});
