import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { prisma } from "../../lib/prisma.js";
import { ensureDocSource } from "./queries.js";

type ExportNodeKind = "folder" | "page" | "section" | "collection" | "entry" | "directory";

interface ExportSection {
  heading: string;
  level: number;
  anchor?: string | null;
  sourceUrl?: string | null;
  paragraphs?: string[];
}

interface ExportLinkReference {
  href: string;
  normalizedUrl: string | null;
  label: string;
}

interface ExportTableRow {
  cells: string[];
  cellLines?: string[][];
  links?: ExportLinkReference[];
}

interface ExportTable {
  headers: string[];
  sectionHeading?: string | null;
  sectionAnchor?: string | null;
  sourceUrl?: string | null;
  rows: ExportTableRow[];
}

interface ExportCollectionEntry {
  name: string;
  detail?: string | null;
  description: string;
  normalizedUrl?: string | null;
  sourceUrl?: string | null;
}

interface ExportCollection {
  key: string;
  label: string;
  anchor?: string | null;
  sourceUrl?: string | null;
  entries: ExportCollectionEntry[];
}

interface ExportDirectoryEntry {
  label: string;
  description: string;
  normalizedUrl?: string | null;
  sourceUrl?: string | null;
  slug?: string | null;
}

interface ExportedDataShape {
  title?: string | null;
  canonicalUrl?: string | null;
  description?: string | null;
  sections?: ExportSection[];
  tables?: ExportTable[];
  referenceCollections?: ExportCollection[];
  nodeDirectory?: ExportDirectoryEntry[];
}

interface ExportTreeNode {
  id: string;
  kind: ExportNodeKind;
  label: string;
  pageId?: string;
  path?: string;
  sourceUrl?: string | null;
  pageType?: string;
  description?: string | null;
  detail?: string | null;
  children: ExportTreeNode[];
}

function slugifyFragment(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}

