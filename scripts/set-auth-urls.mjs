#!/usr/bin/env node
/**
 * Point Supabase Auth at the public address (needed after the https hostname goes live, or sign-in
 * links and redirects keep sending people to the old http address).
 *
 *   node scripts/set-auth-urls.mjs https://pehle-aap.endpoints.<project>.cloud.goog        # apply
 *   node scripts/set-auth-urls.mjs https://…  --dry-run                                     # show current + planned
 *
 * Reads SUPABASE_URL and SUPABASE_ACCESS_TOKEN (a Supabase personal access token) from .env.local.
 * Keeps any existing redirect URLs, and adds <url>/login/accept.
 */
import { readFileSync } from "node:fs";

const base = process.argv[2];
const dry = process.argv.includes("--dry-run");
if (!base || !/^https?:\/\/[^/\s]+$/.test(base)) {
  console.error("usage: node scripts/set-auth-urls.mjs https://<host> [--dry-run]");
  process.exit(2);
}
const env = Object.fromEntries(
  readFileSync(".env.local", "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/\s+#.*$/, "").trim()]),
);
const ref = /^https:\/\/([a-z0-9]+)\.supabase\.co/.exec(env.SUPABASE_URL ?? "")?.[1];
const token = env.SUPABASE_ACCESS_TOKEN;
if (!ref || !token) {
  console.error("Need SUPABASE_URL and SUPABASE_ACCESS_TOKEN in .env.local");
  process.exit(1);
}
const api = `https://api.supabase.com/v1/projects/${ref}/config/auth`;
const H = { authorization: `Bearer ${token}`, "content-type": "application/json" };
const cur = await (await fetch(api, { headers: H })).json();
const existing = String(cur.uri_allow_list ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const next = [...new Set([...existing, `${base}/login/accept`])].join(",");
console.log(`site_url:       ${cur.site_url}  →  ${base}`);
console.log(`uri_allow_list: ${cur.uri_allow_list || "(empty)"}  →  ${next}`);
if (dry) process.exit(0);
const res = await fetch(api, { method: "PATCH", headers: H, body: JSON.stringify({ site_url: base, uri_allow_list: next }) });
if (!res.ok) {
  console.error(`Supabase answered ${res.status}`);
  process.exit(1);
}
const back = await (await fetch(api, { headers: H })).json();
console.log(back.site_url === base ? "Done: read back site_url matches." : `Warning: read back site_url is ${back.site_url}`);
