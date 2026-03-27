import { prisma } from "./prisma.js";

const ddlStatements = [
  "PRAGMA foreign_keys = ON",
  `CREATE TABLE IF NOT EXISTS "DocSource" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slug" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "allowedPath" TEXT NOT NULL,
    "seedUrls" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "DocSource_slug_key" ON "DocSource"("slug")`,
  `CREATE TABLE IF NOT EXISTS "DocPage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "canonicalUrl" TEXT,
    "path" TEXT NOT NULL,
    "slug" TEXT,
    "title" TEXT,
    "pageType" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "latestSnapshotId" TEXT,
    "firstSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DocPage_sourceId_fkey"
      FOREIGN KEY ("sourceId") REFERENCES "DocSource"("id")
      ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DocPage_pageType_check"
      CHECK ("pageType" IN ('REFERENCE_INDEX', 'REFERENCE_ITEM', 'GUIDE', 'CHANGELOG', 'CHANGELOG_VERSION', 'UNKNOWN'))
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "DocPage_url_key" ON "DocPage"("url")`,
  `CREATE INDEX IF NOT EXISTS "DocPage_sourceId_pageType_updatedAt_idx" ON "DocPage"("sourceId", "pageType", "updatedAt")`,
  `CREATE INDEX IF NOT EXISTS "DocPage_sourceId_path_idx" ON "DocPage"("sourceId", "path")`,
  `CREATE INDEX IF NOT EXISTS "DocPage_latestSnapshotId_idx" ON "DocPage"("latestSnapshotId")`,
  `CREATE TABLE IF NOT EXISTS "DocSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "pageId" TEXT NOT NULL,
    "requestUrl" TEXT NOT NULL,
    "responseUrl" TEXT NOT NULL,
    "fetchMode" TEXT NOT NULL DEFAULT 'DEFAULT',
    "httpStatus" INTEGER NOT NULL,
    "responseHeaders" TEXT NOT NULL,
    "rawHtml" TEXT NOT NULL,
    "rawText" TEXT,
    "contentHash" TEXT NOT NULL,
    "extractedData" TEXT,
    "parserVersion" TEXT NOT NULL,
    "fetchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DocSnapshot_pageId_fkey"
      FOREIGN KEY ("pageId") REFERENCES "DocPage"("id")
      ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DocSnapshot_fetchMode_check"
      CHECK ("fetchMode" IN ('DEFAULT', 'NOSCRIPT'))
  )`,
  `CREATE INDEX IF NOT EXISTS "DocSnapshot_pageId_fetchedAt_idx" ON "DocSnapshot"("pageId", "fetchedAt")`,
  `CREATE INDEX IF NOT EXISTS "DocSnapshot_contentHash_idx" ON "DocSnapshot"("contentHash")`,
  `CREATE TABLE IF NOT EXISTS "DocLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fromSnapshotId" TEXT,
    "fromPageId" TEXT NOT NULL,
    "toPageId" TEXT,
    "targetUrl" TEXT NOT NULL,
    "relationType" TEXT NOT NULL,
    "anchorText" TEXT,
    "sourceHint" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DocLink_fromSnapshotId_fkey"
      FOREIGN KEY ("fromSnapshotId") REFERENCES "DocSnapshot"("id")
      ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DocLink_fromPageId_fkey"
      FOREIGN KEY ("fromPageId") REFERENCES "DocPage"("id")
      ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DocLink_toPageId_fkey"
      FOREIGN KEY ("toPageId") REFERENCES "DocPage"("id")
      ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "DocLink_relationType_check"
      CHECK ("relationType" IN ('DISCOVERED_CHILD', 'CHANGELOG_ENTRY', 'RELATED'))
  )`,
  `CREATE INDEX IF NOT EXISTS "DocLink_fromPageId_relationType_idx" ON "DocLink"("fromPageId", "relationType")`,
  `CREATE INDEX IF NOT EXISTS "DocLink_toPageId_relationType_idx" ON "DocLink"("toPageId", "relationType")`,
  `CREATE INDEX IF NOT EXISTS "DocLink_targetUrl_idx" ON "DocLink"("targetUrl")`,
  `CREATE TABLE IF NOT EXISTS "DocChange" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "pageId" TEXT NOT NULL,
    "previousSnapshotId" TEXT,
    "currentSnapshotId" TEXT NOT NULL,
    "previousHash" TEXT,
    "currentHash" TEXT NOT NULL,
    "summary" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DocChange_pageId_fkey"
      FOREIGN KEY ("pageId") REFERENCES "DocPage"("id")
      ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS "DocChange_pageId_createdAt_idx" ON "DocChange"("pageId", "createdAt")`,
  `CREATE TABLE IF NOT EXISTS "DocSyncRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "trigger" TEXT NOT NULL,
    "requestedBy" TEXT,
    "maxPages" INTEGER,
    "pagesDiscovered" INTEGER NOT NULL DEFAULT 0,
    "pagesFetched" INTEGER NOT NULL DEFAULT 0,
    "pagesChanged" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DocSyncRun_sourceId_fkey"
      FOREIGN KEY ("sourceId") REFERENCES "DocSource"("id")
      ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DocSyncRun_status_check"
      CHECK ("status" IN ('RUNNING', 'SUCCEEDED', 'FAILED'))
  )`,
  `CREATE INDEX IF NOT EXISTS "DocSyncRun_sourceId_createdAt_idx" ON "DocSyncRun"("sourceId", "createdAt")`,
  `CREATE INDEX IF NOT EXISTS "DocSyncRun_status_createdAt_idx" ON "DocSyncRun"("status", "createdAt")`
] as const;

let initializationPromise: Promise<void> | null = null;

export function initializeDatabaseSchema() {
  if (!initializationPromise) {
    initializationPromise = (async () => {
      for (const statement of ddlStatements) {
        await prisma.$executeRawUnsafe(statement);
      }
    })();
  }

  return initializationPromise;
}
