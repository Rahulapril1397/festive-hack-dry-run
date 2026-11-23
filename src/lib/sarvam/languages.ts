/** App languages. en + hi are live; the rest are config-only until Stage 3 (and need the DB enum). */
export const LANGUAGES = {
  en: { sarvam: "en-IN", label: "English", native: "English", enabled: true },
  hi: { sarvam: "hi-IN", label: "Hindi", native: "हिन्दी", enabled: true },
  bn: { sarvam: "bn-IN", label: "Bengali", native: "বাংলা", enabled: false },
  ta: { sarvam: "ta-IN", label: "Tamil", native: "தமிழ்", enabled: false },
  te: { sarvam: "te-IN", label: "Telugu", native: "తెలుగు", enabled: false },
  mr: { sarvam: "mr-IN", label: "Marathi", native: "मराठी", enabled: false },
  gu: { sarvam: "gu-IN", label: "Gujarati", native: "ગુજરાતી", enabled: false },
  kn: { sarvam: "kn-IN", label: "Kannada", native: "ಕನ್ನಡ", enabled: false },
  ml: { sarvam: "ml-IN", label: "Malayalam", native: "മലയാളം", enabled: false },
  pa: { sarvam: "pa-IN", label: "Punjabi", native: "ਪੰਜਾਬੀ", enabled: false },
} as const;

export type LanguageCode = keyof typeof LANGUAGES;
export const ENABLED_LANGUAGES = ["en", "hi"] as const;
export type AppLanguage = (typeof ENABLED_LANGUAGES)[number];

export const isAppLanguage = (s: unknown): s is AppLanguage => (ENABLED_LANGUAGES as readonly unknown[]).includes(s);
