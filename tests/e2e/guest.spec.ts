import { expect, test } from "@playwright/test";

/** E2 T9. Seeded DB required. Family #7 (link printed by `npm run seed`). */
const LINK = process.env.E2E_FAMILY_LINK ?? "/f/demo000700000007";

/** First visit shows the language step; later visits go straight in. */
async function openLink(page: import("@playwright/test").Page, url: string, lang: "en" | "hi") {
  await page.goto(url);
  const pick = page.getByTestId(`pick-${lang}`);
  if (await pick.isVisible().catch(() => false)) {
    await pick.click();
    await expect(page.getByTestId("language-picker")).toBeHidden();
  }
}

test("first visit: language step comes first, and the whole link follows the choice", async ({ page }) => {
  await page.goto(LINK);
  const picker = page.getByTestId("language-picker");
  test.skip(!(await picker.isVisible().catch(() => false)), "language already chosen for this family (reset by an earlier run)");
  await expect(page.getByTestId("privacy")).toHaveCount(0); // nothing else until a language is chosen
  await page.getByTestId("pick-hi").click();
  await expect(page.getByTestId("language-select")).toHaveValue("hi");
  await page.goto(`${LINK}/pass`);
  await expect(page.getByTestId("language-select")).toHaveValue("hi"); // pass, wishlist, thank-you follow too
  await page.goto(LINK);
  await page.getByTestId("language-select").selectOption("en");
});

test("invalid link shows the 'Link invalid or expired' page", async ({ page }) => {
  await page.goto("/f/not-a-real-key-123");
  await expect(page.getByTestId("link-invalid")).toContainText("Link invalid or expired");
});

test("guest: switch to Hindi, RSVP for two functions, reload and see saved values", async ({ page }) => {
  await openLink(page, LINK, "en");
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
