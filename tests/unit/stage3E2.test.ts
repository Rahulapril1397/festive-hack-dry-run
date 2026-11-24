import { describe, expect, it } from "vitest";
import { giftSentence, protect, render, restore, variantFor } from "@/domain/thanks/template";
import { fromAcceptLanguage } from "@/lib/geo/acceptLanguage";
import { languageAt, stateAt } from "@/lib/geo/stateBounds";
import { encodeWav } from "@/components/pinkybua/recorder";

describe("thank-you templates", () => {
  it("variant is stable per family and splits roughly 50/50", () => {
    expect(variantFor("f-1")).toBe(variantFor("f-1"));
    const ids = Array.from({ length: 400 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    const a = ids.filter((id) => variantFor(id) === "A").length;
    expect(a).toBeGreaterThan(160);
    expect(a).toBeLessThan(240);
  });
  it("renders placeholders; empty gift collapses cleanly", () => {
    const t = "Dear {family}, thank you. {gift}With love, {couple}";
    expect(render(t, { family: "Sharma family", couple: "Asha & Rohan", gift: giftSentence("Dinner set") })).toBe("Dear Sharma family, thank you. Thank you also for the Dinner set. With love, Asha & Rohan");
    expect(render(t, { family: "Sharma family", couple: "Asha & Rohan", gift: "" })).toBe("Dear Sharma family, thank you. With love, Asha & Rohan");
  });
  it("names never go to translation: placeholders become numbered tokens and come back", () => {
    const { text, order } = protect("Dear {family}, {gift}love, {couple}");
    expect(text).toBe("Dear {0}, {1}love, {2}");
    expect(text).not.toMatch(/family|couple/);
    expect(restore("प्रिय {0}, {1}प्यार, {2}", order)).toBe("प्रिय {family}, {gift}प्यार, {couple}");
  });
  it("a lost or duplicated token means 'not translated'", () => {
    const { order } = protect("Dear {family}, love {couple}");
    expect(restore("प्रिय, प्यार {1}", order)).toBeNull();
    expect(restore("{0} {0} {1}", order)).toBeNull();
  });
});

describe("language suggestion", () => {
  it("Accept-Language → best enabled language", () => {
    expect(fromAcceptLanguage("hi-IN,hi;q=0.9,en-US;q=0.8")).toBe("hi");
    expect(fromAcceptLanguage("en-GB,en;q=0.9")).toBe("en");
    expect(fromAcceptLanguage("ta-IN,ta;q=0.9,hi;q=0.5")).toBe("ta");
    expect(fromAcceptLanguage("ta-IN,ta;q=0.9,hi;q=0.5", ["en", "hi"])).toBe("hi"); // group A cannot pick Tamil
    expect(fromAcceptLanguage("fr-FR")).toBeNull();
    expect(fromAcceptLanguage(null)).toBeNull();
  });
  it("coarse location → state → language (enabled only)", () => {
    expect(stateAt(28.6, 77.2)?.state).toBe("Delhi"); // smallest box wins over Haryana/UP
    expect(languageAt(26.8, 80.9)).toEqual({ state: "Uttar Pradesh", language: "hi", enabled: true }); // Lucknow
    expect(languageAt(13.1, 80.3)).toEqual({ state: "Tamil Nadu", language: "ta", enabled: true }); // Chennai
    expect(languageAt(51.5, -0.1)).toEqual({ state: null, language: null, enabled: false });
  });
});

describe("voice", () => {
  it("encodes 16-bit mono WAV the STT accepts", async () => {
    const wav = encodeWav(new Float32Array([0, 0.5, -0.5, 1, -1]), 16000);
    const b = new DataView(await wav.arrayBuffer());
    const tag = (o: number) => String.fromCharCode(b.getUint8(o), b.getUint8(o + 1), b.getUint8(o + 2), b.getUint8(o + 3));
    expect(tag(0)).toBe("RIFF");
    expect(tag(8)).toBe("WAVE");
    expect(b.getUint16(22, true)).toBe(1); // mono
    expect(b.getUint32(24, true)).toBe(16000);
    expect(b.getUint16(34, true)).toBe(16);
    expect(b.byteLength).toBe(44 + 5 * 2);
    expect(b.getInt16(44 + 3 * 2, true)).toBe(0x7fff);
    expect(b.getInt16(44 + 4 * 2, true)).toBe(-0x8000);
  });
});
