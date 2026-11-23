/**
 * The PinkyBua loop, independent of HTTP and the database (tests drive it with the mock provider).
 * - At most MAX_ITERATIONS model calls; one overall timeout.
 * - A tool runs only if it is in the caller's allowed list AND passes recheck() at execution.
 * - Write tools never run here: they become a proposed action the user must confirm.
 */
import type { ChatProvider, ToolCall, Turn } from "./provider";
import type { ToolDef } from "./tools";

export const MAX_ITERATIONS = 4;
export const TIMEOUT_MS = 20_000;
export const DENIED = "I cannot access that with your role.";
const MAX_RESULT_CHARS = 8000;

export type ProposedAction = { id: string; token: string; summary: string; tool: string; args: unknown; expiresAt: string };

export type LoopDeps<C> = {
  provider: ChatProvider;
  caller: C;
  tools: ToolDef[];
  recheck: (tool: ToolDef) => Promise<boolean>;
  propose: (tool: ToolDef, args: unknown) => Promise<ProposedAction>;
  persist?: (turn: Turn) => Promise<void>;
  timeoutMs?: number;
};

export type LoopResult = {
  text: string;
  proposedAction?: ProposedAction;
  executed: string[];
  denied: string[];
  outcome: "ok" | "timeout" | "error" | "refusal" | "iterations";
};

export const FRIENDLY = {
  timeout: "Sorry, I'm taking too long right now. Please try again in a moment — the rest of the app keeps working.",
  error: "PinkyBua is not available right now. Everything else in the app keeps working.",
  refusal: "Sorry, I can't help with that one.",
  iterations: "I couldn't finish that. Could you ask in a simpler way?",
};

export async function runLoop<C>(system: string, history: Turn[], userText: string, deps: LoopDeps<C>): Promise<LoopResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), deps.timeoutMs ?? TIMEOUT_MS);
  const turns: Turn[] = [...history, { role: "user", text: userText }];
  const executed: string[] = [];
  const denied: string[] = [];
  let proposedAction: ProposedAction | undefined;
  const save = async (t: Turn) => {
    turns.push(t);
    await deps.persist?.(t).catch(() => {});
  };
  await deps.persist?.({ role: "user", text: userText }).catch(() => {});
  const specs = deps.tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.jsonSchema }));

  try {
    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const res = await race(deps.provider.chat({ system, turns, tools: specs, signal: ctrl.signal }), ctrl.signal);
      await save({ role: "assistant", text: res.text, toolCalls: res.toolCalls, raw: res.raw });
      if (res.stopReason === "refusal") return { text: FRIENDLY.refusal, executed, denied, outcome: "refusal" };
      if (!res.toolCalls.length) return { text: res.text || FRIENDLY.iterations, proposedAction, executed, denied, outcome: "ok" };

      const results: { id: string; content: string; isError?: boolean }[] = [];
      for (const call of res.toolCalls) results.push(await runTool(call));
      await save({ role: "tool_results", results });
      if (ctrl.signal.aborted) throw new DOMException("timeout", "AbortError");
    }
    return { text: FRIENDLY.iterations, proposedAction, executed, denied, outcome: "iterations" };
  } catch (e) {
    const timedOut = ctrl.signal.aborted || (e instanceof DOMException && e.name === "AbortError");
    return { text: timedOut ? FRIENDLY.timeout : FRIENDLY.error, proposedAction, executed, denied, outcome: timedOut ? "timeout" : "error" };
  } finally {
    clearTimeout(timer);
  }

  async function runTool(call: ToolCall) {
    const tool = deps.tools.find((t) => t.name === call.name);
    if (!tool || !(await deps.recheck(tool))) {
      denied.push(call.name);
      return { id: call.id, content: DENIED, isError: true };
    }
    const parsed = tool.input.safeParse(call.input);
    if (!parsed.success) return { id: call.id, content: `Invalid arguments: ${parsed.error.issues.map((x) => x.message).join("; ")}`, isError: true };
    try {
      if (tool.write) {
        if (proposedAction) return { id: call.id, content: "Only one change can be proposed at a time.", isError: true };
        proposedAction = await deps.propose(tool, parsed.data);
        return { id: call.id, content: `Proposed: "${proposedAction.summary}". It has NOT happened yet; the user must press Confirm on the card.` };
      }
      const out = await tool.run(deps.caller as never, parsed.data as never);
      executed.push(tool.name);
      return { id: call.id, content: JSON.stringify(out).slice(0, MAX_RESULT_CHARS) };
    } catch {
      return { id: call.id, content: "That lookup failed. Tell the user to try again.", isError: true };
    }
  }
}

function race<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException("timeout", "AbortError"));
    const onAbort = () => reject(new DOMException("timeout", "AbortError"));
    signal.addEventListener("abort", onAbort, { once: true });
    p.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}
