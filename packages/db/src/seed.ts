import { PrismaClient } from "@prisma/client";
import { encryptSecret } from "./encryption";

const prisma = new PrismaClient();

const DEFAULT_LOCALES = [
  { locale: "zh-CN", label: "简体中文", isDefault: true },
  { locale: "en-US", label: "English", isDefault: false }
] as const;

async function main() {
  const organization = await prisma.organization.upsert({
    where: { slug: "demo" },
    update: {
      name: "Demo Organization",
      status: "active",
      locale: "zh-CN",
      timezone: "Asia/Shanghai"
    },
    create: {
      name: "Demo Organization",
      slug: "demo",
      status: "active",
      locale: "zh-CN",
      timezone: "Asia/Shanghai"
    }
  });

  const user = await prisma.user.upsert({
    where: { email: process.env.DEMO_USER_EMAIL ?? "demo@example.com" },
    update: {
      name: "Demo Admin"
    },
    create: {
      email: process.env.DEMO_USER_EMAIL ?? "demo@example.com",
      name: "Demo Admin"
    }
  });

  await prisma.membership.upsert({
    where: {
      organizationId_userId: {
        organizationId: organization.id,
        userId: user.id
      }
    },
    update: {
      role: "owner",
      status: "active",
      acceptedAt: new Date()
    },
    create: {
      organizationId: organization.id,
      userId: user.id,
      role: "owner",
      status: "active",
      acceptedAt: new Date()
    }
  });

  const shopDomain = process.env.DEMO_SHOP_DOMAIN ?? "demo.myshopify.com";
  const store = await prisma.shopifyStore.upsert({
    where: { myshopifyDomain: shopDomain },
    update: {
      name: "Demo Store",
      status: "active",
      primaryLocale: "zh-CN",
      apiVersion: process.env.SHOPIFY_API_VERSION ?? "2026-04",
      adminAccessTokenEncrypted: encryptOptional(process.env.DEMO_SHOPIFY_ACCESS_TOKEN),
      webhookSecretEncrypted: encryptOptional(process.env.DEMO_SHOPIFY_WEBHOOK_SECRET)
    },
    create: {
      organizationId: organization.id,
      name: "Demo Store",
      myshopifyDomain: shopDomain,
      status: "active",
      primaryLocale: "zh-CN",
      apiVersion: process.env.SHOPIFY_API_VERSION ?? "2026-04",
      installedAt: new Date(),
      adminAccessTokenEncrypted: encryptOptional(process.env.DEMO_SHOPIFY_ACCESS_TOKEN),
      webhookSecretEncrypted: encryptOptional(process.env.DEMO_SHOPIFY_WEBHOOK_SECRET),
      scopes: (process.env.SHOPIFY_SCOPES ?? "read_products,read_content,write_content")
        .split(",")
        .map((scope) => scope.trim())
        .filter(Boolean)
    }
  });

  for (const locale of DEFAULT_LOCALES) {
    await prisma.localeConfig.upsert({
      where: {
        storeId_locale: {
          storeId: store.id,
          locale: locale.locale
        }
      },
      update: {
        label: locale.label,
        isDefault: locale.isDefault,
        isEnabled: true
      },
      create: {
        organizationId: organization.id,
        storeId: store.id,
        locale: locale.locale,
        label: locale.label,
        isDefault: locale.isDefault,
        isEnabled: true
      }
    });
  }

  await prisma.aiProviderConfig.upsert({
    where: {
      organizationId_slug: {
        organizationId: organization.id,
        slug: "default-openai-compatible"
      }
    },
    update: {
      name: "Default OpenAI-compatible Provider",
      provider: "compatible",
      baseUrl: process.env.AI_BASE_URL ?? "https://api.openai.com/v1",
      apiKeyEncrypted: encryptOptional(process.env.AI_API_KEY),
      textModel: process.env.AI_TEXT_MODEL ?? "gpt-4.1",
      imageModel: process.env.AI_IMAGE_MODEL ?? "gpt-image-1",
      temperature: 0.8,
      enabled: true,
      isDefault: true
    },
    create: {
      organizationId: organization.id,
      slug: "default-openai-compatible",
      name: "Default OpenAI-compatible Provider",
      provider: "compatible",
      baseUrl: process.env.AI_BASE_URL ?? "https://api.openai.com/v1",
      apiKeyEncrypted: encryptOptional(process.env.AI_API_KEY),
      textModel: process.env.AI_TEXT_MODEL ?? "gpt-4.1",
      imageModel: process.env.AI_IMAGE_MODEL ?? "gpt-image-1",
      temperature: 0.8,
      enabled: true,
      isDefault: true
    }
  });

  await prisma.brandVoice.upsert({
    where: {
      organizationId_storeId_locale_name: {
        organizationId: organization.id,
        storeId: store.id,
        locale: "zh-CN",
        name: "Demo Brand Voice"
      }
    },
    update: {
      audience: "Shopify store shoppers",
      tone: "清晰、可信、带有轻度顾问感",
      isDefault: true
    },
    create: {
      organizationId: organization.id,
      storeId: store.id,
      locale: "zh-CN",
      name: "Demo Brand Voice",
      audience: "Shopify store shoppers",
      tone: "清晰、可信、带有轻度顾问感",
      examples: ["用具体场景解释产品价值，避免空泛营销词。"],
      isDefault: true
    }
  });

  const seedLog = await prisma.auditLog.findFirst({
    where: {
      organizationId: organization.id,
      action: "create",
      entityType: "seed",
      entityId: organization.id
    }
  });

  if (!seedLog) {
    await prisma.auditLog.create({
      data: {
        organizationId: organization.id,
        userId: user.id,
        storeId: store.id,
        action: "create",
        entityType: "seed",
        entityId: organization.id,
        metadata: {
          locales: DEFAULT_LOCALES.map((locale) => locale.locale)
        }
      }
    });
  }

  console.log(`Seeded demo organization ${organization.slug} with store ${store.myshopifyDomain}.`);
}

function encryptOptional(value: string | undefined): string | null {
  if (!value) return null;
  return encryptSecret(value);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
