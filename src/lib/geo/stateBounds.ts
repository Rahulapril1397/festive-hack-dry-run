/**
 * Coarse bounding boxes of Indian states/UTs → main language (Stage 3 E2 T4). Used only to
 * *suggest* a language after the guest taps "Use my location"; coordinates are rounded to one
 * decimal (~10 km) before they leave the browser and are never stored or logged.
 * Boxes overlap at borders; the smallest containing box wins.
 */
import { LANGUAGES, type LanguageCode } from "@/lib/sarvam/languages";

type Box = { state: string; lang: LanguageCode; s: number; n: number; w: number; e: number };

export const STATE_BOXES: readonly Box[] = [
  { state: "Delhi", lang: "hi", s: 28.4, n: 28.9, w: 76.8, e: 77.4 },
  { state: "Chandigarh", lang: "pa", s: 30.65, n: 30.8, w: 76.68, e: 76.85 },
  { state: "Goa", lang: "mr", s: 14.9, n: 15.8, w: 73.7, e: 74.3 },
  { state: "Punjab", lang: "pa", s: 29.5, n: 32.5, w: 73.9, e: 76.9 },
  { state: "Haryana", lang: "hi", s: 27.6, n: 30.9, w: 74.5, e: 77.6 },
  { state: "Himachal Pradesh", lang: "hi", s: 30.4, n: 33.2, w: 75.6, e: 79.0 },
  { state: "Uttarakhand", lang: "hi", s: 28.7, n: 31.5, w: 77.6, e: 81.0 },
  { state: "Uttar Pradesh", lang: "hi", s: 23.9, n: 30.4, w: 77.1, e: 84.6 },
  { state: "Bihar", lang: "hi", s: 24.3, n: 27.5, w: 83.3, e: 88.3 },
  { state: "Jharkhand", lang: "hi", s: 21.9, n: 25.3, w: 83.3, e: 87.9 },
  { state: "Rajasthan", lang: "hi", s: 23.0, n: 30.2, w: 69.5, e: 78.3 },
  { state: "Madhya Pradesh", lang: "hi", s: 21.1, n: 26.9, w: 74.0, e: 82.8 },
  { state: "Chhattisgarh", lang: "hi", s: 17.8, n: 24.1, w: 80.2, e: 84.4 },
  { state: "Gujarat", lang: "gu", s: 20.1, n: 24.7, w: 68.1, e: 74.5 },
  { state: "Maharashtra", lang: "mr", s: 15.6, n: 22.1, w: 72.6, e: 80.9 },
  { state: "West Bengal", lang: "bn", s: 21.5, n: 27.2, w: 85.8, e: 89.9 },
  { state: "Odisha", lang: "hi", s: 17.8, n: 22.6, w: 81.3, e: 87.5 },
  { state: "Telangana", lang: "te", s: 15.8, n: 19.9, w: 77.2, e: 81.3 },
  { state: "Andhra Pradesh", lang: "te", s: 12.6, n: 19.2, w: 76.7, e: 84.8 },
  { state: "Karnataka", lang: "kn", s: 11.5, n: 18.5, w: 74.0, e: 78.6 },
  { state: "Kerala", lang: "ml", s: 8.2, n: 12.8, w: 74.8, e: 77.4 },
  { state: "Tamil Nadu", lang: "ta", s: 8.0, n: 13.6, w: 76.2, e: 80.4 },
];

const area = (b: Box) => (b.n - b.s) * (b.e - b.w);

export function stateAt(lat: number, lon: number): Box | null {
  const hits = STATE_BOXES.filter((b) => lat >= b.s && lat <= b.n && lon >= b.w && lon <= b.e);
  return hits.sort((a, b) => area(a) - area(b))[0] ?? null;
}

/** Suggested app language for a location, only if that language is enabled in the app. */
export function languageAt(lat: number, lon: number): { state: string | null; language: LanguageCode | null; enabled: boolean } {
  const b = stateAt(lat, lon);
  if (!b) return { state: null, language: null, enabled: false };
  return { state: b.state, language: b.lang, enabled: LANGUAGES[b.lang].enabled };
}
