/**
 * Flagsmith Flags API (server-side environment key), verified against the published OpenAPI:
 *   GET  {FLAGSMITH_API_URL}/flags/       header X-Environment-Key → [{ feature: { name }, enabled, feature_state_value }]
 *   POST {FLAGSMITH_API_URL}/identities/  { identifier, traits: [{ trait_key, trait_value }] } → { flags: [...] }
 * Every call has a timeout; results are cached for 30 s. No key → local defaults in tests/local
 * only; in staging/prod a missing key throws, so callers take their safe fallback.
 */
import { FLAG_DEFAULTS, type FlagName } from "./defaults";
import { mockAllowed } from "@/lib/mockPolicy";

export type FlagMap = Partial<Record<string, { enabled: boolean; value: unknown }>>;

export type FlagClientOptions = {
  serverKey?: string;
  apiUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  ttlMs?: number;
  now?: () => number;
  allowMock?: boolean;
};

type RawFlag = { feature?: { name?: unknown }; enabled?: unknown; feature_state_value?: unknown };

export class FlagsmithError extends Error {}

function toMap(raw: unknown): FlagMap {
  if (!Array.isArray(raw)) throw new FlagsmithError("invalid flags payload");
  const out: FlagMap = {};
  for (const f of raw as RawFlag[]) {
    if (typeof f?.feature?.name !== "string" || typeof f.enabled !== "boolean") throw new FlagsmithError("invalid flag entry");
    out[f.feature.name] = { enabled: f.enabled, value: f.feature_state_value };
  }
  return out;
}

export function createFlagClient(opts: FlagClientOptions = {}) {
  const serverKey = opts.serverKey ?? "";
  const apiUrl = (opts.apiUrl ?? "https://edge.api.flagsmith.com/api/v1").replace(/\/$/, "");
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 2000;
  const ttlMs = opts.ttlMs ?? 30_000;
  const now = opts.now ?? Date.now;
  const cache = new Map<string, { at: number; flags: FlagMap }>();

  const mock = !serverKey && (opts.allowMock ?? mockAllowed());
  const unconfigured = !serverKey && !mock;
  const mockFlags = (): FlagMap =>
    Object.fromEntries(Object.entries(FLAG_DEFAULTS).map(([k, v]) => [k, { enabled: v, value: null }]));

  async function call(path: string, init: RequestInit): Promise<unknown> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(`${apiUrl}${path}`, {
        ...init,
        signal: ctrl.signal,
        headers: { "X-Environment-Key": serverKey, "content-type": "application/json", ...(init.headers ?? {}) },
      });
      if (!res.ok) throw new FlagsmithError(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      throw e instanceof FlagsmithError ? e : new FlagsmithError(ctrl.signal.aborted ? "timeout" : String(e));
    } finally {
      clearTimeout(timer);
    }
  }

  async function cached(key: string, load: () => Promise<FlagMap>): Promise<FlagMap> {
    const hit = cache.get(key);
    if (hit && now() - hit.at < ttlMs) return hit.flags;
    const flags = await load();
    cache.set(key, { at: now(), flags });
    return flags;
  }

  return {
    mock,
    configured: !!serverKey,
    /** Environment flags. Throws FlagsmithError on timeout/outage/invalid response. */
    environmentFlags(): Promise<FlagMap> {
      if (mock) return Promise.resolve(mockFlags());
      if (unconfigured) return Promise.reject(new FlagsmithError("FLAGSMITH_SERVER_KEY not configured"));
      return cached("env", async () => toMap(await call("/flags/", { method: "GET" })));
    },
    /** Flags for an identity (used for per-role overrides). */
    identityFlags(identifier: string, traits: Record<string, string>): Promise<FlagMap> {
      if (mock) return Promise.resolve(mockFlags());
      if (unconfigured) return Promise.reject(new FlagsmithError("FLAGSMITH_SERVER_KEY not configured"));
      return cached(`id:${identifier}`, async () => {
        const body = await call("/identities/", {
          method: "POST",
          body: JSON.stringify({
            identifier,
            traits: Object.entries(traits).map(([trait_key, trait_value]) => ({ trait_key, trait_value })),
          }),
        });
        return toMap((body as { flags?: unknown })?.flags);
      });
    },
    invalidate() {
      cache.clear();
    },
  };
}

export type FlagClient = ReturnType<typeof createFlagClient>;

let singleton: FlagClient | undefined;
export function flagClient(): FlagClient {
  singleton ??= createFlagClient({
    serverKey: process.env.FLAGSMITH_SERVER_KEY ?? "",
    apiUrl: process.env.FLAGSMITH_API_URL || undefined,
  });
  return singleton;
}

export type { FlagName };
