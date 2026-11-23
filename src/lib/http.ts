import "server-only";
import { NextResponse } from "next/server";
import { ZodError, type ZodTypeAny, type z } from "zod";
import { AppError } from "@/lib/errors";

export function json<T>(body: T, init?: number | ResponseInit) {
  return NextResponse.json(body, typeof init === "number" ? { status: init } : init);
}

/** Wrap a route handler: maps AppError / ZodError to `{ error: { code, message } }`. */
export function handle<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (e) {
      if (e instanceof AppError) {
        return json({ error: { code: e.code, message: e.message } }, e.status);
      }
      if (e instanceof ZodError) {
        return json({ error: { code: "BAD_REQUEST", message: "Invalid request", issues: e.issues } }, 400);
      }
      console.error(e);
      return json({ error: { code: "INTERNAL", message: "Something went wrong" } }, 500);
    }
  };
}

export async function parseBody<S extends ZodTypeAny>(req: Request, schema: S): Promise<z.output<S>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new AppError("BAD_REQUEST", "Body must be JSON");
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
