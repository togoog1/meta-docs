import { ReactNode, useEffect, useMemo, useState } from "react";

type DocPageType =
  | "REFERENCE_INDEX"
  | "REFERENCE_ITEM"
  | "GUIDE"
  | "CHANGELOG"
  | "CHANGELOG_VERSION"
  | "UNKNOWN";

interface ExtractedLinkReference {
  href: string;
  normalizedUrl: string | null;
  label: string;
}

interface ExtractedTableRow {
  cells: string[];
  cellLines?: string[][];
  links: ExtractedLinkReference[];
}

interface ExtractedTable {
  caption: string | null;
  sectionHeading?: string | null;
  sectionAnchor?: string | null;
  sourceUrl?: string;
  headers: string[];
  rows: ExtractedTableRow[];
  rowsTruncated: boolean;
}

interface ExtractedSection {
  heading: string;
  level: number;
  anchor?: string | null;
  sourceUrl?: string;
  paragraphs: string[];
}

interface ExtractedNodeDirectoryEntry {
  label: string;
  description: string;
  href: string | null;
  normalizedUrl: string | null;
  slug: string | null;
  sectionHeading?: string | null;
  sectionAnchor?: string | null;
  sourceUrl?: string;
}

interface ExtractedReferenceEntry {
  name: string;
  detail: string | null;
  description: string;
  href: string | null;
  normalizedUrl: string | null;
  sectionHeading?: string | null;
  sectionAnchor?: string | null;
  sourceUrl: string;
}

interface ExtractedReferenceCollection {
  key: string;
  label: string;
  anchor?: string | null;
  sourceUrl: string;
  entries: ExtractedReferenceEntry[];
}

interface ExtractedDataShape {
  title: string | null;
  canonicalUrl: string | null;
  description: string | null;
  headings: string[];
  introParagraphs: string[];
  sections: ExtractedSection[];
  tables: ExtractedTable[];
  nodeDirectory: ExtractedNodeDirectoryEntry[];
  referenceCollections?: ExtractedReferenceCollection[];
  sectionUrls?: string[];
  discoveredUrls: string[];
  textPreview: string;
  pageType: DocPageType;
}

interface DocsOverview {
  counts: {
    pages: number;
    snapshots: number;
    changes: number;
  };
  recentRuns: Array<{
    id: string;
    status: string;
    trigger: string;
    pagesFetched: number;
    pagesChanged: number;
    pagesDiscovered: number;
    createdAt: string;
    finishedAt: string | null;
  }>;
  recentChanges: Array<{
    id: string;
    createdAt: string;
    page: {
      id: string;
      title: string | null;
      path: string;
      pageType: DocPageType;
    };
  }>;
}

interface TreeExportResult {
  generatedAt: string;
  filePath: string;
  counts: {
    pages: number;
    fetchedPages: number;
  };
}

interface DocPageSummary {
  id: string;
  title: string | null;
  path: string;
  url: string;
  pageType: DocPageType;
  updatedAt: string;
  snapshots: Array<{
    id: string;
    fetchedAt: string;
    httpStatus: number;
    fetchMode: string;
    extractedData: ExtractedDataShape | null;
  }>;
  _count: {
    snapshots: number;
    changes: number;
    outgoingLinks: number;
  };
}

interface DocPageDetail {
  id: string;
  title: string | null;
  path: string;
  url: string;
  canonicalUrl: string | null;
  pageType: DocPageType;
  latestSnapshotId: string | null;
  updatedAt: string;
  snapshots: Array<{
    id: string;
    fetchedAt: string;
    httpStatus: number;
    fetchMode: string;
    contentHash: string;
    parserVersion: string;
  }>;
  outgoingLinks: Array<{
    id: string;
    targetUrl: string;
    relationType: string;
    toPage: {
      id: string;
      title: string | null;
      path: string;
      pageType: DocPageType;
      latestSnapshotId: string | null;
    } | null;
  }>;
  incomingLinks: Array<{
    id: string;
    relationType: string;
    fromPage: {
      id: string;
      title: string | null;
      path: string;
      pageType: DocPageType;
    };
  }>;
  changes: Array<{
    id: string;
    createdAt: string;
  }>;
  latestSnapshot: DocSnapshotDetail | null;
}

interface DocSnapshotDetail {
  id: string;
  requestUrl: string;
  responseUrl: string;
  fetchMode: string;
  httpStatus: number;
  fetchedAt: string;
  contentHash: string;
  parserVersion?: string;
  extractedData: ExtractedDataShape | null;
  rawHtml: string;
  rawText: string | null;
}

interface AccordionSectionProps {
  id: string;
  title: string;
  meta?: string;
  isOpen: boolean;
  onToggle: (id: string) => void;
  children: ReactNode;
}

type TreeTargetKind = "page" | "section" | "collection" | "entry" | "directory";

interface TreeTarget {
  id: string;
  kind: TreeTargetKind;
  pageId: string;
  label: string;
  description: string | null;
  detail?: string | null;
  path?: string | null;
  sourceUrl: string | null;
  linkedPageId?: string | null;
  linkedPageLabel?: string | null;
}

type SidebarTreeNodeKind = "folder" | "page" | "section" | "collection" | "entry" | "directory";

interface SidebarTreeNode {
  id: string;
  kind: SidebarTreeNodeKind;
  label: string;
  secondary?: string | null;
  badge?: string | null;
  count?: number;
  children: SidebarTreeNode[];
  target?: TreeTarget;
}

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/+$/u, "") ?? "";

const defaultOpenTreeNodes = new Set<string>([
  "reference:index"
]);

const defaultOpenSections = new Set([
  "map",
  "outline"
]);

function buildApiUrl(path: string): string {
  return apiBaseUrl ? `${apiBaseUrl}${path}` : path;
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(buildApiUrl(url), {
    headers: { "content-type": "application/json" },
    ...init
  });

  const contentType = response.headers.get("content-type") ?? "";
  if (!response.ok) {
    const body = (await response.json().catch(() => ({ error: "Request failed" }))) as {
      error?: string;
    };
    throw new Error(body.error ?? "Request failed");
  }

  if (!contentType.includes("application/json")) {
    const body = await response.text();
    if (/<!doctype html>|<html/iu.test(body)) {
      throw new Error(
        "Received HTML instead of API JSON. Start the API server and open the app through the Vite dev server or the Fastify app, not a static file."
      );
    }
    throw new Error(`Expected JSON response but received ${contentType || "unknown content type"}.`);
  }

  return response.json() as Promise<T>;
}

