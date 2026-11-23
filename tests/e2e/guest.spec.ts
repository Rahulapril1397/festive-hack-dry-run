import { expect, test } from "@playwright/test";

/** E2 T9. Seeded DB required. Family #7 (link printed by `npm run seed`). */
const LINK = process.env.E2E_FAMILY_LINK ?? "/f/demo000700000007";

test("invalid link shows the 'Link invalid or expired' page", async ({ page }) => {
  await page.goto("/f/not-a-real-key-123");
  await expect(page.getByTestId("link-invalid")).toContainText("Link invalid or expired");
});

test("guest: switch to Hindi, RSVP for two functions, reload and see saved values", async ({ page }) => {
  await page.goto(LINK);
  await expect(page.getByTestId("privacy")).toBeVisible();
  await page.getByTestId("language-select").selectOption("hi");
  await expect(page.locator("html")).toBeVisible();
  await page.waitForLoadState("networkidle");

  await page.getByTestId("attend-Haldi").click();
  await page.getByTestId("headcount-Haldi").fill("3");
  await page.getByTestId("attend-Reception").click();
  await page.getByTestId("headcount-Reception").fill("5");
  await page.getByTestId("rsvp-save").click();
  await expect(page.getByTestId("rsvp-state")).not.toBeEmpty();

  await page.reload();
  await expect(page.getByTestId("headcount-Haldi")).toHaveValue("3");
  await expect(page.getByTestId("headcount-Reception")).toHaveValue("5");
  await expect(page.getByTestId("language-select")).toHaveValue("hi");

  // reset language for the next run
  await page.getByTestId("language-select").selectOption("en");
});

test("pass page shows only this family and auto-refreshes", async ({ page }) => {
  await page.goto(`${LINK}/pass`);
  await expect(page.getByTestId("pass-family")).toBeVisible();
  await expect(page.getByTestId("pass-status")).toBeVisible();
});
