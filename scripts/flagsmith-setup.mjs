#!/usr/bin/env node
/**
 * Create the Flagsmith flags the minimal demo needs (idempotent: existing flags are left alone):
 *   sarvam_force_fail   OFF   demo switch: makes Sarvam voice look failed, PinkyBua drops to English text chat
 *   pinkybua_languages  ON    value "50" = share of guests placed in language group B (OFF = 0)
 * Uses FLAGSMITH_ADMIN_KEY (organisation key) and FLAGSMITH_ENVIRONMENT_KEY from .env.local, then
 * reads both flags back with the server key the app uses. Never prints keys.
 */
import { readFileSync } from "node:fs";

const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/\s+#.*$/, "").trim()]));
const admin = env.FLAGSMITH_ADMIN_KEY, envKey = env.FLAGSMITH_ENVIRONMENT_KEY, serverKey = env.FLAGSMITH_SERVER_KEY;
const base = (env.FLAGSMITH_ADMIN_API_URL || "https://api.flagsmith.com/api/v1").replace(/\/$/, "");
const edge = (env.FLAGSMITH_API_URL || "https://edge.api.flagsmith.com/api/v1").replace(/\/$/, "");
if (!admin || !envKey || !serverKey) { console.error("Need FLAGSMITH_ADMIN_KEY, FLAGSMITH_ENVIRONMENT_KEY and FLAGSMITH_SERVER_KEY in .env.local"); process.exit(1); }
const H = { Authorization: `Api-Key ${admin}`, "content-type": "application/json" };
const call = async (path, init = {}) => {
  const r = await fetch(`${base}${path}`, { ...init, headers: H });
  const text = await r.text();
  if (!r.ok) throw new Error(`${init.method ?? "GET"} ${path} → ${r.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : {};
};

const environment = await call(`/environments/${encodeURIComponent(envKey)}/`);
const project = environment.project;
console.log(`Environment "${environment.name}", project ${project}`);

const WANT = [
  { name: "sarvam_force_fail", enabled: false, value: null, description: "Demo switch: treat Sarvam voice as failed; PinkyBua drops to English text chat" },
  { name: "pinkybua_languages", enabled: true, value: "50", description: "Share (0-100) of guests placed in language group B; OFF = 0" },
];
for (const w of WANT) {
  const found = await call(`/projects/${project}/features/?search=${encodeURIComponent(w.name)}`);
  const hit = (found.results ?? []).find((f) => f.name === w.name);
  if (hit) { console.log(`exists   ${w.name}`); continue; }
  await call(`/projects/${project}/features/`, { method: "POST", body: JSON.stringify({ name: w.name, description: w.description, default_enabled: w.enabled, initial_value: w.value, type: "STANDARD" }) });
  console.log(`created  ${w.name} (${w.enabled ? "ON" : "OFF"}${w.value ? `, value ${w.value}` : ""})`);
}

// Read back with the server key (the one the app uses).
const flags = await (await fetch(`${edge}/flags/`, { headers: { "X-Environment-Key": serverKey } })).json();
for (const w of WANT) {
  const f = flags.find((x) => x.feature?.name === w.name);
  console.log(`read-back ${w.name}: ${f ? `${f.enabled ? "ON" : "OFF"}${f.feature_state_value != null ? `, value ${f.feature_state_value}` : ""}` : "NOT VISIBLE YET (edge cache can take a minute)"}`);
}
const vc = flags.find((x) => x.feature?.name === "voice_calls");
console.log(`voice_calls: ${vc ? (vc.enabled ? "ON" : "OFF") : "missing"}`);
