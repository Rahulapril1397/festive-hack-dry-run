/**
 * Shared Playwright harness (E3 T6; agreed with E1). Runs against a seeded, non-production app
 * (quick-login) — locally or staging via E2E_BASE_URL. Never against production.
 */
import { expect, type APIRequestContext, type Page } from "@playwright/test";

/** Seeded demo users by role (scripts/demoData.ts). */
export const ROLE_EMAIL_LOCAL = {
  super_admin: "superadmin",
  admin: "admin",
  host: "host",
  coordinator: "coordinator",
  stage_manager: "stage",
  kitchen: "kitchen",
  photographer: "photographer",
  finance: "finance",
} as const;
export type E2ERole = keyof typeof ROLE_EMAIL_LOCAL;
export const ROLES = Object.keys(ROLE_EMAIL_LOCAL) as E2ERole[];

export const RECEPTION = "00000000-0000-4000-8000-0000000000a3";
export const RECEPTION_TV_KEY = "demo-tv-reception3";

export async function loginAs(page: Page, role: E2ERole, next = "/") {
  await page.context().clearCookies();
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByTestId(`quick-${ROLE_EMAIL_LOCAL[role]}`).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

export async function logout(page: Page) {
  await page.request.post("/api/auth/logout");
  await page.context().clearCookies();
}

/** Log out and back in as the same role, then reload `path` — the persistence check every screen needs. */
export async function reloginAndOpen(page: Page, role: E2ERole, path: string) {
  await page.reload();
  await logout(page);
  await loginAs(page, role, path);
  await page.goto(path);
}

export async function api<T>(req: APIRequestContext, method: "GET" | "POST" | "PUT" | "DELETE", url: string, data?: unknown): Promise<{ status: number; body: T }> {
  const res = await req.fetch(url, { method, data, headers: data ? { "content-type": "application/json" } : undefined });
  return { status: res.status(), body: (await res.json().catch(() => ({}))) as T };
}

/** A fresh real wedding (no seed data) through E1's admin API, as super admin. */
export async function createWeddingFixture(page: Page, name = `E2E ${Date.now()}`) {
  await loginAs(page, "super_admin");
  const { status, body } = await api<{ weddingId: string; events: { id: string; name: string }[] }>(page.request, "POST", "/api/admin/weddings", {
    wedding: { name, coupleNames: "E2E couple" },
    events: [{ name: "Haldi" }, { name: "Reception" }],
  });
  expect(status).toBe(201);
  return body;
}

export async function selectWedding(page: Page, weddingId: string) {
  const { status } = await api(page.request, "POST", "/api/session/wedding", { weddingId });
  expect(status).toBe(200);
}
