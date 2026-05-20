-- CreateEnum
CREATE TYPE "SeoAgentRunStatus" AS ENUM ('passed', 'warning', 'failed', 'skipped');

-- CreateEnum
CREATE TYPE "SeoFunnelStage" AS ENUM ('TOFU', 'MOFU', 'BOFU');

-- CreateEnum
CREATE TYPE "SeoSearchIntent" AS ENUM ('informational', 'commercial', 'transactional', 'navigational');

-- CreateTable
CREATE TABLE "SeoTopicRun" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "campaignId" TEXT,
    "articleId" TEXT,
    "locale" TEXT NOT NULL,
    "sourceType" "SourceType" NOT NULL,
    "sourceId" TEXT,
    "status" "SeoAgentRunStatus" NOT NULL DEFAULT 'passed',
    "strategy" TEXT,
    "selectedCandidateId" TEXT,
    "selectedTopic" TEXT,
    "objective" TEXT,
    "agentVersion" TEXT NOT NULL,
    "configSnapshot" JSONB,
    "research" JSONB,
    "contentBrief" JSONB,
    "reflection" JSONB,
    "memory" JSONB,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SeoTopicRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SeoTopicCandidate" (
    "id" TEXT NOT NULL,
    "topicRunId" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "primaryKeyword" TEXT,
    "score" DOUBLE PRECISION NOT NULL,
    "funnelStage" "SeoFunnelStage",
    "searchIntent" "SeoSearchIntent",
    "angleKey" TEXT,
    "impactScore" DOUBLE PRECISION,
    "confidenceScore" DOUBLE PRECISION,
    "noveltyScore" DOUBLE PRECISION,
    "commerceScore" DOUBLE PRECISION,
    "opportunityScore" DOUBLE PRECISION,
    "selected" BOOLEAN NOT NULL DEFAULT false,
    "rejectedReason" TEXT,
    "evidence" JSONB,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SeoTopicCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SeoTopicRun_runId_key" ON "SeoTopicRun"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "SeoTopicRun_selectedCandidateId_key" ON "SeoTopicRun"("selectedCandidateId");

-- CreateIndex
CREATE INDEX "SeoTopicRun_organizationId_status_createdAt_idx" ON "SeoTopicRun"("organizationId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "SeoTopicRun_storeId_locale_createdAt_idx" ON "SeoTopicRun"("storeId", "locale", "createdAt");

-- CreateIndex
CREATE INDEX "SeoTopicRun_campaignId_idx" ON "SeoTopicRun"("campaignId");

-- CreateIndex
CREATE INDEX "SeoTopicRun_articleId_idx" ON "SeoTopicRun"("articleId");

-- CreateIndex
CREATE INDEX "SeoTopicRun_sourceType_sourceId_idx" ON "SeoTopicRun"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "SeoTopicCandidate_topicRunId_selected_idx" ON "SeoTopicCandidate"("topicRunId", "selected");

-- CreateIndex
CREATE INDEX "SeoTopicCandidate_primaryKeyword_idx" ON "SeoTopicCandidate"("primaryKeyword");

-- CreateIndex
CREATE INDEX "SeoTopicCandidate_angleKey_idx" ON "SeoTopicCandidate"("angleKey");

-- CreateIndex
CREATE INDEX "SeoTopicCandidate_searchIntent_idx" ON "SeoTopicCandidate"("searchIntent");

-- AddForeignKey
ALTER TABLE "SeoTopicRun" ADD CONSTRAINT "SeoTopicRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeoTopicRun" ADD CONSTRAINT "SeoTopicRun_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "ShopifyStore"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeoTopicRun" ADD CONSTRAINT "SeoTopicRun_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "BlogCampaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeoTopicRun" ADD CONSTRAINT "SeoTopicRun_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "BlogArticle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeoTopicRun" ADD CONSTRAINT "SeoTopicRun_selectedCandidateId_fkey" FOREIGN KEY ("selectedCandidateId") REFERENCES "SeoTopicCandidate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeoTopicCandidate" ADD CONSTRAINT "SeoTopicCandidate_topicRunId_fkey" FOREIGN KEY ("topicRunId") REFERENCES "SeoTopicRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
