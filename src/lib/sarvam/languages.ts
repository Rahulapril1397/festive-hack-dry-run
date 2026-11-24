/** App languages. Verified end to end with Sarvam (translate, speech out, speech in) for all ten. */
export const LANGUAGES = {
  en: { sarvam: "en-IN", label: "English", native: "English", enabled: true },
  hi: { sarvam: "hi-IN", label: "Hindi", native: "हिन्दी", enabled: true },
  bn: { sarvam: "bn-IN", label: "Bengali", native: "বাংলা", enabled: true },
  ta: { sarvam: "ta-IN", label: "Tamil", native: "தமிழ்", enabled: true },
  te: { sarvam: "te-IN", label: "Telugu", native: "తెలుగు", enabled: true },
  mr: { sarvam: "mr-IN", label: "Marathi", native: "मराठी", enabled: true },
  gu: { sarvam: "gu-IN", label: "Gujarati", native: "ગુજરાતી", enabled: true },
  kn: { sarvam: "kn-IN", label: "Kannada", native: "ಕನ್ನಡ", enabled: true },
  ml: { sarvam: "ml-IN", label: "Malayalam", native: "മലയാളം", enabled: true },
  pa: { sarvam: "pa-IN", label: "Punjabi", native: "ਪੰਜਾਬੀ", enabled: true },
} as const;

export type LanguageCode = keyof typeof LANGUAGES;
export const ENABLED_LANGUAGES = ["en", "hi", "bn", "ta", "te", "mr", "gu", "kn", "ml", "pa"] as const;
export type AppLanguage = (typeof ENABLED_LANGUAGES)[number];

export const isAppLanguage = (s: unknown): s is AppLanguage => (ENABLED_LANGUAGES as readonly unknown[]).includes(s);

/**
 * Guest language A/B test: group A picks from English and Hindi; group B also gets the other
 * Indian languages Sarvam provides. The group is assigned once per family (see domain/rsvp/group).
 */
export type LanguageGroup = "A" | "B";
export const GROUP_LANGUAGES: Record<LanguageGroup, readonly AppLanguage[]> = { A: ["en", "hi"], B: ENABLED_LANGUAGES };
export const languagesFor = (group: LanguageGroup | null | undefined): readonly AppLanguage[] => GROUP_LANGUAGES[group ?? "A"];

/** The venue TV announcements (and their cached audio) exist in English and Hindi only. */
export const TV_LANGUAGES = ["en", "hi"] as const;
export const isTvLanguage = (s: unknown): s is (typeof TV_LANGUAGES)[number] => (TV_LANGUAGES as readonly unknown[]).includes(s);
