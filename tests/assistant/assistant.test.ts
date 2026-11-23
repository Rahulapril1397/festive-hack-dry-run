import { describe, expect, it, vi } from "vitest";
import evalSet from "./eval.json";
import expected from "./expectedTools.json";
import { DEFAULT_ROLE_PERMISSIONS } from "@/lib/authz/staticMap";
import { TOOLS, allowedFor, type ToolDef } from "@/lib/assistant/tools";
import { DENIED, FRIENDLY, MAX_ITERATIONS, runLoop, type ProposedAction } from "@/lib/assistant/loop";
import { mockProvider, type ChatRequest } from "@/lib/assistant/provider";
import { buildSystemPrompt } from "@/lib/assistant/context";

type Role = keyof typeof expected;
const permsOf = (role: Role) => new Set<string>(role === "guest" ? [] : DEFAULT_ROLE_PERMISSIONS[role as keyof typeof DEFAULT_ROLE_PERMISSIONS]);
const kindOf = (role: Role) => (role === "guest" ? "guest" : "staff") as "guest" | "staff";

/** Spy copies of every tool: nothing touches a database, and we can see what ran. */
function spyTools() {
  const runs: string[] = [];
  const all: ToolDef[] = TOOLS.map((t) => ({ ...t, run: vi.fn(async () => { runs.push(t.name); return { ok: true }; }) as never }));
  return { all, runs };
}

/** Mock model: first turn attempts one tool call, second turn answers. */
const attemptThenAnswer = (tool: string, args: unknown) =>
  mockProvider([
    () => ({ text: "", toolCalls: [{ id: "t1", name: tool, input: args }], stopReason: "tool_use" }),
    (req: ChatRequest) => {
      const last = req.turns.at(-1);
      return { text: last?.role === "tool_results" ? `ok: ${last.results[0]!.content.slice(0, 40)}` : "ok", toolCalls: [], stopReason: "end" };
    },
  ]);

describe("tool filtering (fixture per role)", () => {
  for (const role of Object.keys(expected) as Role[]) {
    it(`${role} sees exactly the expected tools`, () => {
      expect(allowedFor(kindOf(role), permsOf(role)).map((t) => t.name).sort()).toEqual([...expected[role]].sort());
    });
  }
  it("the mock model is shown only allowed tools", async () => {
    const p = mockProvider(() => ({ text: "hi", toolCalls: [], stopReason: "end" }));
    await runLoop("sys", [], "hello", { provider: p, caller: {}, tools: allowedFor("staff", permsOf("kitchen")), recheck: async () => true, propose: vi.fn() });
    expect(p.calls[0]!.tools.map((t) => t.name).sort()).toEqual([...expected.kitchen].sort());
  });
});

describe(`eval set (${evalSet.cases.length} prompts, mock provider)`, () => {
  for (const c of evalSet.cases) {
    it(`#${c.id} ${c.role}: "${c.prompt}" → ${c.expect}`, async () => {
      const role = c.role as Role;
      const { all, runs } = spyTools();
      const allowedNames = new Set(allowedFor(kindOf(role), permsOf(role)).map((t) => t.name));
      const tools = all.filter((t) => allowedNames.has(t.name));
      const propose = vi.fn(async (t: ToolDef, args: unknown): Promise<ProposedAction> => ({ id: "a1", token: "x".repeat(43), summary: t.name, tool: t.name, args, expiresAt: new Date().toISOString() }));
      const res = await runLoop("sys", [], c.prompt, { provider: attemptThenAnswer(c.attempt.tool, c.attempt.args), caller: {}, tools, recheck: async (t) => allowedNames.has(t.name), propose });

      // The one invariant that matters: a tool outside the role's list never runs.
      for (const name of runs) expect(allowedNames.has(name), `${name} ran for ${role}`).toBe(true);
      if (c.expect === "executed") expect(res.executed).toEqual([c.attempt.tool]);
      if (c.expect === "denied") {
        expect(res.denied).toEqual([c.attempt.tool]);
        expect(runs).toEqual([]);
        expect(res.text).toContain(DENIED.slice(0, 20));
      }
      if (c.expect === "proposed") {
        expect(propose).toHaveBeenCalledTimes(1);
        expect(runs).toEqual([]); // writes never execute inside the loop
        expect(res.proposedAction?.tool).toBe(c.attempt.tool);
      }
      if (c.expect === "invalid") {
        expect(runs).toEqual([]);
        expect(propose).not.toHaveBeenCalled();
      }
    });
  }
});

