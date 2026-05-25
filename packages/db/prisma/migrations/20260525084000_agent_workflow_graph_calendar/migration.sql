-- Agent role expansion for multi-agent orchestration
ALTER TYPE "AgentRole" ADD VALUE IF NOT EXISTS 'shopping_guide_editor';
ALTER TYPE "AgentRole" ADD VALUE IF NOT EXISTS 'fact_checker';
ALTER TYPE "AgentRole" ADD VALUE IF NOT EXISTS 'image_director';
ALTER TYPE "AgentRole" ADD VALUE IF NOT EXISTS 'growth_analyst';

-- Durable AgentStep execution metadata
ALTER TABLE "AgentStep" ADD COLUMN "attempt" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "AgentStep" ADD COLUMN "maxAttempts" INTEGER NOT NULL DEFAULT 3;
ALTER TABLE "AgentStep" ADD COLUMN "dependsOnStepKey" TEXT;
ALTER TABLE "AgentStep" ADD COLUMN "idempotencyKey" TEXT;
ALTER TABLE "AgentStep" ADD COLUMN "leaseOwner" TEXT;
ALTER TABLE "AgentStep" ADD COLUMN "lockedAt" TIMESTAMP(3);
ALTER TABLE "AgentStep" ADD COLUMN "lastHeartbeatAt" TIMESTAMP(3);
ALTER TABLE "AgentStep" ADD COLUMN "nextRetryAt" TIMESTAMP(3);
ALTER TABLE "AgentStep" ADD COLUMN "resumedFromStepId" TEXT;
ALTER TABLE "AgentStep" ADD COLUMN "canResume" BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX "AgentStep_runId_status_nextRetryAt_idx" ON "AgentStep"("runId", "status", "nextRetryAt");
CREATE INDEX "AgentStep_storeId_stepKey_createdAt_idx" ON "AgentStep"("storeId", "stepKey", "createdAt");

-- Internal link graph and autonomous content calendar primitives
CREATE TYPE "InternalLinkPageType" AS ENUM ('home', 'product', 'collection', 'blog_article', 'blog_index', 'page', 'unknown');
CREATE TYPE "ContentGoalStatus" AS ENUM ('draft', 'active', 'paused', 'completed', 'archived');
CREATE TYPE "ContentCalendarItemStatus" AS ENUM ('planned', 'queued', 'in_progress', 'published', 'skipped', 'blocked');

CREATE TABLE "InternalLinkNode" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "articleId" TEXT,
    "pageType" "InternalLinkPageType" NOT NULL DEFAULT 'unknown',
    "sourceType" "SourceType",
    "sourceId" TEXT,
    "locale" TEXT,
    "url" TEXT NOT NULL,
    "canonicalUrl" TEXT,
    "title" TEXT,
    "handle" TEXT,
    "authorityScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "inboundLinkCount" INTEGER NOT NULL DEFAULT 0,
    "outboundLinkCount" INTEGER NOT NULL DEFAULT 0,
    "anchorDistribution" JSONB,
    "metadata" JSONB,
    "lastCrawledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InternalLinkNode_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InternalLinkEdge" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "fromNodeId" TEXT NOT NULL,
    "toNodeId" TEXT NOT NULL,
    "articleId" TEXT,
    "anchorText" TEXT NOT NULL,
    "placement" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 75,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InternalLinkEdge_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ContentGoal" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "ContentGoalStatus" NOT NULL DEFAULT 'draft',
    "metric" TEXT NOT NULL DEFAULT 'organic_impressions',
    "baselineValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "targetValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currentValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "strategy" JSONB,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentGoal_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ContentCalendarItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "goalId" TEXT,
    "campaignId" TEXT,
    "articleId" TEXT,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "topic" TEXT NOT NULL,
    "primaryKeyword" TEXT,
    "actionType" TEXT NOT NULL DEFAULT 'new_article',
    "status" "ContentCalendarItemStatus" NOT NULL DEFAULT 'planned',
    "priority" TEXT NOT NULL DEFAULT 'medium',
    "plannedByRole" "AgentRole",
    "inputs" JSONB,
    "output" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentCalendarItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InternalLinkNode_storeId_url_key" ON "InternalLinkNode"("storeId", "url");
