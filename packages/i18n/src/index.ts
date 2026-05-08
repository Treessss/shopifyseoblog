import { DEFAULT_LOCALE, type SupportedLocale, normalizeLocale } from "@shopify-ai-blog/shared";

export interface LocaleConfig {
  locale: SupportedLocale;
  label: string;
  enabled: boolean;
  fallbackLocale: SupportedLocale;
  isDefault: boolean;
}

export const defaultLocaleConfigs: LocaleConfig[] = [
  { locale: "zh-CN", label: "简体中文", enabled: true, fallbackLocale: "zh-CN", isDefault: true },
  { locale: "en-US", label: "English", enabled: true, fallbackLocale: "zh-CN", isDefault: false },
  { locale: "ja-JP", label: "日本語", enabled: false, fallbackLocale: "zh-CN", isDefault: false },
  { locale: "de-DE", label: "Deutsch", enabled: false, fallbackLocale: "en-US", isDefault: false },
  { locale: "fr-FR", label: "Français", enabled: false, fallbackLocale: "en-US", isDefault: false },
  { locale: "es-ES", label: "Español", enabled: false, fallbackLocale: "en-US", isDefault: false }
];

export const messages = {
  "zh-CN": {
    appName: "Shopify AI Blog",
    dashboard: "仪表盘",
    stores: "店铺",
    campaigns: "内容任务",
    articles: "文章",
    languages: "语言",
    brandVoice: "品牌语气",
    aiSettings: "AI 设置",
    logs: "日志",
    autoPublish: "达标自动发布",
    defaultLanguage: "默认语言",
    qualityGate: "质量门槛",
    seoScore: "SEO 分数"
  },
  "en-US": {
    appName: "Shopify AI Blog",
    dashboard: "Dashboard",
    stores: "Stores",
    campaigns: "Campaigns",
    articles: "Articles",
    languages: "Languages",
    brandVoice: "Brand Voice",
    aiSettings: "AI Settings",
    logs: "Logs",
    autoPublish: "Auto publish when qualified",
    defaultLanguage: "Default language",
    qualityGate: "Quality gate",
    seoScore: "SEO score"
  }
} as const;

export type MessageKey = keyof (typeof messages)["zh-CN"];

export function resolveLocale(input?: string | null, enabled = defaultLocaleConfigs): SupportedLocale {
  const normalized = normalizeLocale(input);
  const config = enabled.find((item) => item.locale === normalized && item.enabled);
  if (config) return config.locale;

  const defaultConfig = enabled.find((item) => item.isDefault && item.enabled);
  return defaultConfig?.locale ?? DEFAULT_LOCALE;
}

export function t(key: MessageKey, locale?: string | null): string {
  const resolved = resolveLocale(locale);
  if (resolved in messages) {
    return messages[resolved as keyof typeof messages][key] ?? messages["zh-CN"][key];
  }
  return messages["zh-CN"][key];
}

export function getContentPromptLocale(locale?: string | null): string {
  const resolved = normalizeLocale(locale);
  const labels: Record<SupportedLocale, string> = {
    "zh-CN": "Simplified Chinese",
    "en-US": "English",
    "ja-JP": "Japanese",
    "de-DE": "German",
    "fr-FR": "French",
    "es-ES": "Spanish"
  };

  return labels[resolved];
}
