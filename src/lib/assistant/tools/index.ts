/**
 * PinkyBua tool registry (provided to E1/E3: add Stage 3/4 tools here).
 * Each tool: Zod schema + strict JSON schema, an access rule, and run() calling an existing domain
 * service with the CALLER's scope. Guest tools take no family/wedding argument: identity comes
 * from the signed cookie only. Tools marked write never run inside the model loop.
 */
import { z, type ZodTypeAny } from "zod";
import type { Permission } from "@/lib/authz/catalogue";
import type { Caller } from "../caller";

export type Access = { anyOf: Permission[] } | { guest: true };

export type ToolDef = {
  name: string;
  description: string;
  input: ZodTypeAny;
  jsonSchema: Record<string, unknown>;
  access: Access;
  /** write tools are proposed, confirmed by the user, re-checked and executed by /api/assistant/confirm */
  write?: boolean;
  summarize?: (args: never) => string;
  run: (caller: Caller, args: never) => Promise<unknown>;
};

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });
const uuidProp = (d: string) => ({ type: "string", description: d });

// Lazy imports keep this registry loadable in unit tests (filtering) without a database.
const queue = () => import("@/domain/queue/service");
const ledger = () => import("@/domain/ledger/service");
const ledgerModel = () => import("@/domain/ledger/model");
const data = () => import("./data");

export const TOOLS: ToolDef[] = [
  {
    name: "queue_status",
    description: "Stage queue per function: paused or running, token now on stage, next token, how many are waiting. Tokens only, no names.",
    input: z.object({ eventId: z.string().uuid().optional() }).strict(),
    jsonSchema: obj({ eventId: uuidProp("Optional function id; omit for all functions") }),
    access: { anyOf: ["queue.read"] },
    run: async (c, args: { eventId?: string }) => (await data()).queueStatus(c, args.eventId, await queue()),
  },
  {
    name: "rsvp_summary",
    description: "RSVP and plate counts per function: attending / not attending / pending families, planned plates, arrived families.",
    input: z.object({}).strict(),
    jsonSchema: obj({}),
    access: { anyOf: ["families.read", "kitchen.read"] },
    run: async (c) => (await data()).rsvpSummary(c),
  },
  {
    name: "find_family_token",
    description: "Look up one family by token number: family name, token and queue status per function. No phone numbers.",
    input: z.object({ token: z.number().int().positive().max(999999) }).strict(),
    jsonSchema: obj({ token: { type: "integer", description: "Token number" } }, ["token"]),
    access: { anyOf: ["queue.read"] },
    run: async (c, args: { token: number }) => (await data()).findFamilyToken(c, args.token),
  },
  {
    name: "photo_review_counts",
    description: "Photo matching counts per function: Matched (confirmed), Check this (needs a person), Unmatched.",
    input: z.object({}).strict(),
    jsonSchema: obj({}),
    access: { anyOf: ["photos.review"] },
    run: async (c) => (await data()).photoCounts(c),
  },
  {
    name: "ledger_summary",
    description: "Shagun ledger counts and totals only: entries, cash total, UPI total, boxed gifts, unmatched envelopes. No per-family amounts.",
    input: z.object({}).strict(),
    jsonSchema: obj({}),
    access: { anyOf: ["ledger.read"] },
    run: async (c) => (await data()).ledgerSummary(c, await ledger(), await ledgerModel()),
  },
  {
    name: "explain_screen",
    description: "How-to help from the knowledge base for the caller's role (e.g. 'how do I pause the queue', 'what does Check this mean').",
    input: z.object({ topic: z.string().min(2).max(200) }).strict(),
    jsonSchema: obj({ topic: { type: "string", description: "What the user wants explained" } }, ["topic"]),
    access: { anyOf: ["assistant.use"] },
    run: async (c, args: { topic: string }) => (await data()).explain(c, args.topic),
  },
  {
    name: "my_rsvp",
    description: "This family's own RSVP per function (attending, number of guests).",
    input: z.object({}).strict(),
    jsonSchema: obj({}),
    access: { guest: true },
    run: async (c) => (await data()).myRsvp(c),
  },
  {
    name: "my_queue",
    description: "This family's own check-in status, token, place in the queue and the token now on stage, per function.",
    input: z.object({}).strict(),
    jsonSchema: obj({}),
    access: { guest: true },
    run: async (c) => (await data()).myQueue(c),
  },
  {
    name: "faq",
    description: "Guest FAQ: check-in, waiting for the stage, RSVP, language, photos, privacy.",
    input: z.object({ topic: z.string().min(2).max(200) }).strict(),
    jsonSchema: obj({ topic: { type: "string" } }, ["topic"]),
    access: { guest: true },
    run: async (c, args: { topic: string }) => (await data()).explain(c, args.topic),
  },
  {
    name: "set_my_language",
    description: "Proposes changing the caller's own language (English or Hindi). The user must confirm on a card before it changes.",
    input: z.object({ language: z.enum(["en", "hi"]) }).strict(),
    jsonSchema: obj({ language: { type: "string", enum: ["en", "hi"] } }, ["language"]),
    access: { anyOf: ["assistant.use"] }, // guests: see allowedFor()
    write: true,
    summarize: ((args: { language: "en" | "hi" }) => `Change your language to ${args.language === "hi" ? "Hindi (हिन्दी)" : "English"}`) as never,
    run: async (c, args: { language: "en" | "hi" }) => (await data()).setMyLanguage(c, args.language),
  },
];

/** Tools a guest may use (identity from the cookie only). */
const GUEST_WRITE_TOOLS = new Set(["set_my_language"]);

/**
 * Pure filter: which tools this caller may see/use, given their permission set in the wedding.
 * Called before the model sees the list AND again at execution time.
 */
export function allowedFor(kind: "staff" | "guest", permissions: ReadonlySet<string>): ToolDef[] {
  return TOOLS.filter((t) => {
    if (kind === "guest") return "guest" in t.access || GUEST_WRITE_TOOLS.has(t.name);
    return "anyOf" in t.access && t.access.anyOf.some((p) => permissions.has(p));
  });
}

export function permissionsOf(c: Caller): ReadonlySet<string> {
  return c.kind === "staff" ? (c.session.status === "active" ? c.session.permissions : new Set()) : new Set();
}

export const toolByName = (name: string) => TOOLS.find((t) => t.name === name);
