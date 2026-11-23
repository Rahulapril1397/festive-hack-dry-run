import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";
import { AppError, isErrorCode } from "@/lib/errors";

let client: SupabaseClient | undefined;

/** Service-role client. Server only; bypasses RLS. Every caller must check permissions first. */
export function db(): SupabaseClient {
  client ??= createClient(env().SUPABASE_URL, env().SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}

/** Call a Postgres function; SQL `RAISE EXCEPTION 'QUEUE_PAUSED'` becomes AppError('QUEUE_PAUSED'). */
export async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await db().rpc(fn, args);
  if (error) {
    const msg = error.message?.trim() ?? "";
    if (isErrorCode(msg)) throw new AppError(msg);
    if (error.code === "22P02") throw new AppError("BAD_REQUEST", "Malformed id"); // invalid uuid
    throw new Error(`rpc ${fn} failed: ${error.code} ${error.message}`);
  }
  return data as T;
}

export type EventRow = { id: string; wedding_id: string; name: string; tv_key: string; language: "en" | "hi" };

export async function getEvent(eventId: string): Promise<EventRow> {
  const { data, error } = await db()
    .from("event")
    .select("id, wedding_id, name, tv_key, language")
    .eq("id", eventId)
    .maybeSingle();
  if (error?.code === "22P02" || (!error && !data)) throw new AppError("EVENT_NOT_FOUND");
  if (error) throw new Error(error.message);
  return data as EventRow;
}

export async function listEvents(weddingId: string) {
  const { data, error } = await db()
    .from("event")
    .select("id, name, starts_at")
    .eq("wedding_id", weddingId)
    .order("starts_at", { ascending: true, nullsFirst: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as { id: string; name: string; starts_at: string | null }[];
}
