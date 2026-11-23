import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
const update = vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) }));
vi.mock("@/lib/db/service", () => ({ rpc: (...a: unknown[]) => rpc(...a), db: () => ({ from: () => ({ update }) }), listEvents: vi.fn() }));
const hasPermission = vi.fn(async () => true);
vi.mock("@/lib/authz", () => ({ hasPermission: (...a: unknown[]) => (hasPermission as (...x: unknown[]) => Promise<boolean>)(...a) }));
vi.mock("@/domain/rsvp/service", () => ({ setFamilyLanguage: vi.fn(async () => {}) }));

const { confirmAction } = await import("@/lib/assistant/service");
const { argsHash } = await import("@/lib/assistant/hash");

const staff = (perms: string[]) => ({
  kind: "staff" as const,
  weddingId: "w",
  weddingName: "W",
  language: "en" as const,
  session: { userId: "u", email: null, role: "host", weddingId: "w", roles: ["host"], permissions: new Set(perms), isSuperAdmin: false, status: "active" as const, weddings: [] },
});
const claimed = (args: unknown, hash = argsHash(args)) => ({ id: "a1", tool: "set_my_language", args_json: args, args_hash: hash });

beforeEach(() => {
  rpc.mockReset();
  hasPermission.mockReset().mockResolvedValue(true);
});

describe("confirmAction (TS checks after the atomic SQL claim)", () => {
  it("executes through the domain service and audits success", async () => {
    rpc.mockResolvedValueOnce(claimed({ language: "hi" })).mockResolvedValueOnce(null);
    await expect(confirmAction(staff(["assistant.use"]), "a1", "t".repeat(43))).resolves.toMatchObject({ ok: true });
    expect(update).toHaveBeenCalledWith({ language: "hi" });
    expect(rpc.mock.calls[1]![1]).toMatchObject({ p_ok: true });
  });

  it("changed args (hash mismatch) fail and are recorded as failed", async () => {
    rpc.mockResolvedValueOnce(claimed({ language: "en" }, argsHash({ language: "hi" }))).mockResolvedValueOnce(null);
    await expect(confirmAction(staff(["assistant.use"]), "a1", "t".repeat(43))).rejects.toMatchObject({ code: "ACTION_INVALID" });
    expect(rpc.mock.calls[1]![1]).toMatchObject({ p_ok: false });
  });

  it("permission removed between propose and confirm → FORBIDDEN, nothing executed", async () => {
    update.mockClear();
    rpc.mockResolvedValueOnce(claimed({ language: "hi" })).mockResolvedValueOnce(null);
    await expect(confirmAction(staff([]), "a1", "t".repeat(43))).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(update).not.toHaveBeenCalled();
  });

  it("expired (claim returns null) → ACTION_EXPIRED", async () => {
    rpc.mockResolvedValueOnce(null);
    await expect(confirmAction(staff(["assistant.use"]), "a1", "t".repeat(43))).rejects.toMatchObject({ code: "ACTION_EXPIRED" });
  });
});
