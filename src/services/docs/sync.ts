import {
  DocPageType,
  DocRelationType,
  DocSyncRunStatus
} from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import {
  classifyDocPage,
  extractDocSnapshot,
  fetchBestDocVariant,
  inferRelationType,
  normalizeDocUrl
} from "./extract.js";
import { ensureDocSource } from "./queries.js";
import { docSourceDefinition } from "./source.js";

interface SyncDocInput {
  maxPages?: number;
  trigger?: string;
  requestedBy?: string;
}

function getPathname(url: string): string {
  return new URL(url).pathname.replace(/\/+$/u, "") || "/";
}

async function ensureTargetPage(sourceId: string, url: string, relationType: DocRelationType) {
  const pathname = getPathname(url);
  return prisma.docPage.upsert({
    where: { url },
    create: {
      sourceId,
      url,
      canonicalUrl: url,
      path: pathname,
      slug: pathname.split("/").filter(Boolean).at(-1) ?? null,
      pageType:
        relationType === DocRelationType.CHANGELOG_ENTRY
          ? DocPageType.CHANGELOG_VERSION
          : classifyDocPage(pathname)
    },
    update: {
      lastSeenAt: new Date()
    }
  });
}

async function syncSingleDocPage(sourceId: string, url: string) {
  const fetchResult = await fetchBestDocVariant(url);
  const responsePath = getPathname(fetchResult.responseUrl);
  const pageType = classifyDocPage(responsePath);
  const extracted = extractDocSnapshot(fetchResult.rawHtml, fetchResult.responseUrl, pageType);
  const canonicalIdentityUrl = normalizeDocUrl(
    extracted.canonicalUrl ?? fetchResult.responseUrl,
    docSourceDefinition.baseUrl
  );
  const identityUrl = canonicalIdentityUrl ?? normalizeDocUrl(fetchResult.responseUrl) ?? url;
  const identityPath = getPathname(identityUrl);

  const existing = await prisma.docPage.findFirst({
    where: {
      OR: [
        { url: identityUrl },
        { url },
        { canonicalUrl: identityUrl },
        { canonicalUrl: url }
      ]
    },
    select: {
      id: true,
      latestSnapshotId: true
    }
  });

  const page = existing
    ? await prisma.docPage.update({
        where: { id: existing.id },
        data: {
          url: identityUrl,
          canonicalUrl: extracted.canonicalUrl ?? identityUrl,
          path: identityPath,
          slug: identityPath.split("/").filter(Boolean).at(-1) ?? null,
          title: extracted.title,
          pageType,
          lastSeenAt: new Date()
        }
      })
    : await prisma.docPage.create({
        data: {
          sourceId,
          url: identityUrl,
          canonicalUrl: extracted.canonicalUrl ?? identityUrl,
          path: identityPath,
          slug: identityPath.split("/").filter(Boolean).at(-1) ?? null,
          title: extracted.title,
          pageType
        }
      });

  const previousSnapshot = page.latestSnapshotId
    ? await prisma.docSnapshot.findUnique({
        where: { id: page.latestSnapshotId },
        select: {
          id: true,
          contentHash: true
        }
      })
    : null;

  const snapshot = await prisma.docSnapshot.create({
    data: {
      pageId: page.id,
      requestUrl: fetchResult.requestUrl,
      responseUrl: fetchResult.responseUrl,
      fetchMode: fetchResult.fetchMode,
      httpStatus: fetchResult.httpStatus,
      responseHeaders: fetchResult.responseHeaders,
      rawHtml: fetchResult.rawHtml,
      rawText: extracted.rawText,
      contentHash: extracted.contentHash,
      extractedData: extracted.extractedData,
      parserVersion: extracted.parserVersion
    }
  });

  const changed = previousSnapshot?.contentHash !== extracted.contentHash;
  if (changed) {
    await prisma.docChange.create({
      data: {
        pageId: page.id,
        previousSnapshotId: previousSnapshot?.id,
        currentSnapshotId: snapshot.id,
        previousHash: previousSnapshot?.contentHash,
        currentHash: extracted.contentHash,
        summary: {
          title: extracted.title,
          discoveredUrls: extracted.discoveredUrls.length,
          textLength: extracted.rawText.length
        }
      }
    });
  }

  await prisma.docPage.update({
    where: { id: page.id },
    data: {
      latestSnapshotId: snapshot.id
    }
  });

  const discoveredUrls: string[] = [];
  for (const targetUrl of extracted.discoveredUrls) {
    const relationType = inferRelationType(page.pageType, getPathname(targetUrl));
    const targetPage = await ensureTargetPage(sourceId, targetUrl, relationType);
    await prisma.docLink.create({
      data: {
        fromSnapshotId: snapshot.id,
        fromPageId: page.id,
        toPageId: targetPage.id,
        targetUrl,
        relationType,
        sourceHint: page.pageType
      }
    });
    discoveredUrls.push(targetUrl);
  }

  return {
    pageId: page.id,
    changed,
    discoveredUrls: [...new Set(discoveredUrls)]
  };
}

export async function syncMetaGraphDocs(input: SyncDocInput = {}) {
  const source = await ensureDocSource();
  const maxPages = Math.max(1, input.maxPages ?? 40);
  const syncRun = await prisma.docSyncRun.create({
    data: {
      sourceId: source.id,
      trigger: input.trigger ?? "manual",
      requestedBy: input.requestedBy,
      maxPages
    }
  });

  const queue = [...docSourceDefinition.seedUrls];
  const seen = new Set<string>();
  let pagesFetched = 0;
  let pagesChanged = 0;
  let pagesDiscovered = 0;

  try {
    while (queue.length > 0 && pagesFetched < maxPages) {
      const next = normalizeDocUrl(queue.shift() ?? "");
      if (!next || seen.has(next)) {
        continue;
      }

      seen.add(next);
      const result = await syncSingleDocPage(source.id, next);
      pagesFetched += 1;
      if (result.changed) {
        pagesChanged += 1;
      }

      for (const discoveredUrl of result.discoveredUrls) {
        if (!seen.has(discoveredUrl)) {
          queue.push(discoveredUrl);
          pagesDiscovered += 1;
        }
      }
    }

    return prisma.docSyncRun.update({
      where: { id: syncRun.id },
      data: {
        status: DocSyncRunStatus.SUCCEEDED,
        pagesFetched,
        pagesChanged,
        pagesDiscovered,
        finishedAt: new Date()
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown sync error";
    return prisma.docSyncRun.update({
      where: { id: syncRun.id },
      data: {
        status: DocSyncRunStatus.FAILED,
        pagesFetched,
        pagesChanged,
        pagesDiscovered,
        error: message,
        finishedAt: new Date()
      }
    });
  }
}
