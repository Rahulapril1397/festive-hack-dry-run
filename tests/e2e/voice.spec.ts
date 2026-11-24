import { expect, test } from "@playwright/test";

/**
 * PinkyBua voice fallback (Stage 3). Run with the server started with SARVAM_FORCE_FAIL=1 (or the
 * Flagsmith flag sarvam_force_fail ON) and E2E_SARVAM_FORCED=1: voice AI is down, so the widget
 * must drop to the default English text chat, and text questions must still be answered.
 */
const LINK = process.env.E2E_FAMILY_LINK ?? "/f/demo000700000007";
test.skip(!process.env.E2E_SARVAM_FORCED, "needs a server with Sarvam forced to fail");

test("guest: voice down → banner, mic disabled, English text chat still answers", async ({ page }) => {
  await page.goto(LINK);
  const pick = page.getByTestId("pick-hi");
  if (await pick.isVisible().catch(() => false)) await pick.click();
  await page.getByTestId("pinkybua-open").click();
  await expect(page.getByTestId("pinkybua-voice-down")).toContainText("default English text chat");
  await expect(page.getByTestId("pinkybua-mic")).toBeDisabled();
  await page.getByTestId("pinkybua-input").fill("What is my token?");
  await page.getByTestId("pinkybua-input").press("Enter");
  await expect(page.getByTestId("pinkybua-thinking")).toBeHidden({ timeout: 25_000 });
  await expect(page.getByTestId("pinkybua-panel")).not.toContainText(/[ऀ-ॿ]{4}/); // replies in English, not Hindi
});
