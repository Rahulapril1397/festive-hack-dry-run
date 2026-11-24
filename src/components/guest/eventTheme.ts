/** Per-function look and words for the guest screens. Static copy only: no guest data. */
export type EventKind = "haldi" | "mehendi" | "sangeet" | "wedding" | "reception" | "general";

export function eventKind(name: string): EventKind {
  const n = name.toLowerCase();
  if (/haldi|pithi|ubtan/.test(n)) return "haldi";
  if (/mehend|mehndi|henna/.test(n)) return "mehendi";
  if (/sangeet|garba|dandiya|cocktail/.test(n)) return "sangeet";
  if (/reception|dinner|aashirvad/.test(n)) return "reception";
  if (/wedding|shaadi|vivah|phera|pheras|baraat|mandap|muhurat/.test(n)) return "wedding";
  return "general";
}

export const MANTRA: Record<EventKind, string> = {
  haldi: "शुभं करोति कल्याणम्",
  mehendi: "सर्वमङ्गलमाङ्गल्ये",
  sangeet: "सत्यं शिवं सुन्दरम्",
  wedding: "सखा सप्तपदा भव",
  reception: "अतिथि देवो भवः",
  general: "ॐ श्री गणेशाय नमः",
};

/** Keys into src/i18n/en.json, so the line and the meaning follow the guest's language. */
export const LINE_KEY = {
  haldi: "ev.haldi.line",
  mehendi: "ev.mehendi.line",
  sangeet: "ev.sangeet.line",
  wedding: "ev.wedding.line",
  reception: "ev.reception.line",
  general: "ev.general.line",
} as const;
export const MEANING_KEY = {
  haldi: "ev.haldi.meaning",
  mehendi: "ev.mehendi.meaning",
  sangeet: "ev.sangeet.meaning",
  wedding: "ev.wedding.meaning",
  reception: "ev.reception.meaning",
  general: "ev.general.meaning",
} as const;

export const GRADIENT: Record<EventKind, [string, string]> = {
  haldi: ["#f9c22e", "#e8741a"],
  mehendi: ["#3f7d4e", "#14502f"],
  sangeet: ["#7b2d8e", "#d6336c"],
  wedding: ["#a31d2c", "#5d0e1b"],
  reception: ["#0f6b73", "#0a2f4a"],
  general: ["#a31d2c", "#c9961a"],
};
