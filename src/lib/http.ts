import "server-only";
import { NextResponse } from "next/server";
import { ZodError, type ZodTypeAny, type z } from "zod";
import { AppError } from "@/lib/errors";
import { log, requestId, routeOf, scrub } from "@/lib/log";

export function json<T>(body: T, init?: number | ResponseInit) {
  return NextResponse.json(body, typeof init === "number" ? { status: init } : init);
}

/**
 * Marks a handler as intentionally public (no requirePermission). The reason is what makes it
 * safe — e.g. "TV key checked", "HMAC signature". scripts/route-audit.ts fails CI for any handler
 * that neither checks a permission nor calls this.
 */
export function publicRoute(reason: string): void {
  void reason;
}

/**
 * Wrap a route handler: maps AppError / ZodError to `{ error: { code, message } }` and writes one
 * structured log line per request (request id, route, method, status, latency).
 */
export function handle<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    const req = args[0] instanceof Request ? args[0] : null;
    const started = performance.now();
    const rid = req ? requestId(req) : crypto.randomUUID();
    let res: Response;
    let errCode: string | undefined;
    try {
      res = await fn(...args);
    } catch (e) {
      if (e instanceof AppError) {
        errCode = e.code;
        res = json({ error: { code: e.code, message: e.message } }, e.status);
      } else if (e instanceof ZodError) {
        errCode = "BAD_REQUEST";
        res = json({ error: { code: "BAD_REQUEST", message: "Invalid request", issues: e.issues.map((i) => ({ path: i.path, message: i.message, code: i.code })) } }, 400);
      } else {
        errCode = "INTERNAL";
        log("ERROR", e instanceof Error ? `${e.name}: ${scrub(e.message)}` : "non-error thrown", { requestId: rid, route: req ? routeOf(req.url) : null });
        res = json({ error: { code: "INTERNAL", message: "Something went wrong" } }, 500);
      }
    }
    log(res.status >= 500 ? "ERROR" : "INFO", "request", {
      requestId: rid,
      method: req?.method,
      route: req ? routeOf(req.url) : null,
      status: res.status,
      latencyMs: Math.round(performance.now() - started),
      error: errCode,
    });
    return res;
  };
}

/** JSON bodies larger than this are refused before parsing (caps what a schema ever has to validate). */
export const MAX_JSON_BODY_BYTES = 1_000_000;

export async function parseBody<S extends ZodTypeAny>(req: Request, schema: S): Promise<z.output<S>> {
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_JSON_BODY_BYTES) throw new AppError("BAD_REQUEST", "Request body too large");
  let raw: unknown;
  try {
    const text = await req.text();
    if (text.length > MAX_JSON_BODY_BYTES) throw new Error("too large");
    raw = JSON.parse(text);
  } catch {
    throw new AppError("BAD_REQUEST", "Body must be JSON (and under 1 MB)");
  }
  return schema.parse(raw);
}

export function idempotencyKey(req: Request): string {
  const key = req.headers.get("idempotency-key")?.trim();
  if (!key || key.length < 8 || key.length > 100) {
    throw new AppError("BAD_REQUEST", "Idempotency-Key header (8–100 chars) is required");
  }
  return key;
}