CREATE INDEX "InternalLinkNode_organizationId_pageType_idx" ON "InternalLinkNode"("organizationId", "pageType");
CREATE INDEX "InternalLinkNode_storeId_pageType_authorityScore_idx" ON "InternalLinkNode"("storeId", "pageType", "authorityScore");
CREATE INDEX "InternalLinkNode_articleId_idx" ON "InternalLinkNode"("articleId");
CREATE INDEX "InternalLinkNode_sourceType_sourceId_idx" ON "InternalLinkNode"("sourceType", "sourceId");

CREATE UNIQUE INDEX "InternalLinkEdge_storeId_fromNodeId_toNodeId_anchorText_key" ON "InternalLinkEdge"("storeId", "fromNodeId", "toNodeId", "anchorText");
CREATE INDEX "InternalLinkEdge_organizationId_storeId_idx" ON "InternalLinkEdge"("organizationId", "storeId");
CREATE INDEX "InternalLinkEdge_fromNodeId_idx" ON "InternalLinkEdge"("fromNodeId");
CREATE INDEX "InternalLinkEdge_toNodeId_idx" ON "InternalLinkEdge"("toNodeId");
CREATE INDEX "InternalLinkEdge_articleId_idx" ON "InternalLinkEdge"("articleId");

CREATE INDEX "ContentGoal_organizationId_status_idx" ON "ContentGoal"("organizationId", "status");
CREATE INDEX "ContentGoal_storeId_status_startDate_endDate_idx" ON "ContentGoal"("storeId", "status", "startDate", "endDate");

CREATE INDEX "ContentCalendarItem_organizationId_status_dueDate_idx" ON "ContentCalendarItem"("organizationId", "status", "dueDate");
CREATE INDEX "ContentCalendarItem_storeId_status_dueDate_idx" ON "ContentCalendarItem"("storeId", "status", "dueDate");
CREATE INDEX "ContentCalendarItem_goalId_idx" ON "ContentCalendarItem"("goalId");
CREATE INDEX "ContentCalendarItem_campaignId_idx" ON "ContentCalendarItem"("campaignId");
CREATE INDEX "ContentCalendarItem_articleId_idx" ON "ContentCalendarItem"("articleId");

ALTER TABLE "InternalLinkNode" ADD CONSTRAINT "InternalLinkNode_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InternalLinkNode" ADD CONSTRAINT "InternalLinkNode_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "ShopifyStore"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InternalLinkNode" ADD CONSTRAINT "InternalLinkNode_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "BlogArticle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "InternalLinkEdge" ADD CONSTRAINT "InternalLinkEdge_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InternalLinkEdge" ADD CONSTRAINT "InternalLinkEdge_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "ShopifyStore"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InternalLinkEdge" ADD CONSTRAINT "InternalLinkEdge_fromNodeId_fkey" FOREIGN KEY ("fromNodeId") REFERENCES "InternalLinkNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InternalLinkEdge" ADD CONSTRAINT "InternalLinkEdge_toNodeId_fkey" FOREIGN KEY ("toNodeId") REFERENCES "InternalLinkNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InternalLinkEdge" ADD CONSTRAINT "InternalLinkEdge_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "BlogArticle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ContentGoal" ADD CONSTRAINT "ContentGoal_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContentGoal" ADD CONSTRAINT "ContentGoal_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "ShopifyStore"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ContentCalendarItem" ADD CONSTRAINT "ContentCalendarItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContentCalendarItem" ADD CONSTRAINT "ContentCalendarItem_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "ShopifyStore"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContentCalendarItem" ADD CONSTRAINT "ContentCalendarItem_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "ContentGoal"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ContentCalendarItem" ADD CONSTRAINT "ContentCalendarItem_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "BlogCampaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ContentCalendarItem" ADD CONSTRAINT "ContentCalendarItem_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "BlogArticle"("id") ON DELETE SET NULL ON UPDATE CASCADE;
