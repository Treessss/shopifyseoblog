-- CreateTable
CREATE TABLE "AgentStep" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "topicRunId" TEXT,
    "campaignId" TEXT,
    "articleId" TEXT,
    "runId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "stepType" TEXT NOT NULL,
    "stepKey" TEXT NOT NULL,
    "stage" TEXT,
    "agentRole" "AgentRole",
    "status" "AgentToolCallStatus" NOT NULL DEFAULT 'passed',
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "decision" TEXT,
    "input" JSONB,
    "output" JSONB,
    "evidence" JSONB,
    "evidenceIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "warnings" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "latencyMs" INTEGER,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentStep_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AgentStep_topicRunId_sequence_key" ON "AgentStep"("topicRunId", "sequence");

-- CreateIndex
CREATE INDEX "AgentStep_runId_sequence_idx" ON "AgentStep"("runId", "sequence");

-- CreateIndex
CREATE INDEX "AgentStep_articleId_sequence_idx" ON "AgentStep"("articleId", "sequence");

-- CreateIndex
CREATE INDEX "AgentStep_storeId_status_createdAt_idx" ON "AgentStep"("storeId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "AgentStep_topicRunId_stepType_idx" ON "AgentStep"("topicRunId", "stepType");

-- AddForeignKey
ALTER TABLE "AgentStep" ADD CONSTRAINT "AgentStep_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentStep" ADD CONSTRAINT "AgentStep_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "ShopifyStore"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentStep" ADD CONSTRAINT "AgentStep_topicRunId_fkey" FOREIGN KEY ("topicRunId") REFERENCES "SeoTopicRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentStep" ADD CONSTRAINT "AgentStep_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "BlogCampaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentStep" ADD CONSTRAINT "AgentStep_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "BlogArticle"("id") ON DELETE SET NULL ON UPDATE CASCADE;
