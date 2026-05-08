export const DEFAULT_LOCALE = "zh-CN" as const;

export const SUPPORTED_LOCALES = [
  "zh-CN",
  "en-US",
  "ja-JP",
  "de-DE",
  "fr-FR",
  "es-ES"
] as const;

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export const LOCALE_LABELS: Record<SupportedLocale, string> = {
  "zh-CN": "简体中文",
  "en-US": "English",
  "ja-JP": "日本語",
  "de-DE": "Deutsch",
  "fr-FR": "Français",
  "es-ES": "Español"
};

export function isSupportedLocale(locale: string): locale is SupportedLocale {
  return SUPPORTED_LOCALES.includes(locale as SupportedLocale);
}

export function normalizeLocale(locale?: string | null): SupportedLocale {
  if (!locale) return DEFAULT_LOCALE;
  const exact = SUPPORTED_LOCALES.find((item) => item === locale);
  if (exact) return exact;

  const language = locale.split("-")[0];
  const related = SUPPORTED_LOCALES.find((item) => item.startsWith(`${language}-`));
  return related ?? DEFAULT_LOCALE;
}
