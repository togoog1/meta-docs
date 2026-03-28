import {
  DocPageType,
  Prisma,
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

interface ImportMissingDocInput {
  maxPages?: number | null;
  trigger?: string;
  requestedBy?: string;
  referenceOnly?: boolean;
  version?: string | "latest" | null;
  delayMs?: number;
  jitterMs?: number;
}

interface ExtractionDiagnostics {
  pageId: string;
  url: string;
  path: string;
  pageType: DocPageType;
  title: string | null;
  httpStatus: number;
  fetchMode: string;
  rawTextLength: number;
  introCount: number;
  headingCount: number;
  sectionCount: number;
  tableCount: number;
  nodeCount: number;
  discoveredUrlCount: number;
  hasDescription: boolean;
  gapFlags: string[];
}

interface SyncDiagnosticsSummary {
  pages: ExtractionDiagnostics[];
}

const shouldLogExtractionDiagnostics =
  process.env.DOCS_LOG_EXTRACTION !== "0" && process.env.DOCS_LOG_EXTRACTION !== "false";

const shouldLogVerboseExtractionDiagnostics =
  process.env.DOCS_LOG_EXTRACTION_VERBOSE === "1" || process.env.DOCS_LOG_EXTRACTION_VERBOSE === "true";

function getPathname(url: string): string {
  return new URL(url).pathname.replace(/\/+$/u, "") || "/";
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getImportDelayMs(inputDelayMs?: number) {
  const configured = Number.parseInt(process.env.DOCS_IMPORT_DELAY_MS ?? "", 10);
  if (typeof inputDelayMs === "number" && Number.isFinite(inputDelayMs)) {
    return Math.max(250, Math.min(inputDelayMs, 10_000));
  }
  if (Number.isFinite(configured)) {
    return Math.max(250, Math.min(configured, 10_000));
  }
  return 1_250;
}

function getImportJitterMs(inputJitterMs?: number) {
  const configured = Number.parseInt(process.env.DOCS_IMPORT_JITTER_MS ?? "", 10);
  if (typeof inputJitterMs === "number" && Number.isFinite(inputJitterMs)) {
    return Math.max(0, Math.min(inputJitterMs, 5_000));
  }
  if (Number.isFinite(configured)) {
    return Math.max(0, Math.min(configured, 5_000));
  }
  return 350;
}

function resolveImportPauseMs(inputDelayMs?: number, inputJitterMs?: number) {
  const delayMs = getImportDelayMs(inputDelayMs);
  const jitterMs = getImportJitterMs(inputJitterMs);
  if (jitterMs === 0) {
    return delayMs;
  }
  return delayMs + Math.floor(Math.random() * (jitterMs + 1));
}

function detectDocVersionFromPath(path: string): string | null {
  const normalized = path.replace(/^\/docs\/graph-api\/?/u, "").replace(/^\/+|\/+$/gu, "");
  const segments = normalized ? normalized.split("/").filter(Boolean) : [];
  if (segments[0] !== "reference") {
    return null;
  }
  const candidate = segments[1] ?? "";
  return /^v\d+\.\d+$/iu.test(candidate) ? candidate.slice(1) : null;
}

function matchesImportScope(
  path: string,
  input: Pick<ImportMissingDocInput, "referenceOnly" | "version">
) {
  if (input.referenceOnly !== false && !path.startsWith("/docs/graph-api/reference")) {
    return false;
  }

  if (!input.version || input.version === "latest") {
    return input.referenceOnly === false ? true : detectDocVersionFromPath(path) === null;
  }

  return detectDocVersionFromPath(path) === input.version;
}

async function findNextMissingDocPage(
  sourceId: string,
  input: Pick<ImportMissingDocInput, "referenceOnly" | "version">,
  attemptedPageIds: Set<string>
) {
  const baseWhere: Prisma.DocPageWhereInput = {
    sourceId,
    latestSnapshotId: null,
    path: {
      startsWith: input.referenceOnly === false ? docSourceDefinition.allowedPath : "/docs/graph-api/reference"
    }
  };

  const candidates = await prisma.docPage.findMany({
    where: baseWhere,
    orderBy: [{ updatedAt: "asc" }, { path: "asc" }],
    take: 500,
    select: {
      id: true,
      url: true,
      path: true
    }
  });

  return (
    candidates.find((page) => !attemptedPageIds.has(page.id) && matchesImportScope(page.path, input)) ?? null
  );
}

async function countMissingDocPages(
  sourceId: string,
  input: Pick<ImportMissingDocInput, "referenceOnly" | "version">
) {
  const candidates = await prisma.docPage.findMany({
    where: {
      sourceId,
      latestSnapshotId: null,
      path: {
        startsWith: input.referenceOnly === false ? docSourceDefinition.allowedPath : "/docs/graph-api/reference"
      }
    },
    select: {
      path: true
    }
  });

  return candidates.filter((page) => matchesImportScope(page.path, input)).length;
}

function computeGapFlags(input: {
  pageType: DocPageType;
  rawTextLength: number;
  hasDescription: boolean;
  headingCount: number;
  sectionCount: number;
  tableCount: number;
  nodeCount: number;
  discoveredUrlCount: number;
}) {
  const flags: string[] = [];

  if (input.rawTextLength < 300) {
    flags.push("thin_text");
  }
  if (!input.hasDescription) {
    flags.push("missing_description");
  }
  if (input.headingCount === 0) {
    flags.push("missing_headings");
  }
  if (input.sectionCount === 0) {
    flags.push("missing_sections");
  }
  if (input.discoveredUrlCount === 0) {
    flags.push("missing_links");
  }

  if (input.pageType === DocPageType.REFERENCE_INDEX && input.nodeCount === 0) {
    flags.push("missing_node_directory");
  }

  if (input.pageType === DocPageType.REFERENCE_ITEM) {
    if (input.sectionCount === 0) {
      flags.push("missing_reference_sections");
    }
    if (input.tableCount === 0) {
      flags.push("missing_reference_tables");
    }
  }

  return flags;
}

function logExtractionEvent(event: string, payload: unknown) {
  const normalizedPayload =
    payload && typeof payload === "object" ? payload : { value: payload };

  console.log(
    JSON.stringify({
      event,
      ts: new Date().toISOString(),
      ...normalizedPayload
    })
  );
}

function logExtractionSummary(summary: SyncDiagnosticsSummary) {
  if (!shouldLogExtractionDiagnostics || summary.pages.length === 0) {
    return;
  }

  const aggregateByPageType = Object.fromEntries(
    Object.values(DocPageType).map((pageType) => {
      const matching = summary.pages.filter((page) => page.pageType === pageType);
      return [
        pageType,
        {
          pages: matching.length,
          withDescription: matching.filter((page) => page.hasDescription).length,
          withSections: matching.filter((page) => page.sectionCount > 0).length,
          withTables: matching.filter((page) => page.tableCount > 0).length,
          withNodes: matching.filter((page) => page.nodeCount > 0).length,
          emptyParses: matching.filter((page) => page.gapFlags.length >= 4).length
        }
      ];
    })
  );

  const weakestPages = summary.pages
    .filter((page) => page.gapFlags.length > 0)
    .sort((left, right) => right.gapFlags.length - left.gapFlags.length)
    .slice(0, 12)
    .map((page) => ({
      path: page.path,
      pageType: page.pageType,
      gapFlags: page.gapFlags,
      rawTextLength: page.rawTextLength,
      discoveredUrlCount: page.discoveredUrlCount
    }));

  logExtractionEvent("docs.extraction.summary", {
    pagesFetched: summary.pages.length,
    aggregateByPageType,
    weakestPages
  });
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

export async function syncSingleDocPage(sourceId: string, url: string) {
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
      extractedData: extracted.extractedData as unknown as Prisma.InputJsonValue,
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

  const diagnostics: ExtractionDiagnostics = {
    pageId: page.id,
    url: identityUrl,
    path: identityPath,
    pageType,
    title: extracted.title,
    httpStatus: fetchResult.httpStatus,
    fetchMode: fetchResult.fetchMode,
    rawTextLength: extracted.rawText.length,
    introCount: extracted.introParagraphs.length,
    headingCount: extracted.headings.length,
    sectionCount: extracted.sections.length,
    tableCount: extracted.tables.length,
    nodeCount: extracted.nodeDirectory.length,
    discoveredUrlCount: discoveredUrls.length,
    hasDescription: Boolean(extracted.description),
    gapFlags: computeGapFlags({
      pageType,
      rawTextLength: extracted.rawText.length,
      hasDescription: Boolean(extracted.description),
      headingCount: extracted.headings.length,
      sectionCount: extracted.sections.length,
      tableCount: extracted.tables.length,
      nodeCount: extracted.nodeDirectory.length,
      discoveredUrlCount: discoveredUrls.length
    })
  };

  if (shouldLogExtractionDiagnostics) {
    logExtractionEvent("docs.extraction.page", diagnostics);

    if (shouldLogVerboseExtractionDiagnostics || diagnostics.gapFlags.length > 0) {
      logExtractionEvent("docs.extraction.gaps", {
        path: diagnostics.path,
        pageType: diagnostics.pageType,
        title: diagnostics.title,
        gapFlags: diagnostics.gapFlags,
        preview: extracted.rawText.slice(0, 280)
      });
    }
  }

  return {
    pageId: page.id,
    changed,
    discoveredUrls: [...new Set(discoveredUrls)],
    diagnostics
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
  const diagnosticsSummary: SyncDiagnosticsSummary = {
    pages: []
  };
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
      diagnosticsSummary.pages.push(result.diagnostics);
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

    logExtractionSummary(diagnosticsSummary);

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
    logExtractionSummary(diagnosticsSummary);
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

export async function importMissingDocPages(input: ImportMissingDocInput = {}) {
  const source = await ensureDocSource();
  const diagnosticsSummary: SyncDiagnosticsSummary = {
    pages: []
  };
  const attemptedPageIds = new Set<string>();
  const discoveredDuringRun = new Set<string>();
  const maxPages = input.maxPages ?? null;
  let pagesFetched = 0;
  let pagesChanged = 0;

  const syncRun = await prisma.docSyncRun.create({
    data: {
      sourceId: source.id,
      trigger: input.trigger ?? "import-missing",
      requestedBy: input.requestedBy,
      maxPages
    }
  });

  try {
    while (maxPages === null || pagesFetched < maxPages) {
      const nextPage = await findNextMissingDocPage(
        source.id,
        {
          referenceOnly: input.referenceOnly,
          version: input.version
        },
        attemptedPageIds
      );

      if (!nextPage) {
        break;
      }

      attemptedPageIds.add(nextPage.id);
      const result = await syncSingleDocPage(source.id, nextPage.url);
      diagnosticsSummary.pages.push(result.diagnostics);
      pagesFetched += 1;
      if (result.changed) {
        pagesChanged += 1;
      }

      for (const discoveredUrl of result.discoveredUrls) {
        discoveredDuringRun.add(discoveredUrl);
      }

      const pauseMs = resolveImportPauseMs(input.delayMs, input.jitterMs);
      if (pauseMs > 0) {
        await sleep(pauseMs);
      }
    }

    const remainingPages = await countMissingDocPages(source.id, {
      referenceOnly: input.referenceOnly,
      version: input.version
    });

    logExtractionSummary(diagnosticsSummary);

    const run = await prisma.docSyncRun.update({
      where: { id: syncRun.id },
      data: {
        status: DocSyncRunStatus.SUCCEEDED,
        pagesFetched,
        pagesChanged,
        pagesDiscovered: discoveredDuringRun.size,
        finishedAt: new Date()
      }
    });

    return {
      run,
      remainingPages
    };
  } catch (error) {
    logExtractionSummary(diagnosticsSummary);
    const message = error instanceof Error ? error.message : "Unknown import error";
    const run = await prisma.docSyncRun.update({
      where: { id: syncRun.id },
      data: {
        status: DocSyncRunStatus.FAILED,
        pagesFetched,
        pagesChanged,
        pagesDiscovered: discoveredDuringRun.size,
        error: message,
        finishedAt: new Date()
      }
    });

    return {
      run,
      remainingPages: await countMissingDocPages(source.id, {
        referenceOnly: input.referenceOnly,
        version: input.version
      })
    };
  }
}
