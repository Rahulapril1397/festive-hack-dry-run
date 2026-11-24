import "server-only";
import { db, rpc } from "@/lib/db/service";
import { AppError } from "@/lib/errors";
import { log } from "@/lib/log";
import { hasPermission } from "@/lib/authz";
import { sarvam } from "@/lib/sarvam/client";
import type { Caller } from "./caller";
import { callerRole } from "./caller";
import { buildSystemPrompt } from "./context";
import { argsHash, newConfirmToken, sha256 } from "./hash";
import { knowledgeFor } from "./kb";
import { FRIENDLY, runLoop, type ProposedAction } from "./loop";
import { defaultProvider, type ChatProvider, type Turn } from "./provider";
import { allowedFor, permissionsOf, toolByName, type ToolDef } from "./tools";
import { inScope, scopedTools } from "./scope";
import { detectLanguage } from "./language";
import type { AppLanguage } from "@/lib/sarvam/languages";

const HISTORY_TURNS = 24;
const ACTION_TTL_MS = 5 * 60_000;

async function sessionFor(c: Caller, sessionId?: string): Promise<string> {
  const owner = c.kind === "staff" ? { user_id: c.session.userId, family_id: null } : { user_id: null, family_id: c.familyId };
  if (sessionId) {
    let q = db().from("assistant_session").select("id").eq("id", sessionId).eq("wedding_id", c.weddingId);
    q = owner.user_id ? q.eq("user_id", owner.user_id) : q.eq("family_id", owner.family_id!);
    const { data } = await q.maybeSingle();
    if (data) {
      await db().from("assistant_session").update({ last_at: new Date().toISOString() }).eq("id", sessionId);
      return data.id;
    }
  }
  const { data, error } = await db().from("assistant_session").insert({ kind: c.kind, ...owner, wedding_id: c.weddingId }).select("id").single();
  if (error) throw new Error(error.message);
  return data.id;
}

/** Replay whole exchanges only (start at a user turn), so tool_use / tool_result pairs stay intact. */
async function history(sessionId: string): Promise<Turn[]> {
  const { data } = await db().from("assistant_message").select("role, content").eq("session_id", sessionId).order("id", { ascending: false }).limit(HISTORY_TURNS);
  const turns = (data ?? []).reverse().map((r) => r.content as Turn);
  const firstUser = turns.findIndex((t) => t.role === "user");
  return firstUser === -1 ? [] : turns.slice(firstUser);
}

async function recheck(c: Caller, tool: ToolDef): Promise<boolean> {
  if (!allowedFor(c.kind, permissionsOf(c)).some((t) => t.name === tool.name)) return false;
  if (c.kind === "staff" && "anyOf" in tool.access) {
    for (const p of tool.access.anyOf) if (await hasPermission(c.session, p, c.weddingId)) return true;
    return false;
  }
  return true;
}

export async function runAssistant(c0: Caller, input: { sessionId?: string; text: string; replyLanguage?: AppLanguage }, provider: ChatProvider | null = defaultProvider()) {
  // Reply in the language the person is using: forced by the caller (voice detection, English fallback),
  // else the script of what they typed, else the language of their link (guests) / English (staff).
  const c: Caller = { ...c0, language: input.replyLanguage ?? detectLanguage(input.text, c0.language) ?? c0.language };
  const sessionId = await sessionFor(c, input.sessionId);
  if (!provider) return { sessionId, text: FRIENDLY.error };
  const role = callerRole(c);
  const system = buildSystemPrompt(c, role, knowledgeFor(role), new Date().toISOString().slice(0, 10));
  const tools = scopedTools(c.kind, permissionsOf(c));
  const started = Date.now();

  const result = await runLoop(system, await history(sessionId), input.text, {
    provider,
    caller: c,
    tools,
    recheck: async (t) => inScope(c.kind, t.name) && (await recheck(c, t)),
    propose: (t, args) => propose(c, sessionId, t, args),
    persist: async (turn) => {
      await db().from("assistant_message").insert({ session_id: sessionId, role: turn.role, content: turn });
    },
  });
  log(result.outcome === "ok" ? "INFO" : "WARNING", "assistant", {
    kind: c.kind, role, outcome: result.outcome, executed: result.executed.join(","), denied: result.denied.join(","), latencyMs: Date.now() - started,
  });

  let text = result.text;
  // Guests get their family language; translate only if the model answered in Latin letters instead of that language's script.
  if (c.language !== "en" && !/[^\u0000-\u024F]/.test(text) && result.outcome === "ok") {
    text = await sarvam().translate(text, c.language).catch(() => text);
  }
  const pa = result.proposedAction;
  return { sessionId, text, proposedAction: pa ? { id: pa.id, token: pa.token, summary: pa.summary, args: pa.args, expiresAt: pa.expiresAt } : undefined };
}

