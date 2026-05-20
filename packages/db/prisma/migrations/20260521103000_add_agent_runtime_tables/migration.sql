-- CreateEnum
CREATE TYPE "AgentRole" AS ENUM ('researcher', 'keyword_planner', 'topic_strategist', 'writer', 'seo_editor', 'publisher_guard');

-- CreateEnum
CREATE TYPE "AgentToolCallStatus" AS ENUM ('passed', 'warning', 'failed', 'skipped');

-- CreateEnum
CREATE TYPE "AgentMemoryOutcome" AS ENUM ('success', 'warning', 'failed', 'published', 'rejected');

-- CreateTable
CREATE TABLE "AgentMemory" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "campaignId" TEXT,
    "articleId" TEXT,
    "locale" TEXT NOT NULL,
    "sourceType" "SourceType",
    "sourceId" TEXT,
    "keyword" TEXT,
    "angleKey" TEXT,
    "topicFingerprint" TEXT,
    "outcome" "AgentMemoryOutcome" NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "qualityScore" DOUBLE PRECISION,
    "trafficScore" DOUBLE PRECISION,
    "learnedRule" TEXT,
    "avoidUntil" TIMESTAMP(3),
    "evidence" JSONB,
    "metadata" JSONB,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentMemory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentToolCall" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "topicRunId" TEXT,
    "campaignId" TEXT,
    "articleId" TEXT,
    "runId" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "agentRole" "AgentRole" NOT NULL,
    "toolName" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "status" "AgentToolCallStatus" NOT NULL DEFAULT 'passed',
    "input" JSONB,
    "output" JSONB,
    "evidence" JSONB,
    "warnings" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "latencyMs" INTEGER,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentToolCall_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentReflectionTask" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "topicRunId" TEXT,
    "campaignId" TEXT,
    "articleId" TEXT,
    "priority" TEXT NOT NULL,
    "agentRole" "AgentRole" NOT NULL,
    "instruction" TEXT NOT NULL,
    "acceptanceCheck" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "evidenceIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "AgentReflectionTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentEvidence" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "topicRunId" TEXT,
    "campaignId" TEXT,
    "articleId" TEXT,
    "locale" TEXT NOT NULL,
    "evidenceType" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "normalizedKeyword" TEXT,
    "value" TEXT NOT NULL,
    "url" TEXT,
    "query" TEXT,
    "publishedAt" TIMESTAMP(3),
    "metric" TEXT,
    "relevanceScore" DOUBLE PRECISION,
    "confidence" DOUBLE PRECISION NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "dedupeHash" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentMemory_storeId_locale_lastUsedAt_idx" ON "AgentMemory"("storeId", "locale", "lastUsedAt");

-- CreateIndex
CREATE INDEX "AgentMemory_storeId_keyword_idx" ON "AgentMemory"("storeId", "keyword");

-- CreateIndex
CREATE INDEX "AgentMemory_storeId_angleKey_idx" ON "AgentMemory"("storeId", "angleKey");

-- CreateIndex
CREATE INDEX "AgentMemory_outcome_confidence_idx" ON "AgentMemory"("outcome", "confidence");

-- CreateIndex
CREATE INDEX "AgentToolCall_runId_idx" ON "AgentToolCall"("runId");

-- CreateIndex
CREATE INDEX "AgentToolCall_topicRunId_stage_idx" ON "AgentToolCall"("topicRunId", "stage");

-- CreateIndex
CREATE INDEX "AgentToolCall_storeId_toolName_createdAt_idx" ON "AgentToolCall"("storeId", "toolName", "createdAt");

-- CreateIndex
CREATE INDEX "AgentReflectionTask_topicRunId_status_idx" ON "AgentReflectionTask"("topicRunId", "status");

-- CreateIndex
CREATE INDEX "AgentReflectionTask_articleId_priority_idx" ON "AgentReflectionTask"("articleId", "priority");

-- CreateIndex
CREATE INDEX "AgentReflectionTask_storeId_status_createdAt_idx" ON "AgentReflectionTask"("storeId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AgentEvidence_storeId_dedupeHash_key" ON "AgentEvidence"("storeId", "dedupeHash");

-- CreateIndex
CREATE INDEX "AgentEvidence_topicRunId_idx" ON "AgentEvidence"("topicRunId");

-- CreateIndex
CREATE INDEX "AgentEvidence_storeId_locale_evidenceType_idx" ON "AgentEvidence"("storeId", "locale", "evidenceType");

-- CreateIndex
CREATE INDEX "AgentEvidence_normalizedKeyword_idx" ON "AgentEvidence"("normalizedKeyword");

-- CreateIndex
CREATE INDEX "AgentEvidence_expiresAt_idx" ON "AgentEvidence"("expiresAt");

-- AddForeignKey
ALTER TABLE "AgentMemory" ADD CONSTRAINT "AgentMemory_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentMemory" ADD CONSTRAINT "AgentMemory_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "ShopifyStore"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentMemory" ADD CONSTRAINT "AgentMemory_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "BlogCampaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentMemory" ADD CONSTRAINT "AgentMemory_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "BlogArticle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentToolCall" ADD CONSTRAINT "AgentToolCall_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentToolCall" ADD CONSTRAINT "AgentToolCall_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "ShopifyStore"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentToolCall" ADD CONSTRAINT "AgentToolCall_topicRunId_fkey" FOREIGN KEY ("topicRunId") REFERENCES "SeoTopicRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentToolCall" ADD CONSTRAINT "AgentToolCall_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "BlogCampaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentToolCall" ADD CONSTRAINT "AgentToolCall_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "BlogArticle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentReflectionTask" ADD CONSTRAINT "AgentReflectionTask_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentReflectionTask" ADD CONSTRAINT "AgentReflectionTask_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "ShopifyStore"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentReflectionTask" ADD CONSTRAINT "AgentReflectionTask_topicRunId_fkey" FOREIGN KEY ("topicRunId") REFERENCES "SeoTopicRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentReflectionTask" ADD CONSTRAINT "AgentReflectionTask_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "BlogCampaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentReflectionTask" ADD CONSTRAINT "AgentReflectionTask_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "BlogArticle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentEvidence" ADD CONSTRAINT "AgentEvidence_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentEvidence" ADD CONSTRAINT "AgentEvidence_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "ShopifyStore"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentEvidence" ADD CONSTRAINT "AgentEvidence_topicRunId_fkey" FOREIGN KEY ("topicRunId") REFERENCES "SeoTopicRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentEvidence" ADD CONSTRAINT "AgentEvidence_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "BlogCampaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentEvidence" ADD CONSTRAINT "AgentEvidence_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "BlogArticle"("id") ON DELETE SET NULL ON UPDATE CASCADE;
