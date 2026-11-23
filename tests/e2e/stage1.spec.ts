import { expect, test } from "@playwright/test";

/**
 * Requires a seeded database (npm run seed) and APP_ENV != production (quick-login).
 * Uses the demo Reception event and the last demo family, which is unlikely to be checked in.
 */
const RECEPTION = "00000000-0000-4000-8000-0000000000a3";
const RECEPTION_TV_KEY = "demo-tv-reception3";
const PHONE = process.env.E2E_FAMILY_PHONE ?? "9876500040";
const CODE = process.env.E2E_FAMILY_CODE; // printed by `npm run seed`

test("guest check-in → CALL NEXT → TV shows the token and no family name", async ({ browser }) => {
  test.skip(!CODE, "Set E2E_FAMILY_CODE to the seeded code for E2E_FAMILY_PHONE");

  // 1. guest checks in
  const guest = await browser.newPage();
  await guest.goto(`/checkin?event=${RECEPTION}`);
  await guest.getByTestId("phone").fill(PHONE);
  await guest.getByTestId("code").fill(CODE!);
  await guest.getByTestId("checkin-submit").click();
  await expect(guest.getByTestId("checkin-success")).toBeVisible();
  const token = (await guest.getByTestId("token").innerText()).trim();

  // 2. TV open before the call; the chime path is exercised because the audio stub returns 204
  const tv = await browser.newPage();
  const telemetry: string[] = [];
  tv.on("request", (r) => r.url().includes("/api/tv/telemetry") && telemetry.push(r.postData() ?? ""));
  await tv.goto(`/tv/${RECEPTION}?key=${RECEPTION_TV_KEY}`);
  await tv.getByTestId("tv").click(); // enable sound

  // 3. stage manager: clear anyone ahead, then call until our token is called
  const stage = await browser.newPage();
  await stage.goto("/login?next=/stage/" + RECEPTION);
  await stage.getByTestId("quick-stage").click();
  await stage.waitForURL(`**/stage/${RECEPTION}`);
  const resume = stage.getByTestId("resume");
  if (await resume.isVisible().catch(() => false)) await resume.click();

  for (let i = 0; i < 60; i++) {
    await stage.getByTestId("call-next").click();
    await expect(stage.getByTestId("flash")).toBeVisible();
    const text = await stage.getByTestId("flash").innerText();
    if (text === `Called token ${token}`) break;
    if (/No one is waiting/.test(text)) throw new Error("queue emptied before our token was called");
  }

  // 4. TV shows our token, and nothing private
  await expect(tv.getByTestId("tv-token")).toHaveText(token, { timeout: 10_000 });
  const tvText = await tv.locator("body").innerText();
  expect(tvText).not.toContain("family");
  expect(tvText).not.toContain(PHONE);
  await expect.poll(() => telemetry.length, { timeout: 10_000 }).toBeGreaterThan(0);
  expect(telemetry[0]).toContain('"chime"');
});

test("audio endpoint timing out still plays chime and the next call works", async ({ page }) => {
  await page.route("**/api/tv/announcement/**", async (route) => {
    await new Promise((r) => setTimeout(r, 5000)); // > 3.5 s
    await route.fulfill({ status: 200, contentType: "audio/mpeg", body: "" });
  });
  const telemetry: string[] = [];
  page.on("request", (r) => r.url().includes("/api/tv/telemetry") && telemetry.push(r.postData() ?? ""));
  await page.goto(`/tv/${RECEPTION}?key=${RECEPTION_TV_KEY}`);
  await page.getByTestId("tv").click();
  const before = await page.getByTestId("tv-token").innerText();

  // call next via the API with the stage user's session
  const stage = await page.context().browser()!.newPage();
  await stage.goto("/login");
  await stage.getByTestId("quick-stage").click();
  await stage.waitForURL("**/stage");
  const res = await stage.request.post(`/api/queue/${RECEPTION}/call-next`, { headers: { "idempotency-key": crypto.randomUUID() } });
  test.skip(res.status() === 409, "Queue empty or paused — reseed to run this test");
  expect(res.ok()).toBe(true);
  const { token } = await res.json();

  await expect(page.getByTestId("tv-token")).not.toHaveText(before, { timeout: 10_000 });
  await expect(page.getByTestId("tv-token")).toHaveText(String(token));
  await expect.poll(() => telemetry.some((t) => t.includes("timeout")), { timeout: 10_000 }).toBe(true);

  const again = await stage.request.post(`/api/queue/${RECEPTION}/call-next`, { headers: { "idempotency-key": crypto.randomUUID() } });
  expect([200, 409]).toContain(again.status()); // works (or queue legitimately empty)
});
