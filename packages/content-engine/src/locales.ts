export const DEFAULT_LOCALE = "zh-CN" as const;

export const SUPPORTED_LOCALES = ["zh-CN", "en-US", "ja-JP", "de-DE", "fr-FR", "es-ES"] as const;

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export function normalizeLocale(locale?: string | null): SupportedLocale {
  if (!locale) return DEFAULT_LOCALE;
  const exact = SUPPORTED_LOCALES.find((item) => item === locale);
  if (exact) return exact;

  const language = locale.split("-")[0];
  return SUPPORTED_LOCALES.find((item) => item.startsWith(`${language}-`)) ?? DEFAULT_LOCALE;
}
