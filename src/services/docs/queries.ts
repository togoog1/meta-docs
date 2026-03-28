import { DocPageType } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { docSourceDefinition } from "./source.js";

export async function ensureDocSource() {
  return prisma.docSource.upsert({
    where: { slug: docSourceDefinition.slug },
    create: {
      slug: docSourceDefinition.slug,
      label: docSourceDefinition.label,
      baseUrl: docSourceDefinition.baseUrl,
      allowedPath: docSourceDefinition.allowedPath,
      seedUrls: docSourceDefinition.seedUrls
    },
    update: {
      label: docSourceDefinition.label,
      baseUrl: docSourceDefinition.baseUrl,
      allowedPath: docSourceDefinition.allowedPath,
      seedUrls: docSourceDefinition.seedUrls
    }
  });
}

export async function getDocsOverview() {
  const source = await ensureDocSource();
  const [pageCount, snapshotCount, changeCount, recentRuns, recentChanges] = await Promise.all([
    prisma.docPage.count({ where: { sourceId: source.id } }),
    prisma.docSnapshot.count({ where: { page: { sourceId: source.id } } }),
    prisma.docChange.count({ where: { page: { sourceId: source.id } } }),
    prisma.docSyncRun.findMany({
      where: { sourceId: source.id },
      orderBy: { createdAt: "desc" },
      take: 8
    }),
    prisma.docChange.findMany({
      where: { page: { sourceId: source.id } },
      orderBy: { createdAt: "desc" },
      take: 12,
      include: {
        page: {
          select: {
            id: true,
            title: true,
            path: true,
            pageType: true
          }
        }
      }
    })
  ]);

  return {
    source,
    counts: {
      pages: pageCount,
      snapshots: snapshotCount,
      changes: changeCount
    },
    recentRuns,
    recentChanges
  };
}

export async function listDocPages(input: {
  query?: string;
  pageType?: DocPageType;
  limit?: number;
}) {
  const source = await ensureDocSource();
  const query = input.query?.trim();

  return prisma.docPage.findMany({
    where: {
      sourceId: source.id,
      pageType: input.pageType,
      OR: query
        ? [
            { title: { contains: query } },
            { path: { contains: query } },
            { url: { contains: query } }
          ]
        : undefined
    },
    orderBy: [{ updatedAt: "desc" }, { path: "asc" }],
    take: input.limit ?? 200,
    include: {
      snapshots: {
        orderBy: { fetchedAt: "desc" },
        take: 1,
        select: {
          id: true,
          httpStatus: true,
          fetchMode: true,
          fetchedAt: true,
          contentHash: true,
          extractedData: true
        }
      },
      _count: {
        select: {
          snapshots: true,
          changes: true,
          outgoingLinks: true
        }
      }
    }
  });
}

export async function getDocPageDetail(pageId: string) {
  const page = await prisma.docPage.findUnique({
    where: { id: pageId },
    include: {
      source: true,
      snapshots: {
        orderBy: { fetchedAt: "desc" },
        take: 20,
        select: {
          id: true,
          fetchedAt: true,
          httpStatus: true,
          fetchMode: true,
          contentHash: true,
          parserVersion: true
        }
      },
      changes: {
        orderBy: { createdAt: "desc" },
        take: 20
      },
      outgoingLinks: {
        orderBy: { createdAt: "desc" },
        take: 200,
        include: {
          toPage: {
            select: {
              id: true,
              title: true,
              path: true,
              pageType: true,
              latestSnapshotId: true
            }
          }
        }
      },
      incomingLinks: {
        orderBy: { createdAt: "desc" },
        take: 60,
        include: {
          fromPage: {
            select: {
              id: true,
              title: true,
              path: true,
              pageType: true
            }
          }
        }
      }
    }
  });

  if (!page) {
    throw new Error("Doc page not found");
  }

  const latestSnapshot =
    page.latestSnapshotId === null
      ? null
      : await prisma.docSnapshot.findUnique({
          where: { id: page.latestSnapshotId }
        });

  return {
    ...page,
    latestSnapshot
  };
}

export async function getDocSnapshot(snapshotId: string) {
  const snapshot = await prisma.docSnapshot.findUnique({
    where: { id: snapshotId },
    include: {
      page: {
        select: {
          id: true,
          title: true,
          path: true,
          pageType: true
        }
      }
    }
  });

  if (!snapshot) {
    throw new Error("Doc snapshot not found");
  }

  return snapshot;
}
