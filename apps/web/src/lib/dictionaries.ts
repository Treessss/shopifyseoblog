import type { SupportedLocale } from "@shopify-ai-blog/shared";

type UiLocale = Extract<SupportedLocale, "zh-CN" | "en-US">;

export const DEFAULT_UI_LOCALE: UiLocale = "zh-CN";

export const dictionaries = {
  "zh-CN": {
    productName: "Shopify AI Blog",
    workspaceName: "增长内容控制台",
    nav: {
      dashboard: "仪表盘",
      agents: "Agent 中心",
      stores: "店铺",
      aiSettings: "AI 设置",
      languages: "语言",
      campaigns: "内容任务",
      articles: "文章",
      research: "研究台",
      contentRules: "内容准则",
      brandVoice: "品牌语气",
      logs: "日志"
    },
    common: {
      search: "搜索店铺、任务或文章",
      newCampaign: "新建任务",
      sync: "同步",
      beta: "预留",
      cnDefault: "简体中文默认",
      enReserved: "English reserved"
    }
  },
  "en-US": {
    productName: "Shopify AI Blog",
    workspaceName: "Growth Content Console",
    nav: {
      dashboard: "Dashboard",
      agents: "Agent Center",
      stores: "Stores",
      aiSettings: "AI Settings",
      languages: "Languages",
      campaigns: "Campaigns",
      articles: "Articles",
      research: "Research",
      contentRules: "Content Rules",
      brandVoice: "Brand Voice",
      logs: "Logs"
    },
    common: {
      search: "Search stores, campaigns, or articles",
      newCampaign: "New campaign",
      sync: "Sync",
      beta: "Reserved",
      cnDefault: "Simplified Chinese default",
      enReserved: "English reserved"
    }
  }
} as const;

export function getDictionary(locale: UiLocale = DEFAULT_UI_LOCALE) {
  return dictionaries[locale] ?? dictionaries[DEFAULT_UI_LOCALE];
}
