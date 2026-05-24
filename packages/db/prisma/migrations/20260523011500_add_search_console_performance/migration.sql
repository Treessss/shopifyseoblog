-- CreateEnum
CREATE TYPE "SearchConsolePropertyStatus" AS ENUM ('active', 'needs_auth', 'disconnected', 'archived');

-- CreateEnum
CREATE TYPE "SeoPerformanceSource" AS ENUM ('google_search_console');

-- AlterEnum
ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'sync_search_console';

-- CreateTable
CREATE TABLE "SearchConsoleProperty" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "siteUrl" TEXT NOT NULL,
    "status" "SearchConsolePropertyStatus" NOT NULL DEFAULT 'active',
    "permissionLevel" TEXT,
    "scopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "googleClientId" TEXT,
    "googleClientSecretEncrypted" TEXT,
    "accessTokenEncrypted" TEXT,
    "refreshTokenEncrypted" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3),
    "lastSyncError" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SearchConsoleProperty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArticleSeoPerformanceSnapshot" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "source" "SeoPerformanceSource" NOT NULL DEFAULT 'google_search_console',
    "pageUrl" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "dataState" TEXT NOT NULL DEFAULT 'final',
    "clicks" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "impressions" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "ctr" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "position" DOUBLE PRECISION,
    "queryCount" INTEGER NOT NULL DEFAULT 0,
    "topQuery" TEXT,
    "performanceScore" DOUBLE PRECISION,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ArticleSeoPerformanceSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArticleSeoQueryPerformance" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "snapshotId" TEXT,
    "source" "SeoPerformanceSource" NOT NULL DEFAULT 'google_search_console',
    "pageUrl" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "dataState" TEXT NOT NULL DEFAULT 'final',
    "clicks" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "impressions" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "ctr" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "position" DOUBLE PRECISION,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,
    "dedupeHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ArticleSeoQueryPerformance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SearchConsoleProperty_storeId_siteUrl_key" ON "SearchConsoleProperty"("storeId", "siteUrl");

-- CreateIndex
CREATE INDEX "SearchConsoleProperty_organizationId_status_idx" ON "SearchConsoleProperty"("organizationId", "status");

-- CreateIndex
CREATE INDEX "SearchConsoleProperty_storeId_status_idx" ON "SearchConsoleProperty"("storeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ArticleSeoPerformanceSnapshot_propertyId_articleId_startDate_endDate_dataState_key" ON "ArticleSeoPerformanceSnapshot"("propertyId", "articleId", "startDate", "endDate", "dataState");

-- CreateIndex
CREATE INDEX "ArticleSeoPerformanceSnapshot_organizationId_syncedAt_idx" ON "ArticleSeoPerformanceSnapshot"("organizationId", "syncedAt");

-- CreateIndex
CREATE INDEX "ArticleSeoPerformanceSnapshot_storeId_startDate_endDate_idx" ON "ArticleSeoPerformanceSnapshot"("storeId", "startDate", "endDate");

-- CreateIndex
CREATE INDEX "ArticleSeoPerformanceSnapshot_articleId_syncedAt_idx" ON "ArticleSeoPerformanceSnapshot"("articleId", "syncedAt");

-- CreateIndex
CREATE INDEX "ArticleSeoPerformanceSnapshot_performanceScore_idx" ON "ArticleSeoPerformanceSnapshot"("performanceScore");

-- CreateIndex
CREATE UNIQUE INDEX "ArticleSeoQueryPerformance_storeId_dedupeHash_key" ON "ArticleSeoQueryPerformance"("storeId", "dedupeHash");

-- CreateIndex
CREATE INDEX "ArticleSeoQueryPerformance_propertyId_startDate_endDate_idx" ON "ArticleSeoQueryPerformance"("propertyId", "startDate", "endDate");

-- CreateIndex
CREATE INDEX "ArticleSeoQueryPerformance_articleId_impressions_idx" ON "ArticleSeoQueryPerformance"("articleId", "impressions");

-- CreateIndex
CREATE INDEX "ArticleSeoQueryPerformance_query_idx" ON "ArticleSeoQueryPerformance"("query");

-- AddForeignKey
ALTER TABLE "SearchConsoleProperty" ADD CONSTRAINT "SearchConsoleProperty_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SearchConsoleProperty" ADD CONSTRAINT "SearchConsoleProperty_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "ShopifyStore"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArticleSeoPerformanceSnapshot" ADD CONSTRAINT "ArticleSeoPerformanceSnapshot_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArticleSeoPerformanceSnapshot" ADD CONSTRAINT "ArticleSeoPerformanceSnapshot_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "ShopifyStore"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArticleSeoPerformanceSnapshot" ADD CONSTRAINT "ArticleSeoPerformanceSnapshot_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "BlogArticle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArticleSeoPerformanceSnapshot" ADD CONSTRAINT "ArticleSeoPerformanceSnapshot_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "SearchConsoleProperty"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArticleSeoQueryPerformance" ADD CONSTRAINT "ArticleSeoQueryPerformance_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArticleSeoQueryPerformance" ADD CONSTRAINT "ArticleSeoQueryPerformance_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "ShopifyStore"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArticleSeoQueryPerformance" ADD CONSTRAINT "ArticleSeoQueryPerformance_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "BlogArticle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArticleSeoQueryPerformance" ADD CONSTRAINT "ArticleSeoQueryPerformance_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "SearchConsoleProperty"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArticleSeoQueryPerformance" ADD CONSTRAINT "ArticleSeoQueryPerformance_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "ArticleSeoPerformanceSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
