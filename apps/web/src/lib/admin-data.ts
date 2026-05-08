import type { ArticleStatus, CampaignStatus, JobStatus, SupportedLocale } from "@shopify-ai-blog/shared";

export interface StoreOverview {
  name: string;
  domain: string;
  locale: SupportedLocale;
  status: "已连接" | "需授权" | "同步中";
  products: number;
  articles: number;
  lastSync: string;
}

export interface CampaignOverview {
  name: string;
  store: string;
  locale: SupportedLocale;
  source: string;
  status: CampaignStatus;
  progress: number;
  publishPolicy: string;
}

export interface ArticleOverview {
  title: string;
  store: string;
  locale: SupportedLocale;
  status: ArticleStatus;
  seoScore: number;
  updatedAt: string;
}

export interface LogEntry {
  time: string;
  level: "info" | "warning" | "error";
  module: string;
  message: string;
  status: JobStatus;
}

export const metrics = [
  { label: "已连接店铺", value: "12", detail: "3 个本周新增", tone: "good" },
  { label: "本月生成文章", value: "248", detail: "通过质量门槛 91%", tone: "good" },
  { label: "待人工复核", value: "17", detail: "平均 SEO 分 78", tone: "warn" },
  { label: "发布失败", value: "3", detail: "需要重新授权或重试", tone: "danger" }
] as const;

export const stores: StoreOverview[] = [
  {
    name: "Aurora Living",
    domain: "aurora-living.myshopify.com",
    locale: "zh-CN",
    status: "已连接",
    products: 1684,
    articles: 94,
    lastSync: "10 分钟前"
  },
  {
    name: "Northstar Gear",
    domain: "northstar-gear.myshopify.com",
    locale: "en-US",
    status: "同步中",
    products: 832,
    articles: 41,
    lastSync: "正在同步"
  },
  {
    name: "Mori Beauty",
    domain: "mori-beauty.myshopify.com",
    locale: "ja-JP",
    status: "需授权",
    products: 405,
    articles: 12,
    lastSync: "2 天前"
  }
];

export const campaigns: CampaignOverview[] = [
  {
    name: "春夏新品关键词集群",
    store: "Aurora Living",
    locale: "zh-CN",
    source: "Collection: summer-essentials",
    status: "active",
    progress: 72,
    publishPolicy: "达标自动发布"
  },
  {
    name: "Gift Guide Evergreen",
    store: "Northstar Gear",
    locale: "en-US",
    source: "Manual topics",
    status: "paused",
    progress: 38,
    publishPolicy: "人工复核"
  },
  {
    name: "护肤成分教育",
    store: "Mori Beauty",
    locale: "ja-JP",
    source: "Product type: Serum",
    status: "draft",
    progress: 12,
    publishPolicy: "人工复核"
  }
];

export const articles: ArticleOverview[] = [
  {
    title: "如何为小户型选择可持续收纳家具",
    store: "Aurora Living",
    locale: "zh-CN",
    status: "ready_to_publish",
    seoScore: 88,
    updatedAt: "今天 15:40"
  },
  {
    title: "The Field-Tested Guide to Waterproof Backpacks",
    store: "Northstar Gear",
    locale: "en-US",
    status: "draft",
    seoScore: 74,
    updatedAt: "今天 14:05"
  },
  {
    title: "敏感肌向け美容液の選び方",
    store: "Mori Beauty",
    locale: "ja-JP",
    status: "quality_failed",
    seoScore: 61,
    updatedAt: "昨天 18:20"
  }
];

export const logs: LogEntry[] = [
  {
    time: "16:08:12",
    level: "info",
    module: "content-engine",
    message: "文章生成任务完成，等待质量评分",
    status: "succeeded"
  },
  {
    time: "16:02:44",
    level: "warning",
    module: "shopify",
    message: "Northstar Gear 商品同步耗时高于阈值",
    status: "retrying"
  },
  {
    time: "15:57:30",
    level: "error",
    module: "publisher",
    message: "Mori Beauty 授权过期，发布被拒绝",
    status: "failed"
  }
];

export const languages = [
  { locale: "zh-CN", label: "简体中文", enabled: true, fallback: "zh-CN", role: "默认 UI 与内容语言" },
  { locale: "en-US", label: "English", enabled: true, fallback: "zh-CN", role: "英文 UI 预留与内容生成" },
  { locale: "ja-JP", label: "日本語", enabled: false, fallback: "en-US", role: "内容语言预留" },
  { locale: "de-DE", label: "Deutsch", enabled: false, fallback: "en-US", role: "内容语言预留" }
] as const;

export const brandVoiceProfiles = [
  {
    locale: "zh-CN",
    audience: "25-40 岁城市家庭用户",
    tone: "专业、克制、有生活感",
    bannedWords: ["最顶级", "永久有效", "零风险"],
    examples: ["用具体场景解释产品价值", "避免夸张承诺，强调材质、尺寸与保养"]
  },
  {
    locale: "en-US",
    audience: "Outdoor enthusiasts comparing durable gear",
    tone: "Clear, practical, field-tested",
    bannedWords: ["guaranteed", "best ever", "miracle"],
    examples: ["Lead with use cases", "Mention specs only when they help decisions"]
  }
] as const;