async function propose(c: Caller, sessionId: string, tool: ToolDef, args: unknown): Promise<ProposedAction> {
  const token = newConfirmToken();
  const expiresAt = new Date(Date.now() + ACTION_TTL_MS).toISOString();
  const summary = tool.summarize ? (tool.summarize as (a: unknown) => string)(args) : tool.name;
  const { data, error } = await db()
    .from("assistant_action")
    .insert({ session_id: sessionId, tool: tool.name, args_json: args, args_hash: argsHash(args), summary, confirm_token_hash: sha256(token), expires_at: expiresAt })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return { id: data.id, token, summary, tool: tool.name, args, expiresAt };
}

/**
 * Confirm a proposed write: single-use token, 5-minute expiry, owner check (SQL, atomic), then
 * the args hash, then the tool's permission again, then the normal domain service; audited.
 */
export async function confirmAction(c: Caller, actionId: string, token: string) {
  const owner = c.kind === "staff" ? { p_user: c.session.userId, p_family: null } : { p_user: null, p_family: c.familyId };
  const a = await rpc<{ id: string; tool: string; args_json: unknown; args_hash: string } | null>("assistant_claim_action", { p_id: actionId, p_token_hash: sha256(token), ...owner });
  if (!a) throw new AppError("ACTION_EXPIRED", "This confirmation has expired. Ask again.");
  const actor = c.kind === "staff" ? c.session.userId : null;
  const fail = async (msg: string, code: "ACTION_INVALID" | "FORBIDDEN") => {
    await rpc("assistant_finish_action", { p_id: a.id, p_ok: false, p_error: msg, p_wedding: c.weddingId, p_actor: actor });
    throw new AppError(code, msg);
  };
  const tool = toolByName(a.tool);
  if (!tool || !tool.write) return fail("Unknown action", "ACTION_INVALID");
  if (argsHash(a.args_json) !== a.args_hash) return fail("The proposed change was altered", "ACTION_INVALID");
  const parsed = tool.input.safeParse(a.args_json);
  if (!parsed.success) return fail("Invalid action arguments", "ACTION_INVALID");
  if (!(await recheck(c, tool))) return fail("You no longer have permission for this", "FORBIDDEN");
  try {
    const result = await tool.run(c, parsed.data as never);
    await rpc("assistant_finish_action", { p_id: a.id, p_ok: true, p_error: null, p_wedding: c.weddingId, p_actor: actor });
    return { ok: true, result };
  } catch (e) {
    await rpc("assistant_finish_action", { p_id: a.id, p_ok: false, p_error: "execution failed", p_wedding: c.weddingId, p_actor: actor });
    throw e;
  }
}

export async function cancelAction(c: Caller, actionId: string) {
  const { data } = await db().from("assistant_action").select("id, status, session:session_id(user_id, family_id)").eq("id", actionId).maybeSingle();
  const s = data?.session as unknown as { user_id: string | null; family_id: string | null } | undefined;
  const mine = c.kind === "staff" ? s?.user_id === c.session.userId : s?.family_id === c.familyId;
  if (!data || !mine) throw new AppError("NOT_FOUND");
  if (data.status === "pending") await db().from("assistant_action").update({ status: "cancelled" }).eq("id", actionId).eq("status", "pending");
  return { ok: true };
}
