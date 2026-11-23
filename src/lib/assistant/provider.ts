/**
 * PinkyBua model adapter: chat({ system, turns, tools }) → { text, toolCalls, raw, stopReason }.
 * Implementations: mock (scripted, for tests) and Anthropic (Messages API, official SDK).
 * The model never receives secrets or database access — only tool results the service chose.
 */
import Anthropic from "@anthropic-ai/sdk";

export type ToolSpec = { name: string; description: string; inputSchema: Record<string, unknown> };
export type ToolCall = { id: string; name: string; input: unknown };

/** Conversation turns, replayed in order. `raw` is the provider's own assistant content, echoed back unchanged. */
export type Turn =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string; toolCalls: ToolCall[]; raw?: unknown }
  | { role: "tool_results"; results: { id: string; content: string; isError?: boolean }[] };

export type ChatRequest = { system: string; turns: Turn[]; tools: ToolSpec[]; signal?: AbortSignal };
export type ChatResponse = { text: string; toolCalls: ToolCall[]; raw?: unknown; stopReason: "end" | "tool_use" | "refusal" | "max_tokens" | "other" };

export interface ChatProvider {
  readonly name: string;
  chat(req: ChatRequest): Promise<ChatResponse>;
}

export class ProviderUnavailable extends Error {}

// ─── mock ───────────────────────────────────────────────────────────────────────────────────
/** Scripted provider for tests: each step decides the reply from the request (e.g. attempt a tool). */
export type MockStep = (req: ChatRequest) => ChatResponse | Promise<ChatResponse>;

export function mockProvider(steps: MockStep[] | MockStep): ChatProvider & { calls: ChatRequest[] } {
  const calls: ChatRequest[] = [];
  let i = 0;
  return {
    name: "mock",
    calls,
    async chat(req) {
      calls.push(structuredClone({ ...req, signal: undefined }));
      if (req.signal?.aborted) throw new DOMException("aborted", "AbortError");
      const step = Array.isArray(steps) ? steps[Math.min(i++, steps.length - 1)]! : steps;
      return step(req);
    },
  };
}

// ─── Anthropic ──────────────────────────────────────────────────────────────────────────────
const DEFAULT_MODEL = "claude-opus-5-5";
/** Models that accept server-side refusal fallbacks in the "default" form. */
const FALLBACK_MODELS = new Set(["claude-opus-5-5", "claude-opus-5", "claude-fable-5-2", "claude-fable-5-1", "claude-sonnet-5-5"]);

export function anthropicProvider(opts: { apiKey?: string; model?: string; client?: Anthropic } = {}): ChatProvider {
  const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY ?? "";
  if (!opts.client && !apiKey) throw new ProviderUnavailable("ANTHROPIC_API_KEY is not set");
  const client = opts.client ?? new Anthropic({ apiKey, maxRetries: 1, timeout: 18_000 });
  const model = opts.model ?? process.env.ASSISTANT_MODEL ?? DEFAULT_MODEL;
  const withFallback = FALLBACK_MODELS.has(model);

  const toParams = (turns: Turn[]): Anthropic.Beta.BetaMessageParam[] =>
    turns.map((t): Anthropic.Beta.BetaMessageParam => {
      if (t.role === "user") return { role: "user", content: t.text };
      if (t.role === "assistant") return { role: "assistant", content: (t.raw as Anthropic.Beta.BetaContentBlockParam[] | undefined) ?? t.text };
      return {
        role: "user",
        content: t.results.map((r) => ({ type: "tool_result" as const, tool_use_id: r.id, content: r.content, is_error: r.isError ?? false })),
      };
    });

  return {
    name: `anthropic:${model}`,
    async chat({ system, turns, tools, signal }) {
      const response = await client.beta.messages.create(
        {
          model,
          max_tokens: 16000,
          system,
          output_config: { effort: "low" }, // chat: short answers, fast; thinking stays adaptive
          cache_control: { type: "ephemeral" },
          tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema as Anthropic.Beta.BetaTool.InputSchema, strict: true })),
          messages: toParams(turns),
          ...(withFallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
        },
        { signal },
      );
      const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n").trim();
      const toolCalls = response.content.flatMap((b) => (b.type === "tool_use" ? [{ id: b.id, name: b.name, input: b.input }] : []));
      const stopReason =
        response.stop_reason === "refusal" ? "refusal"
        : response.stop_reason === "tool_use" ? "tool_use"
        : response.stop_reason === "end_turn" ? "end"
        : response.stop_reason === "max_tokens" ? "max_tokens"
        : "other";
      return { text, toolCalls, raw: response.content, stopReason };
    },
  };
}

/** The configured provider, or null when the assistant is not set up (the widget says so). */
export function defaultProvider(): ChatProvider | null {
  try {
    return anthropicProvider();
  } catch (e) {
    if (e instanceof ProviderUnavailable) return null;
    throw e;
  }
}
