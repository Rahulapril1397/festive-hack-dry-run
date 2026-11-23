"use client";

/** Small client for /api/admin/* with friendly errors (LAST_SUPER_ADMIN etc. come from the server). */
const FRIENDLY: Record<string, string> = {
  LAST_SUPER_ADMIN: "That would leave no active super admin. Add another super admin first.",
  SYSTEM_ROLE: "The super admin role cannot be edited.",
  ROLE_EXISTS: "A role with that key already exists.",
  FORBIDDEN: "You don't have permission to do that.",
  NOT_FOUND: "Not found — it may have been removed.",
};

export async function api<T>(url: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(url, {
    method: init?.method ?? "GET",
    headers: init?.body !== undefined ? { "content-type": "application/json" } : undefined,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    const code = j?.error?.code as string | undefined;
    throw new Error((code && FRIENDLY[code]) || j?.error?.issues?.[0]?.message || j?.error?.message || `Request failed (${res.status})`);
  }
  return j as T;
}
