import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  decryptSecret,
  encryptSecret,
  isEncryptedSecret,
  redactSecret
} from "../packages/db/src/encryption";

const testKey = "0123456789abcdef0123456789abcdef";

describe("db encryption", () => {
  it("encrypts secrets with authenticated round trips", () => {
    const encrypted = encryptSecret("shpat_demo_token", testKey);

    expect(encrypted).not.toContain("shpat_demo_token");
    expect(isEncryptedSecret(encrypted)).toBe(true);
    expect(decryptSecret(encrypted, testKey)).toBe("shpat_demo_token");
  });

  it("redacts visible edges only", () => {
    expect(redactSecret("shpat_1234567890", 3)).toBe("shp************890");
  });
});

describe("prisma schema", () => {
  const schema = readFileSync(join(process.cwd(), "packages/db/prisma/schema.prisma"), "utf8");

  it("declares the required domain models", () => {
    const models = [
      "Organization",
      "User",
      "Membership",
      "ShopifyStore",
      "LocaleConfig",
      "AiProviderConfig",
      "BrandVoice",
      "BlogCampaign",
      "BlogArticle",
      "SeoTopicRun",
      "SeoTopicCandidate",
      "ArticleTranslation",
      "GeneratedAsset",
      "PublishJob",
      "PublishLog",
      "AuditLog",
      "ProductSnapshot",
      "CollectionSnapshot"
    ];

    for (const model of models) {
      expect(schema).toContain(`model ${model}`);
    }
  });

  it("keeps status and encrypted secret fields in the schema", () => {
    expect(schema).toMatch(/adminAccessTokenEncrypted\s+String\?/);
    expect(schema).toMatch(/adminAccessTokenExpiresAt\s+DateTime\?/);
    expect(schema).toMatch(/shopifyClientSecretEncrypted\s+String\?/);
    expect(schema).toMatch(/apiKeyEncrypted\s+String\?/);
    expect(schema).toContain("enum ArticleStatus");
    expect(schema).toContain("ready_to_publish");
    expect(schema).toContain("enum JobStatus");
    expect(schema).toContain("retrying");
    expect(schema).toContain("enum SeoAgentRunStatus");
    expect(schema).toMatch(/selectedCandidateId\s+String\?/);
    expect(schema).toContain("selectedCandidate SeoTopicCandidate?");
    expect(schema).toMatch(/opportunityScore\s+Float\?/);
  });

  it("ships a migration for structured SEO topic agent tables", () => {
    expect(
      existsSync(join(process.cwd(), "packages/db/prisma/migrations/20260520152000_add_seo_topic_agent/migration.sql"))
    ).toBe(true);
  });
});
