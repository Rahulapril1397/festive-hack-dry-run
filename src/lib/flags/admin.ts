/**
 * Flagsmith Admin (Management) API — used ONLY to turn voice_calls OFF after a human approves
 * a NudgeBee recommendation. Endpoints from https://api.flagsmith.com/api/v1/swagger.json:
 *   GET   /environments/{env_api_key}/featurestates/?feature_name=voice_calls
 *   PATCH /environments/{env_api_key}/featurestates/{id}/   { enabled: false }
 *   GET   /environments/{env_api_key}/featurestates/{id}/   (read-back)
 * Auth: "Authorization: Api-Key <organisation key>". Environments using feature versioning v2
 * reject the PATCH; that surfaces as {ok:false} and the operator toggles by hand.
 */
export type AdminResult =
  | { ok: true; enabled: boolean }
  | { ok: false; reason: "not_configured" | "not_found" | "http" | "timeout" | "invalid" ; detail?: string };

type Opts = { adminKey?: string; envKey?: string; apiUrl?: string; fetchImpl?: typeof fetch; timeoutMs?: number };

export async function setFeatureEnabled(feature: string, enabled: boolean, opts: Opts = {}): Promise<AdminResult> {
  const adminKey = opts.adminKey ?? process.env.FLAGSMITH_ADMIN_KEY ?? "";
  const envKey = opts.envKey ?? process.env.FLAGSMITH_ENVIRONMENT_KEY ?? "";
  const base = (opts.apiUrl ?? process.env.FLAGSMITH_ADMIN_API_URL ?? "https://api.flagsmith.com/api/v1").replace(/\/$/, "");
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 5000;
  if (!adminKey || !envKey) return { ok: false, reason: "not_configured" };

  const call = async (path: string, init: RequestInit = {}) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(`${base}${path}`, {
        ...init,
        signal: ctrl.signal,
        headers: { Authorization: `Api-Key ${adminKey}`, "content-type": "application/json" },
      });
      if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { kind: "http" as const });
      return (await res.json()) as unknown;
    } catch (e) {
      if (ctrl.signal.aborted) throw Object.assign(new Error("timeout"), { kind: "timeout" as const });
      throw e;
    } finally {
      clearTimeout(t);
    }
  };

  try {
    const env = encodeURIComponent(envKey);
    const list = (await call(`/environments/${env}/featurestates/?feature_name=${encodeURIComponent(feature)}`)) as {
      results?: { id: number; enabled: boolean; identity?: unknown; feature_segment?: unknown }[];
    };
    const fs = list.results?.find((r) => r.identity == null && r.feature_segment == null);
    if (!fs || typeof fs.id !== "number") return { ok: false, reason: "not_found" };
    await call(`/environments/${env}/featurestates/${fs.id}/`, { method: "PATCH", body: JSON.stringify({ enabled }) });
    const back = (await call(`/environments/${env}/featurestates/${fs.id}/`)) as { enabled?: unknown };
    if (typeof back.enabled !== "boolean") return { ok: false, reason: "invalid" };
    return { ok: true, enabled: back.enabled };
  } catch (e) {
    const kind = (e as { kind?: string }).kind;
    return { ok: false, reason: kind === "timeout" ? "timeout" : kind === "http" ? "http" : "invalid", detail: String((e as Error).message) };
  }
}