describe("loop safety", () => {
  const base = { caller: {}, tools: [] as ToolDef[], recheck: async () => true, propose: vi.fn() };

  it("model timeout → friendly message, no stack trace", async () => {
    const hang = mockProvider(() => new Promise(() => {}));
    const res = await runLoop("sys", [], "hi", { ...base, provider: hang, timeoutMs: 50 });
    expect(res).toMatchObject({ outcome: "timeout", text: FRIENDLY.timeout });
  });

  it("provider error → friendly message", async () => {
    const boom = mockProvider(() => Promise.reject(new Error("ECONNRESET at internal/net.js:42")));
    const res = await runLoop("sys", [], "hi", { ...base, provider: boom });
    expect(res.text).toBe(FRIENDLY.error);
    expect(res.text).not.toMatch(/ECONNRESET|\.js/);
  });

  it(`stops after ${MAX_ITERATIONS} model calls`, async () => {
    const { all } = spyTools();
    const loopy = mockProvider(() => ({ text: "", toolCalls: [{ id: "x", name: "explain_screen", input: { topic: "queue" } }], stopReason: "tool_use" }));
    const res = await runLoop("sys", [], "hi", { ...base, provider: loopy, tools: all.filter((t) => t.name === "explain_screen") });
    expect(loopy.calls).toHaveLength(MAX_ITERATIONS);
    expect(res.outcome).toBe("iterations");
  });

  it("refusal stop reason → polite refusal", async () => {
    const res = await runLoop("sys", [], "hi", { ...base, provider: mockProvider(() => ({ text: "", toolCalls: [], stopReason: "refusal" })) });
    expect(res).toMatchObject({ outcome: "refusal", text: FRIENDLY.refusal });
  });

  it("a permission removed mid-conversation (recheck fails) denies execution", async () => {
    const { all, runs } = spyTools();
    const res = await runLoop("sys", [], "ledger?", { ...base, provider: attemptThenAnswer("ledger_summary", {}), tools: all.filter((t) => t.name === "ledger_summary"), recheck: async () => false });
    expect(runs).toEqual([]);
    expect(res.denied).toEqual(["ledger_summary"]);
  });

  it("the assistant's raw content is echoed back unchanged on the next call", async () => {
    const raw = [{ type: "thinking", thinking: "", signature: "sig" }, { type: "tool_use", id: "t1", name: "explain_screen", input: { topic: "queue" } }];
    const { all } = spyTools();
    const p = mockProvider([
      () => ({ text: "", toolCalls: [{ id: "t1", name: "explain_screen", input: { topic: "queue" } }], raw, stopReason: "tool_use" }),
      () => ({ text: "done", toolCalls: [], stopReason: "end" }),
    ]);
    await runLoop("sys", [], "hi", { ...base, provider: p, tools: all.filter((t) => t.name === "explain_screen") });
    const echoed = p.calls[1]!.turns.find((t) => t.role === "assistant");
    expect(echoed && "raw" in echoed ? echoed.raw : null).toEqual(raw);
  });
});

describe("system prompt", () => {
  it("states role, wedding, date, language and the access rules", () => {
    const p = buildSystemPrompt({ kind: "guest", familyId: "f", weddingId: "w", language: "hi", linkKey: "k", events: [], weddingName: "Aarav & Meera" }, "guest", "# KB", "2026-12-13");
    expect(p).toContain("Aarav & Meera");
    expect(p).toContain("2026-12-13");
    expect(p).toContain("Hindi");
    expect(p).toContain("I cannot access that");
    expect(p).toContain("Never reveal data about any other family");
  });
});

describe("Sarvam chat provider (request/response mapping)", () => {
  it("sends OpenAI-style tools and replays tool calls/results; parses tool_calls", async () => {
    const { sarvamChatProvider } = await import("@/lib/assistant/provider");
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ choices: [{ finish_reason: "tool_calls", message: { content: "\n", tool_calls: [{ id: "call-1", type: "function", function: { name: "queue_status", arguments: "{}" } }] } }] }))) as unknown as typeof fetch;
    const p = sarvamChatProvider({ apiKey: "sk_test", fetchImpl });
    const res = await p.chat({
      system: "sys",
      turns: [
        { role: "user", text: "q" },
        { role: "assistant", text: "", toolCalls: [{ id: "call-0", name: "explain_screen", input: { topic: "x" } }] },
        { role: "tool_results", results: [{ id: "call-0", content: "kb", isError: false }] },
      ],
      tools: [{ name: "queue_status", description: "d", inputSchema: { type: "object", properties: {} } }],
    });
    expect(res).toMatchObject({ stopReason: "tool_use", toolCalls: [{ id: "call-1", name: "queue_status", input: {} }], text: "" });
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe("https://api.sarvam.ai/v1/chat/completions");
    expect((init as RequestInit).headers).toMatchObject({ "api-subscription-key": "sk_test" });
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.model).toBe("sarvam-105b");
    expect(body.tools[0]).toEqual({ type: "function", function: { name: "queue_status", description: "d", parameters: { type: "object", properties: {} } } });
    expect(body.messages.map((m: { role: string }) => m.role)).toEqual(["system", "user", "assistant", "tool"]);
    expect(body.messages[2].tool_calls[0].function).toEqual({ name: "explain_screen", arguments: '{"topic":"x"}' });
    expect(body.messages[3]).toEqual({ role: "tool", tool_call_id: "call-0", content: "kb" });
  });

  it("content_filter → refusal; bad argument JSON is passed on so the strict schema rejects it", async () => {
    const { sarvamChatProvider } = await import("@/lib/assistant/provider");
    const mk = (b: unknown) => vi.fn(async () => new Response(JSON.stringify(b))) as unknown as typeof fetch;
    const refused = await sarvamChatProvider({ apiKey: "k", fetchImpl: mk({ choices: [{ finish_reason: "content_filter", message: { content: null } }] }) }).chat({ system: "", turns: [], tools: [] });
    expect(refused.stopReason).toBe("refusal");
    const bad = await sarvamChatProvider({ apiKey: "k", fetchImpl: mk({ choices: [{ finish_reason: "tool_calls", message: { tool_calls: [{ id: "c", function: { name: "my_rsvp", arguments: "{oops" } }] } }] }) }).chat({ system: "", turns: [], tools: [] });
    expect(bad.toolCalls[0]!.input).toEqual({ __invalid_json__: "{oops" });
  });

  it("no SARVAM_API_KEY → provider unavailable (widget says so, app keeps working)", async () => {
    const { sarvamChatProvider, ProviderUnavailable } = await import("@/lib/assistant/provider");
    expect(() => sarvamChatProvider({ apiKey: "" })).toThrow(ProviderUnavailable);
  });
});