function buildFragmentUrl(url: string | null | undefined, fragment: string | null | undefined): string | null {
  if (!url) {
    return null;
  }

  try {
    const parsed = new URL(url);
    parsed.hash = fragment ? fragment.replace(/^#/u, "") : "";
    return parsed.toString();
  } catch {
    return url;
  }
}

function getGraphPathSegments(docPath: string): string[] {
  const normalized = docPath.replace(/^\/docs\/graph-api\/?/u, "").replace(/^\/+|\/+$/gu, "");
  return normalized ? normalized.split("/").filter(Boolean) : [];
}

function buildPageTreePath(docPath: string): { folders: string[]; leafLabel: string } {
  const segments = getGraphPathSegments(docPath);
  if (segments.length === 0) {
    return { folders: [], leafLabel: "index" };
  }
  if (segments.length === 1) {
    return { folders: [segments[0]!], leafLabel: "index" };
  }
  return {
    folders: segments.slice(0, -1),
    leafLabel: segments.at(-1) ?? "index"
  };
}

function deriveReferenceCollections(extracted: ExportedDataShape | null, fallbackUrl: string | null): ExportCollection[] {
  if (!extracted) {
    return [];
  }

  if (extracted.referenceCollections?.length) {
    return extracted.referenceCollections;
  }

  const derivedCollections = (extracted.tables ?? []).flatMap((table) => {
      const firstHeader = table.headers[0]?.toLowerCase() ?? "";
      const secondHeader = table.headers[1]?.toLowerCase() ?? "";
      const collectionMeta =
        firstHeader === "field" && secondHeader === "description"
          ? { key: "fields", label: "Fields" }
          : firstHeader === "edge" && secondHeader === "description"
            ? { key: "edges", label: "Edges" }
            : firstHeader === "parameter" && secondHeader === "description"
              ? { key: "parameters", label: "Parameters" }
              : firstHeader === "error" && secondHeader === "description"
                ? { key: "errors", label: "Errors" }
                : null;

      if (!collectionMeta) {
        return [];
      }

      const anchor = table.sectionAnchor ?? (table.sectionHeading ? slugifyFragment(table.sectionHeading) : null);
      const sourceUrl = table.sourceUrl ?? buildFragmentUrl(fallbackUrl, anchor);

      return [{
        key: collectionMeta.key,
        label: collectionMeta.label,
        anchor,
        sourceUrl,
        entries: table.rows
          .map((row) => ({
            name: row.cellLines?.[0]?.[0] ?? row.cells[0] ?? "",
            detail: row.cellLines?.[0]?.slice(1).join(" · ") || null,
            description: row.cells[1] ?? "",
            normalizedUrl: row.links?.[0]?.normalizedUrl ?? null,
            sourceUrl
          }))
          .filter((entry) => entry.name.length > 0)
      } satisfies ExportCollection];
    });

  return derivedCollections;
}

function compareExportNodes(left: ExportTreeNode, right: ExportTreeNode): number {
  if (left.kind === "folder" && right.kind !== "folder") {
    return -1;
  }
  if (left.kind !== "folder" && right.kind === "folder") {
    return 1;
  }
  return left.label.localeCompare(right.label, undefined, { sensitivity: "base" });
}

function sortTree(nodes: ExportTreeNode[]) {
  nodes.sort(compareExportNodes);
  for (const node of nodes) {
    sortTree(node.children);
  }
}

export async function buildDocsTreeExport() {
  const source = await ensureDocSource();
  const pages = await prisma.docPage.findMany({
    where: { sourceId: source.id },
    orderBy: [{ updatedAt: "desc" }, { path: "asc" }],
    include: {
      snapshots: {
        orderBy: { fetchedAt: "desc" },
        take: 1,
        select: {
          id: true,
          fetchedAt: true,
          extractedData: true
        }
      },
      _count: {
        select: {
          snapshots: true,
          outgoingLinks: true
        }
      }
    }
  });

  const rootNodes: ExportTreeNode[] = [];

  function ensureFolder(pathParts: string[]): ExportTreeNode[] {
    let siblings = rootNodes;
    let accumulated = "";

    for (const part of pathParts) {
      accumulated = accumulated ? `${accumulated}/${part}` : part;
      const folderId = `folder:${accumulated}`;
      let folder = siblings.find((node) => node.id === folderId);
      if (!folder) {
        folder = {
          id: folderId,
          kind: "folder",
          label: part,
          children: []
        };
        siblings.push(folder);
      }
      siblings = folder.children;
    }

    return siblings;
  }

  for (const page of pages) {
    const extracted = (page.snapshots[0]?.extractedData ?? null) as ExportedDataShape | null;
    const sourceUrl = extracted?.canonicalUrl ?? page.url;
    const { folders, leafLabel } = buildPageTreePath(page.path);
    const siblings = ensureFolder(folders);
    const pageNode: ExportTreeNode = {
      id: `page:${page.id}`,
      kind: "page",
      label: leafLabel,
      pageId: page.id,
      path: page.path,
      sourceUrl,
      pageType: page.pageType,
      description: extracted?.description ?? null,
      children: []
    };

    const sections = (extracted?.sections ?? []).map((section) => ({
      id: `section:${page.id}:${section.anchor ?? section.heading}`,
      kind: "section" as const,
      label: section.heading,
      pageId: page.id,
      path: page.path,
      sourceUrl: section.sourceUrl ?? buildFragmentUrl(sourceUrl, section.anchor ?? slugifyFragment(section.heading)),
      description: section.paragraphs?.[0] ?? null,
      children: []
    }));

    const collections = deriveReferenceCollections(extracted, sourceUrl).map((collection) => ({
      id: `collection:${page.id}:${collection.key}`,
      kind: "collection" as const,
      label: collection.label,
      pageId: page.id,
      path: page.path,
      sourceUrl: collection.sourceUrl ?? null,
      children: collection.entries.map((entry) => ({
        id: `entry:${page.id}:${collection.key}:${entry.name}`,
        kind: "entry" as const,
        label: entry.name,
        pageId: page.id,
        path: page.path,
        sourceUrl: entry.sourceUrl ?? collection.sourceUrl ?? null,
        description: entry.description,
        detail: entry.detail ?? null,
        children: []
      }))
    }));

    const directory = (extracted?.nodeDirectory ?? []).map((entry) => ({
      id: `directory:${page.id}:${entry.slug ?? entry.label}`,
      kind: "directory" as const,
      label: entry.label,
      pageId: page.id,
      path: page.path,
      sourceUrl: entry.sourceUrl ?? entry.normalizedUrl ?? null,
      description: entry.description,
      children: []
    }));

    if (sections.length > 0) {
      pageNode.children.push({
        id: `page-sections:${page.id}`,
        kind: "folder",
        label: "sections",
        pageId: page.id,
        path: page.path,
        children: sections
      });
    }

    if (collections.length > 0) {
      pageNode.children.push({
        id: `page-collections:${page.id}`,
        kind: "folder",
        label: "collections",
        pageId: page.id,
        path: page.path,
        children: collections
      });
    }

    if (directory.length > 0) {
      pageNode.children.push({
        id: `page-directory:${page.id}`,
        kind: "folder",
        label: "directory",
        pageId: page.id,
        path: page.path,
        children: directory
      });
    }

    siblings.push(pageNode);
  }

  sortTree(rootNodes);

  return {
    generatedAt: new Date().toISOString(),
    source: {
      slug: source.slug,
      label: source.label,
      baseUrl: source.baseUrl
    },
    counts: {
      pages: pages.length,
      fetchedPages: pages.filter((page) => page._count.snapshots > 0).length
    },
    tree: rootNodes
  };
}

export async function saveDocsTreeExport(projectRoot: string) {
  const payload = await buildDocsTreeExport();
  const exportDir = path.join(projectRoot, "exports", "doc-tree");
  await mkdir(exportDir, { recursive: true });

  const timestamp = payload.generatedAt.replace(/[:]/gu, "-").replace(/\..+$/u, "");
  const filePath = path.join(exportDir, `meta-docs-tree-${timestamp}.json`);
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  return {
    ...payload,
    filePath
  };
}