function formatDate(value: string | null): string {
  if (!value) {
    return "Not set";
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function cleanDocTitle(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  return value
    .replace(/\s*-\s*Documentation\s*-\s*Meta for Developers$/iu, "")
    .replace(/\s*-\s*Meta for Developers$/iu, "")
    .replace(/^Graph API Reference v\d+\.\d+:\s*/iu, "")
    .replace(/^Graph API Reference:\s*/iu, "")
    .replace(/\s*-\s*Graph API Reference$/iu, "")
    .replace(/\s*-\s*Graph API$/iu, "")
    .trim();
}

function titleForPage(page: { title: string | null; path: string }): string {
  return cleanDocTitle(page.title) ?? page.path.split("/").filter(Boolean).at(-1) ?? page.path;
}

function shortHash(value: string | null | undefined): string {
  return value ? value.slice(0, 16) : "Not set";
}

function truncateText(value: string | null | undefined, maxLength: number): string | null {
  if (!value) {
    return null;
  }
  const cleaned = cleanDocTitle(value) ?? value;
  if (cleaned.length <= maxLength) {
    return cleaned;
  }
  return `${cleaned.slice(0, maxLength - 1)}…`;
}

function hasSnapshot(page: Pick<DocPageSummary, "_count"> | Pick<DocPageDetail, "snapshots">): boolean {
  return "_count" in page ? page._count.snapshots > 0 : page.snapshots.length > 0;
}

function comparePages(left: DocPageSummary, right: DocPageSummary): number {
  const leftFetched = hasSnapshot(left) ? 1 : 0;
  const rightFetched = hasSnapshot(right) ? 1 : 0;
  if (leftFetched !== rightFetched) {
    return rightFetched - leftFetched;
  }

  const leftLinks = left._count.outgoingLinks;
  const rightLinks = right._count.outgoingLinks;
  if (leftLinks !== rightLinks) {
    return rightLinks - leftLinks;
  }

  return titleForPage(left).localeCompare(titleForPage(right), undefined, {
    sensitivity: "base"
  });
}

function formatSourceLabel(url: string | null | undefined): string {
  if (!url) {
    return "Not set";
  }

  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.hash}`;
  } catch {
    return url;
  }
}

function slugifyFragment(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}

function buildFragmentUrl(url: string | null | undefined, fragment: string | null | undefined): string {
  if (!url) {
    return "";
  }

  try {
    const parsed = new URL(url);
    parsed.hash = fragment ? fragment.replace(/^#/u, "") : "";
    return parsed.toString();
  } catch {
    return url;
  }
}

function deriveReferenceCollections(
  extracted: ExtractedDataShape | null,
  fallbackUrl: string | null
): ExtractedReferenceCollection[] {
  if (!extracted) {
    return [];
  }

  if (extracted.referenceCollections?.length) {
    return extracted.referenceCollections;
  }

  return (extracted.tables ?? [])
    .map((table) => {
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
        return null;
      }

      const anchor = table.sectionAnchor ?? (table.sectionHeading ? slugifyFragment(table.sectionHeading) : null);
      const sourceUrl = table.sourceUrl ?? buildFragmentUrl(fallbackUrl, anchor);

      return {
        key: collectionMeta.key,
        label: collectionMeta.label,
        anchor,
        sourceUrl,
        entries: table.rows
          .map((row) => ({
            name: row.cellLines?.[0]?.[0] ?? row.cells[0] ?? "",
            detail: row.cellLines?.[0]?.slice(1).join(" · ") || null,
            description: row.cells[1] ?? "",
            href: row.links[0]?.href ?? null,
            normalizedUrl: row.links[0]?.normalizedUrl ?? null,
            sectionHeading: table.sectionHeading ?? null,
            sectionAnchor: anchor,
            sourceUrl
          }))
          .filter((entry) => entry.name.length > 0)
      } satisfies ExtractedReferenceCollection;
    })
    .filter((collection): collection is ExtractedReferenceCollection => Boolean(collection));
}

function humanizeSegment(segment: string): string {
  if (segment === "index") {
    return "index";
  }
  return segment;
}

function getGraphPathSegments(path: string): string[] {
  const normalized = path.replace(/^\/docs\/graph-api\/?/u, "").replace(/^\/+|\/+$/gu, "");
  return normalized ? normalized.split("/").filter(Boolean) : [];
}

function buildReferenceTreePath(path: string): { folders: string[]; leafLabel: string } {
  const normalized = path.replace(/^\/docs\/graph-api\/reference\/?/u, "").replace(/^\/+|\/+$/gu, "");
  const segments = normalized ? normalized.split("/").filter(Boolean) : [];
  if (segments.length === 0) {
    return {
      folders: [],
      leafLabel: "index"
    };
  }

  if (segments.length === 1) {
    return {
      folders: [segments[0]],
      leafLabel: "index"
    };
  }

  return {
    folders: segments.slice(0, -1),
    leafLabel: segments.at(-1) ?? "index"
  };
}

function isReferencePath(path: string): boolean {
  return path === "/docs/graph-api/reference" || path.startsWith("/docs/graph-api/reference/");
}

function detectDocVersion(path: string): string | null {
  const changelogMatch = path.match(/\/docs\/graph-api\/changelog\/version(\d+\.\d+)$/u);
  if (changelogMatch?.[1]) {
    return changelogMatch[1];
  }

  const referenceMatch = path.match(/\/docs\/graph-api\/reference\/v(\d+\.\d+)(?:\/|$)/u);
  if (referenceMatch?.[1]) {
    return referenceMatch[1];
  }

  return null;
}

function compareVersions(left: string, right: string): number {
  const leftParts = left.split(".").map((part) => Number.parseInt(part, 10));
  const rightParts = right.split(".").map((part) => Number.parseInt(part, 10));
  const maxLength = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < maxLength; index += 1) {
    const leftValue = leftParts[index] ?? 0;
    const rightValue = rightParts[index] ?? 0;
    if (leftValue !== rightValue) {
      return rightValue - leftValue;
    }
  }

  return 0;
}

function makePageTarget(page: { id: string; path: string }, title: string, sourceUrl: string | null, description: string | null): TreeTarget {
  return {
    id: `page:${page.id}`,
    kind: "page",
    pageId: page.id,
    label: title,
    description,
    path: page.path,
    sourceUrl
  };
}

function serializeTreeNodes(nodes: SidebarTreeNode[], depth = 0): string[] {
  const lines: string[] = [];

  for (const node of nodes) {
    const indent = "  ".repeat(depth);
    const suffixParts = [
      node.badge ? `[${node.badge}]` : null,
      typeof node.count === "number" ? `(${node.count})` : null
    ].filter(Boolean);

    lines.push(`${indent}- ${node.label}${suffixParts.length > 0 ? ` ${suffixParts.join(" ")}` : ""}`);

    if (node.secondary) {
      lines.push(`${indent}  ${node.secondary}`);
    }

    if (node.target?.path) {
      lines.push(`${indent}  path: ${node.target.path}`);
    }

    if (node.target?.sourceUrl) {
      lines.push(`${indent}  source: ${node.target.sourceUrl}`);
    }

    if (node.children.length > 0) {
      lines.push(...serializeTreeNodes(node.children, depth + 1));
    }
  }

  return lines;
}

function AccordionSection({ id, title, meta, isOpen, onToggle, children }: AccordionSectionProps) {
  return (
    <section className={`docs-accordion ${isOpen ? "open" : ""}`}>
      <button type="button" className="docs-accordion-header" onClick={() => onToggle(id)}>
        <div className="docs-accordion-heading">
          <span className={`docs-accordion-chevron ${isOpen ? "open" : ""}`}>▾</span>
          <strong>{title}</strong>
          {meta ? <span className="docs-accordion-meta">{meta}</span> : null}
        </div>
      </button>
      {isOpen ? <div className="docs-accordion-body">{children}</div> : null}
    </section>
  );
}

export function DocsExplorer() {
  const [overview, setOverview] = useState<DocsOverview | null>(null);
  const [pages, setPages] = useState<DocPageSummary[]>([]);
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  const [focusedTreeTarget, setFocusedTreeTarget] = useState<TreeTarget | null>(null);
  const [pageDetail, setPageDetail] = useState<DocPageDetail | null>(null);
  const [selectedSnapshot, setSelectedSnapshot] = useState<DocSnapshotDetail | null>(null);
  const [query, setQuery] = useState("");
  const [selectedVersion, setSelectedVersion] = useState("latest");
  const [maxPages, setMaxPages] = useState("40");
  const [directoryQuery, setDirectoryQuery] = useState("");
  const [openTreeNodes, setOpenTreeNodes] = useState<Set<string>>(new Set(defaultOpenTreeNodes));
  const [openSections, setOpenSections] = useState<Set<string>>(new Set(defaultOpenSections));
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [copyingTree, setCopyingTree] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function loadOverview() {
    const next = await requestJson<DocsOverview>("/api/docs/overview");
    setOverview(next);
  }

  async function loadPages() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("limit", "240");
      const next = await requestJson<DocPageSummary[]>(`/api/docs/pages?${params.toString()}`);
      setPages(next);
      setSelectedPageId((current) => {
        if (current && next.some((page) => page.id === current)) {
          return current;
        }
        return next.find((page) => page._count.snapshots > 0)?.id ?? next[0]?.id ?? null;
      });
      setError(null);
      setNotice(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to load doc pages");
    } finally {
      setLoading(false);
    }
  }

  async function loadPageDetail(pageId: string) {
    try {
      const next = await requestJson<DocPageDetail>(`/api/docs/pages/${pageId}`);
      setPageDetail(next);
      setSelectedSnapshot(next.latestSnapshot);
      setDirectoryQuery("");
      setError(null);
      setNotice(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to load doc detail");
    }
  }

  async function loadSnapshot(snapshotId: string) {
    try {
      const next = await requestJson<DocSnapshotDetail>(`/api/docs/snapshots/${snapshotId}`);
      setSelectedSnapshot(next);
      setError(null);
      setNotice(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to load snapshot");
    }
  }

  useEffect(() => {
    void loadOverview();
  }, []);

  useEffect(() => {
    void loadPages();
  }, []);

  useEffect(() => {
    if (!selectedPageId) {
      setPageDetail(null);
      setSelectedSnapshot(null);
      setFocusedTreeTarget(null);
      return;
    }
    void loadPageDetail(selectedPageId);
  }, [selectedPageId]);

  async function handleSync() {
    setSyncing(true);
    try {
      await requestJson("/api/docs/sync", {
        method: "POST",
        body: JSON.stringify({
          maxPages: Number.parseInt(maxPages, 10) || 40
        })
      });
      await Promise.all([loadOverview(), loadPages()]);
      if (selectedPageId) {
        await loadPageDetail(selectedPageId);
      }
      setError(null);
      setNotice(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to sync docs");
    } finally {
      setSyncing(false);
    }
  }

  async function handleExportTree() {
    setExporting(true);
    try {
      const result = await requestJson<TreeExportResult>("/api/docs/tree/export", {
        method: "POST"
      });
      setNotice(`Tree exported to ${result.filePath}`);
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to export tree");
      setNotice(null);
    } finally {
      setExporting(false);
    }
  }

  async function handleCopyTree() {
    setCopyingTree(true);
    try {
      const treeText = serializeTreeNodes(treeNodes).join("\n");
      await navigator.clipboard.writeText(treeText);
      setNotice("Navigation tree copied to clipboard");
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to copy navigation tree");
      setNotice(null);
    } finally {
      setCopyingTree(false);
    }
  }

  function toggleTreeNode(id: string) {
    setOpenTreeNodes((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function toggleSection(id: string) {
    setOpenSections((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  const extracted = selectedSnapshot?.extractedData ?? null;
  const currentSourceUrl =
    selectedSnapshot?.responseUrl ?? extracted?.canonicalUrl ?? pageDetail?.canonicalUrl ?? pageDetail?.url ?? null;
  const currentSourceLabel = formatSourceLabel(currentSourceUrl);
  const cleanedDescription = cleanDocTitle(extracted?.description) ?? extracted?.description ?? null;
  const introParagraphs = extracted?.introParagraphs?.length
    ? extracted.introParagraphs
    : cleanedDescription
      ? [cleanedDescription]
      : [];
  const sections = (extracted?.sections ?? []).map((section) => ({
    ...section,
    sourceUrl:
      section.sourceUrl ??
      buildFragmentUrl(currentSourceUrl, section.anchor ?? slugifyFragment(section.heading))
  }));
  const tables = extracted?.tables ?? [];
  const nodeDirectory = extracted?.nodeDirectory ?? [];
  const referenceCollections = deriveReferenceCollections(extracted, currentSourceUrl);
  const defaultFocusedTarget = useMemo(
    () =>
      pageDetail
        ? makePageTarget(pageDetail, titleForPage(pageDetail), currentSourceUrl, cleanedDescription)
        : null,
    [cleanedDescription, currentSourceUrl, pageDetail]
  );
  const activeFocusedTarget =
    focusedTreeTarget && focusedTreeTarget.pageId === pageDetail?.id ? focusedTreeTarget : defaultFocusedTarget;

  const filteredNodeDirectory = useMemo(() => {
    const lookup = directoryQuery.trim().toLowerCase();
    if (!lookup) {
      return nodeDirectory;
    }
    return nodeDirectory.filter((entry) =>
      `${entry.label} ${entry.description} ${entry.slug ?? ""}`.toLowerCase().includes(lookup)
    );
  }, [directoryQuery, nodeDirectory]);

  const outgoingChildren = pageDetail?.outgoingLinks.filter(
    (link) => link.relationType === "DISCOVERED_CHILD" || link.relationType === "CHANGELOG_ENTRY"
  ) ?? [];
  const outgoingRelated = pageDetail?.outgoingLinks.filter(
    (link) => link.relationType !== "DISCOVERED_CHILD" && link.relationType !== "CHANGELOG_ENTRY"
  ) ?? [];

  const versionOptions = useMemo(() => {
    const versions = [...new Set(pages.map((page) => detectDocVersion(page.path)).filter(Boolean))] as string[];
    versions.sort(compareVersions);
    return versions;
  }, [pages]);
  const latestVersion = versionOptions[0] ?? null;

  const normalizedQuery = query.trim().toLowerCase();

  const helperPages = useMemo(
    () =>
      pages
        .filter((page) => !isReferencePath(page.path) && page.pageType !== "CHANGELOG_VERSION")
        .filter((page) =>
          normalizedQuery.length === 0
            ? true
            : `${titleForPage(page)} ${page.path} ${page.url}`.toLowerCase().includes(normalizedQuery)
        )
        .sort(comparePages),
    [normalizedQuery, pages]
  );

  const referencePages = useMemo(
    () =>
      pages
        .filter((page) => {
          if (!isReferencePath(page.path)) {
            return false;
          }
          const version = detectDocVersion(page.path);
          if (selectedVersion === "latest") {
            return version === null;
          }
          return version === selectedVersion;
        })
        .filter((page) =>
          normalizedQuery.length === 0
            ? true
            : `${titleForPage(page)} ${page.path} ${page.url}`.toLowerCase().includes(normalizedQuery)
        )
        .sort(comparePages),
    [normalizedQuery, pages, selectedVersion]
  );

  const storedPageByUrl = useMemo(() => new Map(pages.map((page) => [page.url, page])), [pages]);
  const treeNodes = useMemo(() => {
    const referenceIndexPage =
      referencePages.find((page) => page.path === "/docs/graph-api/reference") ?? null;
    const rootReferenceNode: SidebarTreeNode = {
      id: "reference:index",
      kind: "folder",
      label: "reference",
      secondary:
        referenceIndexPage?.snapshots[0]?.extractedData?.description ??
        referenceIndexPage?.snapshots[0]?.extractedData?.introParagraphs?.[0] ??
        null,
      badge: referenceIndexPage ? (referenceIndexPage._count.snapshots > 0 ? "fetched" : "discovered") : null,
      count: referenceIndexPage?._count.outgoingLinks ?? undefined,
      children: [],
      target: referenceIndexPage
        ? makePageTarget(
            referenceIndexPage,
            titleForPage(referenceIndexPage),
            referenceIndexPage.url,
            referenceIndexPage.snapshots[0]?.extractedData?.description ??
              referenceIndexPage.snapshots[0]?.extractedData?.introParagraphs?.[0] ??
              null
          )
        : undefined
    };
    const rootNodes: SidebarTreeNode[] = [rootReferenceNode];
    const selectedPage = referencePages.find((page) => page.id === selectedPageId) ?? null;

    function ensureFolder(pathParts: string[]): { siblings: SidebarTreeNode[]; folder: SidebarTreeNode | null } {
      let siblings = rootReferenceNode.children;
      let accumulated = "";
      let lastFolder: SidebarTreeNode | null = null;

      for (const part of pathParts) {
        accumulated = accumulated ? `${accumulated}/${part}` : part;
        const folderId = `folder:${accumulated}`;
        let folder = siblings.find((node) => node.id === folderId);
        if (!folder) {
          folder = {
            id: folderId,
            kind: "folder",
            label: humanizeSegment(part),
            children: []
          };
          siblings.push(folder);
        }
        lastFolder = folder;
        siblings = folder.children;
      }

      return {
        siblings,
        folder: lastFolder
      };
    }

    for (const page of referencePages) {
      const { folders, leafLabel } = buildReferenceTreePath(page.path);
      const { siblings, folder } = ensureFolder(folders);
      const pageDescription =
        page.snapshots[0]?.extractedData?.description ??
        page.snapshots[0]?.extractedData?.introParagraphs?.[0] ??
        null;

      if (page.path === "/docs/graph-api/reference") {
        continue;
      }

      if (leafLabel === "index" && folder) {
        folder.secondary = page.title && page.title !== leafLabel ? page.title : pageDescription;
        folder.badge = page._count.snapshots > 0 ? "fetched" : "discovered";
        folder.count = page._count.outgoingLinks;
        folder.target = makePageTarget(page, titleForPage(page), page.url, pageDescription);
        continue;
      }

      siblings.push({
        id: `page:${page.id}`,
        kind: "page",
        label: humanizeSegment(leafLabel),
        secondary: page.title && page.title !== leafLabel ? page.title : pageDescription,
        badge: page._count.snapshots > 0 ? "fetched" : "discovered",
        count: page._count.outgoingLinks,
        children: [],
        target: makePageTarget(page, titleForPage(page), page.url, pageDescription)
      });
    }

    if (selectedPage && pageDetail && selectedPage.id === pageDetail.id) {
      const selectedNode = rootNodes
        .flatMap(function flatten(node): SidebarTreeNode[] {
          return [node, ...node.children.flatMap(flatten)];
        })
        .find((node) => node.target?.pageId === selectedPage.id && node.target.kind === "page");

      if (selectedNode) {
        const selectedChildren: SidebarTreeNode[] = [];

        if (sections.length > 0) {
          selectedChildren.push({
            id: `page-sections:${selectedPage.id}`,
            kind: "folder",
            label: "sections",
            count: sections.length,
            children: sections.map((section) => ({
              id: `section:${selectedPage.id}:${section.anchor ?? section.heading}`,
              kind: "section",
              label: section.heading,
              secondary: truncateText(section.paragraphs[0], 88),
              children: [],
              target: {
                id: `section:${selectedPage.id}:${section.anchor ?? section.heading}`,
                kind: "section",
                pageId: selectedPage.id,
                label: section.heading,
                description: section.paragraphs[0] ?? null,
                path: pageDetail.path,
                sourceUrl: section.sourceUrl ?? null
              }
            }))
          });
        }

        if (referenceCollections.length > 0) {
          selectedChildren.push({
            id: `page-collections:${selectedPage.id}`,
            kind: "folder",
            label: "collections",
            count: referenceCollections.length,
            children: referenceCollections.map((collection) => ({
              id: `collection:${selectedPage.id}:${collection.key}`,
              kind: "collection",
              label: collection.label,
              secondary: formatSourceLabel(collection.sourceUrl),
              count: collection.entries.length,
              children: collection.entries.map((entry) => {
                const linkedPage = entry.normalizedUrl ? storedPageByUrl.get(entry.normalizedUrl) ?? null : null;
                return {
                  id: `entry:${selectedPage.id}:${collection.key}:${entry.name}`,
                  kind: "entry",
                  label: entry.name,
                  secondary: truncateText(entry.description, 72),
                  badge: linkedPage ? "linked" : null,
                  children: [],
                  target: {
                    id: `entry:${selectedPage.id}:${collection.key}:${entry.name}`,
                    kind: "entry",
                    pageId: selectedPage.id,
                    label: entry.name,
                    description: entry.description,
                    detail: entry.detail,
                    path: pageDetail.path,
                    sourceUrl: entry.sourceUrl,
                    linkedPageId: linkedPage?.id ?? null,
                    linkedPageLabel: linkedPage ? titleForPage(linkedPage) : null
                  }
                };
              })
            }))
          });
        }

        if (nodeDirectory.length > 0) {
          selectedChildren.push({
            id: `page-directory:${selectedPage.id}`,
            kind: "folder",
            label: "directory",
            count: nodeDirectory.length,
            children: nodeDirectory.map((entry) => {
              const linkedPage = entry.normalizedUrl ? storedPageByUrl.get(entry.normalizedUrl) ?? null : null;
              return {
                id: `directory:${selectedPage.id}:${entry.slug ?? entry.label}`,
                kind: "directory",
                label: entry.label,
                secondary: truncateText(entry.description, 72),
                badge: linkedPage ? "linked" : null,
                children: [],
                target: {
                  id: `directory:${selectedPage.id}:${entry.slug ?? entry.label}`,
                  kind: "directory",
                  pageId: selectedPage.id,
                  label: entry.label,
                  description: entry.description,
                  path: pageDetail.path,
                  sourceUrl: entry.sourceUrl ?? entry.normalizedUrl ?? null,
                  linkedPageId: linkedPage?.id ?? null,
                  linkedPageLabel: linkedPage ? titleForPage(linkedPage) : null
                }
              };
            })
          });
        }

        selectedNode.children = selectedChildren;
      }
    }

    return rootNodes;
  }, [nodeDirectory, pageDetail, referenceCollections, referencePages, sections, selectedPageId, storedPageByUrl]);

  useEffect(() => {
    if (!selectedPageId) {
      if (referencePages[0]) {
        setSelectedPageId(referencePages[0].id);
      }
      return;
    }

    const selectedPage = pages.find((page) => page.id === selectedPageId) ?? null;
    if (!selectedPage) {
      if (referencePages[0]) {
        setSelectedPageId(referencePages[0].id);
      }
      return;
    }

    if (isReferencePath(selectedPage.path) && !referencePages.some((page) => page.id === selectedPage.id)) {
      setSelectedPageId(referencePages[0]?.id ?? null);
    }
  }, [pages, referencePages, selectedPageId]);

  useEffect(() => {
    if (defaultFocusedTarget && (!focusedTreeTarget || focusedTreeTarget.pageId !== defaultFocusedTarget.pageId)) {
      setFocusedTreeTarget(defaultFocusedTarget);
    }
  }, [defaultFocusedTarget, focusedTreeTarget]);

  useEffect(() => {
    if (!pageDetail) {
      return;
    }

    if (!isReferencePath(pageDetail.path)) {
      return;
    }

    const { folders } = buildReferenceTreePath(pageDetail.path);

    setOpenTreeNodes((current) => {
      const next = new Set(current);
      let accumulated = "";
      for (const part of folders) {
        accumulated = accumulated ? `${accumulated}/${part}` : part;
        next.add(`folder:${accumulated}`);
      }
      if (pageDetail.path === "/docs/graph-api/reference") {
        next.add("reference:index");
      } else if (buildReferenceTreePath(pageDetail.path).leafLabel !== "index") {
        next.add(`page:${pageDetail.id}`);
      }
      if (sections.length > 0) {
        next.add(`page-sections:${pageDetail.id}`);
      }
      if (referenceCollections.length > 0) {
        next.add(`page-collections:${pageDetail.id}`);
      }
      if (nodeDirectory.length > 0) {
        next.add(`page-directory:${pageDetail.id}`);
      }
      return next;
    });
  }, [nodeDirectory.length, pageDetail, referenceCollections.length, sections.length]);

  function handleTreeNodeSelect(node: SidebarTreeNode) {
    if (!node.target) {
      toggleTreeNode(node.id);
      return;
    }

    if (node.target.linkedPageId) {
      setSelectedPageId(node.target.linkedPageId);
      setFocusedTreeTarget(null);
      return;
    }

    if (node.target.pageId !== selectedPageId) {
      setSelectedPageId(node.target.pageId);
    }
    setFocusedTreeTarget(node.target);
  }

  function renderTreeNodes(nodes: SidebarTreeNode[], depth = 0): ReactNode {
    return nodes.map((node) => {
      const isOpen = openTreeNodes.has(node.id);
      const isExpandable = node.children.length > 0;
      const isActive =
        activeFocusedTarget?.id === node.target?.id ||
        (node.target?.kind === "page" && activeFocusedTarget?.pageId === node.target.pageId && activeFocusedTarget.kind === "page");

      return (
        <div key={node.id} className="docs-tree-item">
          <div
            className={`docs-tree-node ${isActive ? "active" : ""} ${node.kind}`}
            style={{ paddingLeft: `${10 + depth * 16}px` }}
          >
            <button
              type="button"
              className={`docs-tree-toggle ${isExpandable ? "" : "spacer"}`}
              onClick={() => {
                if (isExpandable) {
                  toggleTreeNode(node.id);
                }
              }}
              aria-label={isOpen ? "Collapse node" : "Expand node"}
            >
              {isExpandable ? (
                <span className={`docs-tree-chevron ${isOpen ? "open" : ""}`}>▸</span>
              ) : (
                <span className="docs-tree-bullet">•</span>
              )}
            </button>

            <button type="button" className="docs-tree-node-button" onClick={() => handleTreeNodeSelect(node)}>
              <div className="docs-tree-node-main">
                <span className="docs-tree-node-label">{node.label}</span>
                {node.badge ? <span className={`docs-tree-node-badge ${node.badge}`}>{node.badge}</span> : null}
              </div>
              {node.secondary ? <span className="docs-tree-node-secondary">{node.secondary}</span> : null}
            </button>

            {typeof node.count === "number" ? <span className="docs-tree-node-count">{node.count}</span> : null}
          </div>

          {isExpandable && isOpen ? <div className="docs-tree-children">{renderTreeNodes(node.children, depth + 1)}</div> : null}
        </div>
      );
    });
  }

  return (
    <div className="docs-shell">
      <aside className="docs-sidebar-panel docs-sidebar-rail">
        <div className="docs-sidebar-header">
          <span className="docs-sidebar-title">Reference Tree</span>
          <div className="docs-sidebar-actions">
            <span className="docs-sidebar-count">{referencePages.length} refs</span>
            <button
              type="button"
              className="docs-sidebar-action-button"
              onClick={() => void handleCopyTree()}
              disabled={copyingTree || treeNodes.length === 0}
            >
              {copyingTree ? "Copying..." : "Copy Nav"}
            </button>
          </div>
        </div>

        <div className="docs-sidebar-controls">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search references"
          />
        </div>

        <div className="docs-tree">
          {loading ? <p className="docs-empty-state">Loading pages...</p> : null}
          {!loading && treeNodes.length === 0 ? <p className="docs-empty-state">No stored pages yet.</p> : null}
          {!loading ? renderTreeNodes(treeNodes) : null}
        </div>
      </aside>

      <div className="docs-main-column">
        <header className="docs-header">
          <div className="docs-header-copy">
            <p className="docs-eyebrow">Meta Graph Docs</p>
            <h1 className="docs-title">Local docs crawler and explorer</h1>
            <p className="docs-subtitle">
              SQLite-backed crawl store with a local tree, schema browse, and raw source snapshots.
            </p>
          </div>
          <div className="docs-toolbar">
            <select
              className="docs-toolbar-select docs-version-select"
              value={selectedVersion}
              onChange={(event) => setSelectedVersion(event.target.value)}
            >
              <option value="latest">{latestVersion ? `v${latestVersion}` : "Latest"}</option>
              {versionOptions.map((version) => (
                <option key={version} value={version}>
                  {`v${version}`}
                </option>
              ))}
            </select>
            <select
              className="docs-toolbar-select docs-helper-select"
              value={
                pageDetail && !isReferencePath(pageDetail.path) && pageDetail.pageType !== "CHANGELOG_VERSION"
                  ? pageDetail.id
                  : ""
              }
              onChange={(event) => {
                if (event.target.value) {
                  setSelectedPageId(event.target.value);
                }
              }}
            >
              <option value="">Helper Docs</option>
              {helperPages.map((page) => (
                <option key={page.id} value={page.id}>
                  {titleForPage(page)}
                </option>
              ))}
            </select>
            <input
              className="docs-max-pages"
              value={maxPages}
              onChange={(event) => setMaxPages(event.target.value)}
              placeholder="40"
            />
            <button
              className="docs-secondary-button"
              type="button"
              onClick={() => void handleExportTree()}
              disabled={exporting}
            >
              {exporting ? "Exporting..." : "Export Tree"}
            </button>
            <button className="docs-sync-button" type="button" onClick={() => void handleSync()} disabled={syncing}>
              {syncing ? "Syncing..." : "Sync Docs"}
            </button>
          </div>
        </header>

        {error ? <div className="docs-error-banner">{error}</div> : null}
        {notice ? <div className="docs-notice-banner">{notice}</div> : null}

        <main className="docs-detail-panel">
          {pageDetail ? (
            <>
              <div className="docs-detail-header">
                <div>
                  <h2>{titleForPage(pageDetail)}</h2>
                  <p>{pageDetail.path}</p>
                  {cleanedDescription ? <p className="docs-detail-description">{cleanedDescription}</p> : null}
                </div>
                <a href={pageDetail.url} target="_blank" rel="noreferrer" className="docs-open-link">
                  Open Source Page
                </a>
              </div>

              <div className="docs-detail-body">
                <div className="docs-fact-strip">
                  <div className="docs-fact-pill">
                    <span>Type</span>
                    <strong>{pageDetail.pageType}</strong>
                  </div>
                  <div className="docs-fact-pill">
                    <span>Snapshots</span>
                    <strong>{pageDetail.snapshots.length}</strong>
                  </div>
                  <div className="docs-fact-pill">
                    <span>Collections</span>
                    <strong>{referenceCollections.length}</strong>
                  </div>
                  <div className="docs-fact-pill">
                    <span>Updated</span>
                    <strong>{formatDate(pageDetail.updatedAt)}</strong>
                  </div>
                </div>

                <div className="docs-accordion-stack">
                  <AccordionSection
                    id="overview"
                    title="Overview"
                    meta={`${referenceCollections.length} collections · ${sections.length} sections · ${tables.length} tables`}
                    isOpen={openSections.has("overview")}
                    onToggle={toggleSection}
                  >
                    <div className="docs-card-grid docs-accordion-grid">
                      <div className="docs-card">
                        <h3>Page Identity</h3>
                        <dl className="docs-kv-list">
                          <div><dt>Type</dt><dd>{pageDetail.pageType}</dd></div>
                          <div><dt>Stored Path</dt><dd className="docs-kv-value-long docs-mono">{pageDetail.path}</dd></div>
                          <div><dt>Current Source</dt><dd className="docs-kv-value-long"><a href={currentSourceUrl ?? pageDetail.url} target="_blank" rel="noreferrer" className="docs-open-link docs-mono">{currentSourceLabel}</a></dd></div>
                          <div><dt>Canonical</dt><dd className="docs-kv-value-long">{pageDetail.canonicalUrl ? <a href={pageDetail.canonicalUrl} target="_blank" rel="noreferrer" className="docs-open-link docs-mono">{formatSourceLabel(pageDetail.canonicalUrl)}</a> : "Not set"}</dd></div>
                          <div><dt>Updated</dt><dd>{formatDate(pageDetail.updatedAt)}</dd></div>
                        </dl>
                      </div>

                      <div className="docs-card">
                        <h3>Extraction Shape</h3>
                        <dl className="docs-kv-list">
                          <div><dt>Parser</dt><dd>{selectedSnapshot?.parserVersion ?? "Unknown"}</dd></div>
                          <div><dt>Headings</dt><dd>{extracted?.headings.length ?? 0}</dd></div>
                          <div><dt>Sections</dt><dd>{sections.length}</dd></div>
                          <div><dt>Tables</dt><dd>{tables.length}</dd></div>
                          <div><dt>Node Rows</dt><dd>{nodeDirectory.length}</dd></div>
                          <div><dt>Collections</dt><dd>{referenceCollections.length}</dd></div>
                          <div><dt>Discovered URLs</dt><dd>{extracted?.discoveredUrls.length ?? 0}</dd></div>
                        </dl>
                      </div>

                      <div className="docs-card">
                        <h3>Navigation</h3>
                        <dl className="docs-kv-list">
                          <div><dt>Section URLs</dt><dd>{extracted?.sectionUrls?.length ?? sections.length}</dd></div>
                          <div><dt>Outgoing Links</dt><dd>{pageDetail.outgoingLinks.length}</dd></div>
                          <div><dt>Incoming Links</dt><dd>{pageDetail.incomingLinks.length}</dd></div>
                          <div><dt>Has Snapshot</dt><dd>{hasSnapshot(pageDetail) ? "Yes" : "No"}</dd></div>
                        </dl>
                      </div>

                      <div className="docs-card">
                        <h3>Focused Tree Node</h3>
                        {activeFocusedTarget ? (
                          <>
                            <dl className="docs-kv-list">
                              <div><dt>Kind</dt><dd>{activeFocusedTarget.kind}</dd></div>
                              <div><dt>Label</dt><dd>{activeFocusedTarget.label}</dd></div>
                              <div><dt>Path</dt><dd className="docs-kv-value-long docs-mono">{activeFocusedTarget.path ?? pageDetail.path}</dd></div>
                              <div><dt>Source</dt><dd className="docs-kv-value-long">{activeFocusedTarget.sourceUrl ? <a href={activeFocusedTarget.sourceUrl} target="_blank" rel="noreferrer" className="docs-open-link docs-mono">{formatSourceLabel(activeFocusedTarget.sourceUrl)}</a> : "Not set"}</dd></div>
                              {activeFocusedTarget.linkedPageId ? (
                                <div>
                                  <dt>Linked Page</dt>
                                  <dd>
                                    <button
                                      type="button"
                                      className="docs-link-pill"
                                      onClick={() => {
                                        setSelectedPageId(activeFocusedTarget.linkedPageId ?? null);
                                        setFocusedTreeTarget(null);
                                      }}
                                    >
                                      {activeFocusedTarget.linkedPageLabel ?? "Open linked page"}
                                    </button>
                                  </dd>
                                </div>
                              ) : null}
                            </dl>
                            {activeFocusedTarget.detail ? <p className="docs-focused-detail docs-mono">{activeFocusedTarget.detail}</p> : null}
                            {activeFocusedTarget.description ? <p className="docs-focused-detail">{activeFocusedTarget.description}</p> : null}
                          </>
                        ) : (
                          <p className="docs-empty-state">Select a tree node to inspect its source location.</p>
                        )}
                      </div>

                      <div className="docs-card docs-card-wide">
                        <h3>Intro</h3>
                        {introParagraphs.length > 0 ? (
                          <div className="docs-prose">
                            {introParagraphs.map((paragraph) => (
                              <p key={paragraph}>{paragraph}</p>
                            ))}
                          </div>
                        ) : (
                          <p className="docs-empty-state">No intro paragraphs extracted yet.</p>
                        )}
                      </div>
                    </div>
                  </AccordionSection>

                  <AccordionSection
                    id="map"
                    title="Node Map"
                    meta={`${referenceCollections.reduce((sum, collection) => sum + collection.entries.length, 0)} child entries · ${filteredNodeDirectory.length} directory rows`}
                    isOpen={openSections.has("map")}
                    onToggle={toggleSection}
                  >
                    <div className="docs-card-grid docs-accordion-grid">
                      <div className="docs-card docs-card-wide">
                        <div className="docs-card-header">
                          <div>
                            <h3>Current Node</h3>
                            <p>This page is the parent node. Collections below describe its children and related surfaces.</p>
                          </div>
                        </div>
                        <div className="docs-root-node">
                          <strong>{titleForPage(pageDetail)}</strong>
                          <span className="docs-mono">{pageDetail.path}</span>
                          <a href={currentSourceUrl ?? pageDetail.url} target="_blank" rel="noreferrer" className="docs-open-link docs-mono">
                            {currentSourceLabel}
                          </a>
                        </div>
                      </div>

                      {referenceCollections.length > 0 ? (
                        <div className="docs-card docs-card-wide">
                          <div className="docs-card-header">
                            <div>
                              <h3>Reference Collections</h3>
                              <p>Field, edge, parameter, and error tables grouped by the source section they came from.</p>
                            </div>
                          </div>
                          <div className="docs-reference-stack">
                            {referenceCollections.map((collection) => (
                              <section key={`${collection.key}-${collection.sourceUrl}`} className="docs-reference-card">
                                <div className="docs-reference-card-header">
                                  <div>
                                    <strong>{collection.label}</strong>
                                    <p>{collection.entries.length} entries</p>
                                  </div>
                                  <a href={collection.sourceUrl} target="_blank" rel="noreferrer" className="docs-open-link docs-mono">
                                    {formatSourceLabel(collection.sourceUrl)}
                                  </a>
                                </div>
                                <div className="docs-data-table-wrap">
                                  <table className="docs-data-table">
                                    <thead>
                                      <tr>
                                        <th>{collection.label.slice(0, -1) || "Entry"}</th>
                                        <th>Detail</th>
                                        <th>Description</th>
                                        <th>Navigate</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {collection.entries.map((entry) => {
                                        const linkedPage = entry.normalizedUrl ? storedPageByUrl.get(entry.normalizedUrl) ?? null : null;
                                        return (
                                          <tr key={`${collection.key}-${entry.name}-${entry.normalizedUrl ?? entry.description}`}>
                                            <td>
                                              <div className="docs-node-cell">
                                                <strong>{entry.name}</strong>
                                                {entry.sectionHeading ? <span className="docs-node-slug">{entry.sectionHeading}</span> : null}
                                              </div>
                                            </td>
                                            <td>{entry.detail ? <span className="docs-mono">{entry.detail}</span> : "—"}</td>
                                            <td>{entry.description || "No description extracted."}</td>
                                            <td>
                                              <div className="docs-table-actions">
                                                {linkedPage ? (
                                                  <button
                                                    type="button"
                                                    className="docs-link-pill"
                                                    onClick={() => setSelectedPageId(linkedPage.id)}
                                                  >
                                                    {linkedPage._count.snapshots > 0 ? "Open stored page" : "Open discovered page"}
                                                  </button>
                                                ) : null}
                                                <a href={entry.sourceUrl} target="_blank" rel="noreferrer" className="docs-open-link docs-mono">
                                                  {formatSourceLabel(entry.sourceUrl)}
                                                </a>
                                              </div>
                                            </td>
                                          </tr>
                                        );
                                      })}
                                    </tbody>
                                  </table>
                                </div>
                              </section>
                            ))}
                          </div>
                        </div>
                      ) : null}

                      <div className="docs-card docs-card-wide">
                        <div className="docs-card-header">
                          <div>
                            <h3>Reference Index Rows</h3>
                            <p>Structured node rows extracted from top-level index tables.</p>
                          </div>
                          <input
                            className="docs-inline-search"
                            value={directoryQuery}
                            onChange={(event) => setDirectoryQuery(event.target.value)}
                            placeholder="Filter nodes or descriptions"
                          />
                        </div>

                        {filteredNodeDirectory.length > 0 ? (
                          <div className="docs-data-table-wrap">
                            <table className="docs-data-table">
                              <thead>
                                <tr>
                                  <th>Node</th>
                                  <th>Description</th>
                                  <th>Target</th>
                                  <th>Source</th>
                                </tr>
                              </thead>
                              <tbody>
                                {filteredNodeDirectory.map((entry) => {
                                  const linkedPage = entry.normalizedUrl ? storedPageByUrl.get(entry.normalizedUrl) ?? null : null;
                                  return (
                                    <tr key={`${entry.label}-${entry.normalizedUrl ?? entry.href ?? entry.description}`}>
                                      <td>
                                        <div className="docs-node-cell">
                                          <strong>{entry.label}</strong>
                                          {entry.slug ? <span className="docs-node-slug">{entry.slug}</span> : null}
                                        </div>
                                      </td>
                                      <td>{entry.description || "No description extracted."}</td>
                                      <td>
                                        <div className="docs-table-actions">
                                          {linkedPage ? (
                                            <button
                                              type="button"
                                              className="docs-link-pill"
                                              onClick={() => setSelectedPageId(linkedPage.id)}
                                            >
                                              {linkedPage._count.snapshots > 0 ? "Open stored page" : "Open discovered page"}
                                            </button>
                                          ) : null}
                                          {entry.normalizedUrl ? (
                                            <a href={entry.normalizedUrl} target="_blank" rel="noreferrer" className="docs-open-link docs-mono">
                                              {formatSourceLabel(entry.normalizedUrl)}
                                            </a>
                                          ) : (
                                            <span className="docs-empty-state">No target</span>
                                          )}
                                        </div>
                                      </td>
                                      <td>
                                        {entry.sourceUrl || currentSourceUrl ? (
                                          <a
                                            href={entry.sourceUrl ?? currentSourceUrl ?? pageDetail.url}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="docs-open-link docs-mono"
                                          >
                                            {formatSourceLabel(entry.sourceUrl ?? currentSourceUrl)}
                                          </a>
                                        ) : (
                                          "—"
                                        )}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <p className="docs-empty-state">No node directory rows extracted for this page.</p>
                        )}
                      </div>
                    </div>
                  </AccordionSection>

                  <AccordionSection
                    id="outline"
                    title="Outline"
                    meta={`${sections.length || extracted?.headings.length || 0} headings`}
                    isOpen={openSections.has("outline")}
                    onToggle={toggleSection}
                  >
                    <div className="docs-card-grid docs-accordion-grid">
                      <div className="docs-card">
                        <h3>Section Outline</h3>
                        {sections.length > 0 ? (
                          <div className="docs-section-list">
                            {sections.map((section) => (
                              <div key={`${section.level}-${section.heading}-${section.anchor ?? ""}`} className="docs-section-item">
                                <div className="docs-section-heading-row">
                                  <div className="docs-section-heading-row docs-section-heading-main">
                                    <span className="docs-section-level">H{section.level}</span>
                                    <strong>{section.heading}</strong>
                                  </div>
                                  {section.sourceUrl ? (
                                    <a href={section.sourceUrl} target="_blank" rel="noreferrer" className="docs-open-link docs-mono">
                                      {formatSourceLabel(section.sourceUrl)}
                                    </a>
                                  ) : null}
                                </div>
                                {section.paragraphs[0] ? <p>{truncateText(section.paragraphs[0], 220)}</p> : null}
                              </div>
                            ))}
                          </div>
                        ) : extracted?.headings.length ? (
                          <div className="docs-chip-list">
                            {extracted.headings.map((heading) => (
                              <span key={heading} className="docs-chip">{heading}</span>
                            ))}
                          </div>
                        ) : (
                          <p className="docs-empty-state">No section outline extracted yet.</p>
                        )}
                      </div>

                      <div className="docs-card">
                        <h3>Structured Tables</h3>
                        {tables.length > 0 ? (
                          <div className="docs-table-stack">
                            {tables.slice(0, 6).map((table, index) => (
                              <section key={`${table.caption ?? "table"}-${table.sourceUrl ?? index}`} className="docs-table-preview">
                                <div className="docs-table-preview-header">
                                  <div>
                                    <strong>{table.caption ?? table.sectionHeading ?? `Table ${index + 1}`}</strong>
                                    <span>{table.rows.length} rows</span>
                                  </div>
                                  {table.sourceUrl ? (
                                    <a href={table.sourceUrl} target="_blank" rel="noreferrer" className="docs-open-link docs-mono">
                                      {formatSourceLabel(table.sourceUrl)}
                                    </a>
                                  ) : null}
                                </div>
                                {table.headers.length > 0 ? (
                                  <div className="docs-chip-list">
                                    {table.headers.map((header) => (
                                      <span key={`${index}-${header}`} className="docs-chip">{header}</span>
                                    ))}
                                  </div>
                                ) : null}
                                <div className="docs-table-preview-rows">
                                  {table.rows.slice(0, 5).map((row, rowIndex) => (
                                    <div key={`${index}-${rowIndex}`} className="docs-table-preview-row">
                                      {row.cells.map((cell, cellIndex) => (
                                        <span key={`${index}-${rowIndex}-${cellIndex}`}>{cell || "—"}</span>
                                      ))}
                                    </div>
                                  ))}
                                </div>
                              </section>
                            ))}
                          </div>
                        ) : (
                          <p className="docs-empty-state">No structured tables extracted yet.</p>
                        )}
                      </div>
                    </div>
                  </AccordionSection>

                  <AccordionSection
                    id="links"
                    title="Link Graph"
                    meta={`${pageDetail.outgoingLinks.length} outgoing · ${pageDetail.incomingLinks.length} incoming`}
                    isOpen={openSections.has("links")}
                    onToggle={toggleSection}
                  >
                    <div className="docs-card-grid docs-accordion-grid">
                      <div className="docs-card">
                        <h3>Children / Directed Links</h3>
                        <div className="docs-link-list">
                          {outgoingChildren.length > 0 ? (
                            outgoingChildren.map((link) => (
                              <button
                                key={link.id}
                                type="button"
                                className="docs-link-row"
                                onClick={() => {
                                  if (link.toPage) {
                                    setSelectedPageId(link.toPage.id);
                                  }
                                }}
                              >
                                <strong>{link.toPage ? titleForPage(link.toPage) : link.targetUrl}</strong>
                                <span>{link.relationType}</span>
                                <small>{link.toPage?.path ?? formatSourceLabel(link.targetUrl)}</small>
                              </button>
                            ))
                          ) : (
                            <p className="docs-empty-state">No discovered child links on this page yet.</p>
                          )}
                        </div>
                      </div>

                      <div className="docs-card">
                        <h3>Related / Cross Links</h3>
                        <div className="docs-link-list">
                          {outgoingRelated.length > 0 ? (
                            outgoingRelated.map((link) => (
                              <button
                                key={link.id}
                                type="button"
                                className="docs-link-row"
                                onClick={() => {
                                  if (link.toPage) {
                                    setSelectedPageId(link.toPage.id);
                                  }
                                }}
                              >
                                <strong>{link.toPage ? titleForPage(link.toPage) : link.targetUrl}</strong>
                                <span>{link.relationType}</span>
                                <small>{link.toPage?.path ?? formatSourceLabel(link.targetUrl)}</small>
                              </button>
                            ))
                          ) : (
                            <p className="docs-empty-state">No related links captured yet.</p>
                          )}
                        </div>
                      </div>

                      <div className="docs-card docs-card-wide">
                        <h3>Incoming References</h3>
                        <div className="docs-link-list">
                          {pageDetail.incomingLinks.length > 0 ? (
                            pageDetail.incomingLinks.map((link) => (
                              <button
                                key={link.id}
                                type="button"
                                className="docs-link-row"
                                onClick={() => setSelectedPageId(link.fromPage.id)}
                              >
                                <strong>{titleForPage(link.fromPage)}</strong>
                                <span>{link.relationType}</span>
                                <small>{link.fromPage.path}</small>
                              </button>
                            ))
                          ) : (
                            <p className="docs-empty-state">No incoming references yet.</p>
                          )}
                        </div>
                      </div>
                    </div>
                  </AccordionSection>

                  <AccordionSection
                    id="history"
                    title="Snapshot History"
                    meta={`${pageDetail.snapshots.length} snapshots · ${pageDetail.changes.length} changes`}
                    isOpen={openSections.has("history")}
                    onToggle={toggleSection}
                  >
                    <div className="docs-card-grid docs-accordion-grid">
                      <div className="docs-card">
                        <h3>Snapshots</h3>
                        <div className="docs-snapshot-list">
                          {pageDetail.snapshots.map((snapshot) => (
                            <button
                              key={snapshot.id}
                              type="button"
                              className={`docs-snapshot-row ${selectedSnapshot?.id === snapshot.id ? "active" : ""}`}
                              onClick={() => void loadSnapshot(snapshot.id)}
                            >
                              <strong>{formatDate(snapshot.fetchedAt)}</strong>
                              <span>{snapshot.fetchMode} · {snapshot.httpStatus}</span>
                              <small>{snapshot.parserVersion} · {shortHash(snapshot.contentHash)}</small>
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="docs-card">
                        <h3>Change Log</h3>
                        <div className="docs-mini-list">
                          {pageDetail.changes.length > 0 ? (
                            pageDetail.changes.map((change) => (
                              <div key={change.id} className="docs-mini-row">
                                <strong>{formatDate(change.createdAt)}</strong>
                                <span>Snapshot changed</span>
                              </div>
                            ))
                          ) : (
                            <p className="docs-empty-state">No recorded content hash changes yet.</p>
                          )}
                        </div>
                      </div>
                    </div>
                  </AccordionSection>

                  <AccordionSection
                    id="activity"
                    title="Recent Activity"
                    meta={`${overview?.recentRuns.length ?? 0} runs · ${overview?.recentChanges.length ?? 0} changes`}
                    isOpen={openSections.has("activity")}
                    onToggle={toggleSection}
                  >
                    <div className="docs-card-grid docs-accordion-grid">
                      <div className="docs-card">
                        <h3>Recent Sync Runs</h3>
                        <div className="docs-mini-list">
                          {overview && overview.recentRuns.length > 0 ? (
                            overview.recentRuns.map((run) => (
                              <div key={run.id} className="docs-mini-row">
                                <strong>{run.status}</strong>
                                <span>{run.pagesFetched} fetched · {run.pagesChanged} changed · {run.pagesDiscovered} discovered</span>
                                <small>{formatDate(run.createdAt)}</small>
                              </div>
                            ))
                          ) : (
                            <p className="docs-empty-state">No runs yet.</p>
                          )}
                        </div>
                      </div>

                      <div className="docs-card">
                        <h3>Recent Changes</h3>
                        <div className="docs-mini-list">
                          {overview && overview.recentChanges.length > 0 ? (
                            overview.recentChanges.map((change) => (
                              <button
                                key={change.id}
                                type="button"
                                className="docs-mini-row docs-mini-button"
                                onClick={() => setSelectedPageId(change.page.id)}
                              >
                                <strong>{titleForPage(change.page)}</strong>
                                <span>{change.page.path}</span>
                                <small>{formatDate(change.createdAt)}</small>
                              </button>
                            ))
                          ) : (
                            <p className="docs-empty-state">No changes yet.</p>
                          )}
                        </div>
                      </div>
                    </div>
                  </AccordionSection>

                  <AccordionSection
                    id="raw"
                    title="Raw Snapshot"
                    meta={selectedSnapshot ? `${selectedSnapshot.fetchMode} · ${shortHash(selectedSnapshot.contentHash)}` : undefined}
                    isOpen={openSections.has("raw")}
                    onToggle={toggleSection}
                  >
                    <div className="docs-card-grid docs-accordion-grid">
                      <div className="docs-card">
                        <h3>Raw Text Preview</h3>
                        <pre>{selectedSnapshot?.rawText ?? extracted?.textPreview ?? "No snapshot selected."}</pre>
                      </div>

                      <div className="docs-card">
                        <h3>Extracted Payload</h3>
                        <pre>{JSON.stringify(selectedSnapshot?.extractedData ?? {}, null, 2)}</pre>
                      </div>

                      <div className="docs-card docs-card-wide docs-raw-card">
                        <div className="docs-raw-meta">
                          <span>{selectedSnapshot?.responseUrl ?? pageDetail.url}</span>
                          <span>{selectedSnapshot?.fetchMode ?? "DEFAULT"}</span>
                        </div>
                        <pre>{selectedSnapshot?.rawHtml ?? "No snapshot selected."}</pre>
                      </div>
                    </div>
                  </AccordionSection>
                </div>
              </div>
            </>
          ) : (
            <div className="docs-empty-state docs-empty-detail">
              <strong>No doc selected</strong>
              <span>Run a sync and pick a page to inspect nodes, sections, snapshots, raw HTML, and discovered links.</span>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
