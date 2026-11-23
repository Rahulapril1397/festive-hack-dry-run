/**
 * Post a signed test recommendation (E2 smoke step 5).
 *   APP_URL=… NUDGEBEE_WEBHOOK_SECRET=… npx tsx scripts/nudgebee-test.ts [--bad-signature]
 */
import { signPayload } from "../src/lib/nudgebee/signature";

const url = `${process.env.APP_URL ?? "http://localhost:3000"}/api/integrations/nudgebee/recommendation`;
const secret = process.env.NUDGEBEE_WEBHOOK_SECRET ?? "";
const body = JSON.stringify({
  id: `test-${Date.now()}`,
  text: "TTS requests are failing or timing out (pehle_tts_requests_total{result=~\"failure|timeout\"} rising). Recommend turning voice_calls OFF so the venue TV uses the chime.",
  proposed_action: "voice_calls_off",
});
const ts = String(Date.now());
const sig = process.argv.includes("--bad-signature") ? "sha256=" + "0".repeat(64) : signPayload(secret, ts, body);
const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "x-nudgebee-signature": sig, "x-nudgebee-timestamp": ts }, body });
console.log(res.status, await res.text());
