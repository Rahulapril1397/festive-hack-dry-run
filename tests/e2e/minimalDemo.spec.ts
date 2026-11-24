import { expect, test } from "@playwright/test";
import { loginAs } from "./harness";

/** Minimal demo plan: PinkyBua scope, static tiles, guest language groups. Seeded DB required. */
const LINK_A = process.env.E2E_FAMILY_LINK_A; // group A demo family link (scripts/pin-demo-families.ts)
const LINK_B = process.env.E2E_FAMILY_LINK_B; // group B demo family link

test("PinkyBua: active for admin, greyed out for host", async ({ page }) => {
  await loginAs(page, "admin");
  await expect(page.getByTestId("pinkybua-open")).toBeVisible();
  await expect(page.getByTestId("pinkybua-inactive")).toHaveCount(0);
  await page.context().clearCookies();
  await loginAs(page, "host");
  await expect(page.getByTestId("pinkybua-inactive")).toBeDisabled();
  await expect(page.getByTestId("pinkybua-open")).toHaveCount(0);
  const res = await page.request.post("/api/assistant/message", { data: { mode: "staff", text: "hello" } });
  expect(res.status()).toBe(403);
});

for (const [tile, add] of [["vendors", "Add vendor"], ["readiness", "Add event"], ["tasks", "Add task"], ["ledger", "Add entry"]] as const) {
  test(`static tile ${tile}: Preview label, fixed data, Add says Demo only`, async ({ page }) => {
    await loginAs(page, "admin", `/demo/${tile}`);
    await expect(page.getByTestId("preview-label")).toBeVisible();
    await page.getByTestId("static-add").click();
    await expect(page.getByTestId("static-msg")).toContainText("Demo only");
    await expect(page.getByTestId("static-add")).toHaveText(add);
  });
}

test("a stage manager cannot open the Gift ledger tile", async ({ page }) => {
  await loginAs(page, "stage_manager", "/demo/ledger");
  await expect(page.getByTestId("static-tile")).toHaveCount(0);
});

test("group A family sees only English and Hindi; group B also the dropdown", async ({ page }) => {
  test.skip(!LINK_A || !LINK_B, "needs E2E_FAMILY_LINK_A and E2E_FAMILY_LINK_B (run scripts/pin-demo-families.ts)");
  await page.goto(LINK_A!);
  await expect(page.getByTestId("pick-en")).toBeVisible();
  await expect(page.getByTestId("pick-hi")).toBeVisible();
  await expect(page.getByTestId("pick-more")).toHaveCount(0);
  await page.context().clearCookies();
  await page.goto(LINK_B!);
  await expect(page.getByTestId("pick-more")).toBeVisible();
  await page.getByTestId("pick-more").selectOption("ta");
  await expect(page.getByTestId("language-select")).toHaveValue("ta");
  await page.goto(`${LINK_B!}/pass`);
  await expect(page.getByTestId("language-select")).toHaveValue("ta");
  await expect(page.getByTestId("pinkybua-voice-notice")).toHaveCount(0); // notice is inside the opened panel
});
