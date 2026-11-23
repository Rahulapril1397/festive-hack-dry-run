import { afterEach, describe, expect, it, vi } from "vitest";
import { copyText } from "@/components/shell/copyText";

/** Minimal browser stand-ins: the vitest environment is node (no DOM). */
function fakeDom(opts: { secure: boolean; clipboard?: { writeText: (t: string) => Promise<void> }; execResult?: boolean; execThrows?: boolean }) {
  const appended: { value: string }[] = [];
  const ta = { value: "", style: {} as Record<string, string>, setAttribute: vi.fn(), select: vi.fn(), setSelectionRange: vi.fn() };
  vi.stubGlobal("window", { isSecureContext: opts.secure });
  vi.stubGlobal("navigator", { clipboard: opts.clipboard });
  const execCommand = vi.fn(() => {
    if (opts.execThrows) throw new Error("blocked");
    return opts.execResult ?? true;
  });
  vi.stubGlobal("document", {
    createElement: vi.fn(() => ta),
    execCommand,
    body: { appendChild: vi.fn((el: { value: string }) => appended.push(el)), removeChild: vi.fn() },
  });
  return { ta, execCommand, appended };
}

afterEach(() => vi.unstubAllGlobals());

describe("copyText", () => {
  it("secure page (https / localhost): uses navigator.clipboard", async () => {
    const writeText = vi.fn(async () => {});
    const { execCommand } = fakeDom({ secure: true, clipboard: { writeText } });
    expect(await copyText("http://x/f/abc")).toBe(true);
    expect(writeText).toHaveBeenCalledWith("http://x/f/abc");
    expect(execCommand).not.toHaveBeenCalled();
  });

  it("plain http page (the live app today): no clipboard API → textarea + execCommand('copy')", async () => {
    const { execCommand, appended } = fakeDom({ secure: false, clipboard: undefined });
    expect(await copyText("http://34.160.247.209/f/abc")).toBe(true);
    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(appended[0]!.value).toBe("http://34.160.247.209/f/abc");
  });

  it("clipboard permission denied → falls back to execCommand", async () => {
    const { execCommand } = fakeDom({ secure: true, clipboard: { writeText: async () => Promise.reject(new Error("denied")) } });
    expect(await copyText("x")).toBe(true);
    expect(execCommand).toHaveBeenCalledWith("copy");
  });

  it("both blocked → false, so the UI shows the link to copy by hand", async () => {
    fakeDom({ secure: false, execResult: false });
    expect(await copyText("x")).toBe(false);
    fakeDom({ secure: false, execThrows: true });
    expect(await copyText("x")).toBe(false);
  });
});
