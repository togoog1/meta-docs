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

interface GroupedReferenceCollection {
  key: string;
  label: string;
  sourceUrls: string[];
  sectionHeadings: string[];
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

interface ImportMissingResult {
  run: {
    id: string;
    status: string;
    pagesFetched: number;
    pagesChanged: number;
    pagesDiscovered: number;
    finishedAt: string | null;
  };
  remainingPages: number;
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
  "collections",
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

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#(\d+);/gu, (_match, code) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&#x([0-9a-f]+);/giu, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&quot;/gu, "\"")
    .replace(/&apos;|&#39;/gu, "'")
    .replace(/&amp;/gu, "&")
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&nbsp;/gu, " ");
}

function normalizeDisplayText(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  return decodeHtmlEntities(value)
    .replace(/\s+/gu, " ")
    .trim();
}

function cleanDocTitle(value: string | null | undefined): string | null {
  const normalized = normalizeDisplayText(value);
  if (!normalized) {
    return null;
  }

  return normalized
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
  const normalized = normalizeDisplayText(value);
  if (!normalized) {
    return null;
  }
  const cleaned = cleanDocTitle(normalized) ?? normalized;
  if (cleaned.length <= maxLength) {
    return cleaned;
  }
  return `${cleaned.slice(0, maxLength - 1)}…`;
}

function getPathIdentifier(url: string | null | undefined): string | null {
  if (!url) {
    return null;
  }

  try {
    const parsed = new URL(url);
    return parsed.pathname.split("/").filter(Boolean).at(-1) ?? null;
  } catch {
    return url.split("/").filter(Boolean).at(-1) ?? null;
  }
}

function referenceEntryDisplayName(entry: ExtractedReferenceEntry): string {
  return normalizeDisplayText(entry.name) ?? entry.name;
}

function referenceEntryDisplayDescription(entry: ExtractedReferenceEntry): string | null {
  const description = normalizeDisplayText(entry.description);
  const displayName = normalizeDisplayText(referenceEntryDisplayName(entry));
  const detail = normalizeDisplayText(entry.detail);

  if (!description) {
    return null;
  }

  if (displayName && description.localeCompare(displayName, undefined, { sensitivity: "base" }) === 0) {
    return null;
  }

  if (detail && description.localeCompare(detail, undefined, { sensitivity: "base" }) === 0) {
    return null;
  }

  return description;
}

function nodeDirectoryDisplayName(entry: ExtractedNodeDirectoryEntry): string {
  return (
    normalizeDisplayText(entry.slug) ??
    normalizeDisplayText(getPathIdentifier(entry.normalizedUrl ?? entry.href)) ??
    normalizeDisplayText(entry.label) ??
    "unknown"
  );
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
      const sectionHint = (table.sectionHeading ?? "").toLowerCase();
      const collectionMeta =
        (firstHeader === "field" || firstHeader === "field name") && secondHeader === "description"
          ? { key: "fields", label: "Fields" }
          : firstHeader === "edge" && secondHeader === "description"
            ? { key: "edges", label: "Edges" }
            : firstHeader === "parameter" && secondHeader === "description"
              ? { key: "parameters", label: "Parameters" }
              : firstHeader === "error" && secondHeader === "description"
                ? { key: "errors", label: "Errors" }
                : (firstHeader === "property name" || firstHeader === "name") && secondHeader === "description"
                  ? sectionHint.includes("edge")
                    ? { key: "edges", label: "Edges" }
                    : sectionHint.includes("parameter")
                      ? { key: "parameters", label: "Parameters" }
                      : sectionHint.includes("error")
                        ? { key: "errors", label: "Errors" }
                        : { key: "fields", label: "Fields" }
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

  const [directoryQuery, setDirectoryQuery] = useState("");
  const [collectionQuery, setCollectionQuery] = useState("");
  const [activeCollectionKey, setActiveCollectionKey] = useState<string | null>(null);
  const [openTreeNodes, setOpenTreeNodes] = useState<Set<string>>(new Set(defaultOpenTreeNodes));
  const [openSections, setOpenSections] = useState<Set<string>>(new Set(defaultOpenSections));
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [importingMissing, setImportingMissing] = useState(false);

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
      setCollectionQuery("");
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

  async function handleFetchPage(pageId: string) {
    setFetching(true);
    try {
      await requestJson(`/api/docs/pages/${pageId}/fetch`, {
        method: "POST",
        body: "{}"
      });
      await loadPageDetail(pageId);
      await loadPages();
      setError(null);
      setNotice(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to fetch page");
    } finally {
      setFetching(false);
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

  async function handleImportMissingPages() {
    setImportingMissing(true);
    try {
      const result = await requestJson<ImportMissingResult>("/api/docs/import-missing", {
        method: "POST",
        body: JSON.stringify({
          referenceOnly: true,
          version: selectedVersion
        })
      });

      await loadOverview();
      await loadPages();
      if (selectedPageId) {
        await loadPageDetail(selectedPageId);
      }

      setNotice(
        result.remainingPages > 0
          ? `Imported ${result.run.pagesFetched} missing pages. ${result.remainingPages} still missing.`
          : `Imported ${result.run.pagesFetched} missing pages. Reference scope is fully fetched.`
      );
      setError(null);
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : "Failed to import missing pages";
      setError(
        message === "Not Found"
          ? "Import Missing API route is not loaded. Restart the API server so the new backend route is available."
          : message
      );
      setNotice(null);
    } finally {
      setImportingMissing(false);
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
  const groupedReferenceCollections = useMemo(() => {
    const groups = new Map<string, GroupedReferenceCollection>();
    const order = ["fields", "edges", "parameters", "errors"];

    for (const collection of referenceCollections) {
      const existing =
        groups.get(collection.key) ??
        {
          key: collection.key,
          label: collection.label,
          sourceUrls: [],
          sectionHeadings: [],
          entries: []
        };

      const existingEntryKeys = new Set(
        existing.entries.map((entry) =>
          [
            entry.name,
            entry.detail ?? "",
            entry.description ?? "",
            entry.sourceUrl,
            entry.normalizedUrl ?? ""
          ].join("::")
        )
      );

      if (!existing.sourceUrls.includes(collection.sourceUrl)) {
        existing.sourceUrls.push(collection.sourceUrl);
      }

      for (const entry of collection.entries) {
        if (entry.sectionHeading && !existing.sectionHeadings.includes(entry.sectionHeading)) {
          existing.sectionHeadings.push(entry.sectionHeading);
        }

        const dedupeKey = [
          entry.name,
          entry.detail ?? "",
          entry.description ?? "",
          entry.sourceUrl,
          entry.normalizedUrl ?? ""
        ].join("::");

        if (existingEntryKeys.has(dedupeKey)) {
          continue;
        }

        existing.entries.push(entry);
        existingEntryKeys.add(dedupeKey);
      }

      groups.set(collection.key, existing);
    }

    return [...groups.values()].sort((left, right) => {
      const leftIndex = order.indexOf(left.key);
      const rightIndex = order.indexOf(right.key);
      if (leftIndex !== -1 || rightIndex !== -1) {
        if (leftIndex === -1) {
          return 1;
        }
        if (rightIndex === -1) {
          return -1;
        }
        return leftIndex - rightIndex;
      }
      return left.label.localeCompare(right.label, undefined, { sensitivity: "base" });
    });
  }, [referenceCollections]);
  const activeReferenceCollection =
    groupedReferenceCollections.find((collection) => collection.key === activeCollectionKey) ??
    groupedReferenceCollections[0] ??
    null;
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

  const filteredCollectionEntries = useMemo(() => {
    if (!activeReferenceCollection) {
      return [];
    }

    const lookup = collectionQuery.trim().toLowerCase();
    if (!lookup) {
      return activeReferenceCollection.entries;
    }

    return activeReferenceCollection.entries.filter((entry) =>
      `${entry.name} ${entry.detail ?? ""} ${entry.description} ${entry.sectionHeading ?? ""} ${entry.sourceUrl}`.toLowerCase().includes(lookup)
    );
  }, [activeReferenceCollection, collectionQuery]);

  useEffect(() => {
    if (groupedReferenceCollections.length === 0) {
      setActiveCollectionKey(null);
      return;
    }

    setActiveCollectionKey((current) =>
      current && groupedReferenceCollections.some((collection) => collection.key === current)
        ? current
        : groupedReferenceCollections[0]?.key ?? null
    );
  }, [groupedReferenceCollections]);

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
      badge: referenceIndexPage && referenceIndexPage._count.snapshots === 0 ? "discovered" : null,
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
        folder.badge = page._count.snapshots === 0 ? "discovered" : null;
        folder.count = page._count.outgoingLinks;
        folder.target = makePageTarget(page, titleForPage(page), page.url, pageDescription);
        continue;
      }

      siblings.push({
        id: `page:${page.id}`,
        kind: "page",
        label: humanizeSegment(leafLabel),
        secondary: page.title && page.title !== leafLabel ? page.title : pageDescription,
        badge: page._count.snapshots === 0 ? "discovered" : null,
        count: page._count.outgoingLinks,
        children: [],
        target: makePageTarget(page, titleForPage(page), page.url, pageDescription)
      });
    }

    return rootNodes;
  }, [referencePages, selectedPageId, storedPageByUrl]);

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
      return next;
    });
  }, [pageDetail]);

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
                {node.badge ? <span className={`docs-tree-node-badge ${node.badge}`}>D</span> : null}
              </div>
              {node.secondary ? <span className="docs-tree-node-secondary">{node.secondary}</span> : null}
            </button>

            {typeof node.count === "number" && node.count > 0 ? <span className="docs-tree-node-count">{node.count}</span> : null}
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
            <button
              className="docs-secondary-button"
              type="button"
              onClick={() => void handleImportMissingPages()}
              disabled={importingMissing}
            >
              {importingMissing ? "Importing..." : "Import Missing"}
            </button>
            <button
              className="docs-secondary-button"
              type="button"
              onClick={() => void handleExportTree()}
              disabled={exporting}
            >
              {exporting ? "Exporting..." : "Export Tree"}
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
                {introParagraphs.length > 0 && introParagraphs.join(" ") !== (cleanedDescription ?? "") ? (
                  <div className="docs-intro-paragraphs">
                    {introParagraphs.map((paragraph) => (
                      <p key={paragraph}>{paragraph}</p>
                    ))}
                  </div>
                ) : null}
                </div>
                <div className="docs-detail-actions">
                  {!hasSnapshot(pageDetail) ? (
                    <button
                      type="button"
                      className="docs-fetch-button"
                      onClick={() => void handleFetchPage(pageDetail.id)}
                      disabled={fetching}
                    >
                      {fetching ? "Fetching..." : "Fetch Docs"}
                    </button>
                  ) : null}
                  <a href={pageDetail.url} target="_blank" rel="noreferrer" className="docs-open-link">
                    Open Source Page
                  </a>
                </div>
              </div>

              <div className="docs-detail-body">
                <div className="docs-fact-strip">
                  <div className="docs-fact-pill">
                    <span>Type</span>
                    <strong>{pageDetail.pageType}</strong>
                  </div>
                  <div className="docs-fact-pill">
                    <span>Updated</span>
                    <strong>{formatDate(pageDetail.updatedAt)}</strong>
                  </div>
                </div>

                <div className="docs-accordion-stack">
                  <AccordionSection
                    id="collections"
                    title="Reference Collections"
                    meta={`${referenceCollections.reduce((sum, collection) => sum + collection.entries.length, 0)} entries · ${filteredNodeDirectory.length} directory rows`}
                    isOpen={openSections.has("collections")}
                    onToggle={toggleSection}
                  >
                    <div className="docs-card-grid docs-accordion-grid">
                      {groupedReferenceCollections.length > 0 ? (
                        <div className="docs-card docs-card-wide">
                          <div className="docs-reference-toolbar">
                            <div className="docs-reference-tabs" role="tablist" aria-label="Reference collections">
                              {groupedReferenceCollections.map((collection) => (
                                <button
                                  key={collection.key}
                                  type="button"
                                  role="tab"
                                  aria-selected={activeReferenceCollection?.key === collection.key}
                                  className={`docs-reference-tab ${activeReferenceCollection?.key === collection.key ? "active" : ""}`}
                                  onClick={() => setActiveCollectionKey(collection.key)}
                                >
                                  <strong>{collection.label}</strong>
                                  <span>{collection.entries.length}</span>
                                </button>
                              ))}
                            </div>
                            <input
                              className="docs-inline-search"
                              value={collectionQuery}
                              onChange={(event) => setCollectionQuery(event.target.value)}
                              placeholder={`Filter ${activeReferenceCollection?.label.toLowerCase() ?? "collection"} entries`}
                            />
                          </div>

                          {activeReferenceCollection ? (
                            <section className="docs-reference-card">
                              <div className="docs-reference-card-header">
                                <div>
                                  <strong>{activeReferenceCollection.label}</strong>
                                  <p>
                                    {filteredCollectionEntries.length === activeReferenceCollection.entries.length
                                      ? `${activeReferenceCollection.entries.length} entries`
                                      : `${filteredCollectionEntries.length} of ${activeReferenceCollection.entries.length} entries`}
                                    {activeReferenceCollection.sectionHeadings.length > 0
                                      ? ` · ${activeReferenceCollection.sectionHeadings.length} sections`
                                      : ""}
                                  </p>
                                </div>
                                <div className="docs-table-actions">
                                  {activeReferenceCollection.sourceUrls.slice(0, 3).map((sourceUrl) => (
                                    <a
                                      key={sourceUrl}
                                      href={sourceUrl}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="docs-open-link docs-mono"
                                    >
                                      {formatSourceLabel(sourceUrl)}
                                    </a>
                                  ))}
                                </div>
                              </div>

                              {filteredCollectionEntries.length > 0 ? (
                                <div className="docs-reference-list">
                                  {filteredCollectionEntries.map((entry) => {
                                    const linkedPage = entry.normalizedUrl ? storedPageByUrl.get(entry.normalizedUrl) ?? null : null;
                                    const entryDescription = referenceEntryDisplayDescription(entry);
                                    return (
                                      <article
                                        key={`${activeReferenceCollection.key}-${entry.name}-${entry.normalizedUrl ?? entry.description}`}
                                        className="docs-reference-entry"
                                      >
                                        <div className="docs-reference-entry-main">
                                          <div className="docs-reference-entry-heading">
                                            <strong className="docs-mono">{referenceEntryDisplayName(entry)}</strong>
                                            {entry.detail ? <span className="docs-reference-entry-detail docs-mono">{truncateText(entry.detail, 64)}</span> : null}
                                          </div>
                                          {entryDescription ? (
                                            <p className="docs-reference-entry-description" title={entryDescription}>
                                              {truncateText(entryDescription, 140)}
                                            </p>
                                          ) : null}
                                        </div>
                                        <div className="docs-reference-entry-meta">
                                          {entry.sectionHeading ? (
                                            <span className="docs-outline-tag">{entry.sectionHeading}</span>
                                          ) : null}
                                          {entry.sourceUrl ? (
                                            <a href={entry.sourceUrl} target="_blank" rel="noreferrer" className="docs-open-link docs-mono">
                                              {formatSourceLabel(entry.sourceUrl)}
                                            </a>
                                          ) : null}
                                          {linkedPage ? (
                                            <button
                                              type="button"
                                              className="docs-link-pill"
                                              onClick={() => setSelectedPageId(linkedPage.id)}
                                            >
                                              Open
                                            </button>
                                          ) : entry.normalizedUrl ? (
                                            <a href={entry.normalizedUrl} target="_blank" rel="noreferrer" className="docs-link-pill docs-mono">
                                              Target
                                            </a>
                                          ) : null}
                                        </div>
                                      </article>
                                    );
                                  })}
                                </div>
                              ) : (
                                <p className="docs-empty-state">No matching entries in this collection.</p>
                              )}
                            </section>
                          ) : null}
                        </div>
                      ) : (
                        <div className="docs-card docs-card-wide">
                          <div className="docs-card-header">
                            <div>
                              <h3>Reference Collections</h3>
                              <p>No field, edge, parameter, or error tables were extracted for this page yet.</p>
                            </div>
                          </div>
                        </div>
                      )}

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
                                </tr>
                              </thead>
                              <tbody>
                                {filteredNodeDirectory.map((entry) => {
                                  const linkedPage = entry.normalizedUrl ? storedPageByUrl.get(entry.normalizedUrl) ?? null : null;
                                  return (
                                    <tr key={`${entry.label}-${entry.normalizedUrl ?? entry.href ?? entry.description}`}>
                                      <td>
                                        <div className="docs-node-cell">
                                          <strong className="docs-mono">{nodeDirectoryDisplayName(entry)}</strong>
                                        </div>
                                      </td>
                                      <td className="docs-data-table-description" title={normalizeDisplayText(entry.description) ?? undefined}>
                                        {truncateText(entry.description, 110) || "No description extracted."}
                                      </td>
                                      <td>
                                        {linkedPage ? (
                                          <button
                                            type="button"
                                            className="docs-link-pill"
                                            onClick={() => setSelectedPageId(linkedPage.id)}
                                          >
                                            Open
                                          </button>
                                        ) : entry.normalizedUrl ? (
                                          <a href={entry.normalizedUrl} target="_blank" rel="noreferrer" className="docs-open-link docs-mono">
                                            Source
                                          </a>
                                        ) : "—"}
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
                      <div className="docs-card docs-card-wide">
                        {sections.length > 0 ? (
                          <div className="docs-outline">
                            {(() => {
                              const groups: { heading: typeof sections[0] | null; children: typeof sections }[] = [];
                              for (const section of sections) {
                                if (section.level <= 2) {
                                  groups.push({ heading: section, children: [] });
                                } else if (groups.length > 0) {
                                  groups.at(-1)!.children.push(section);
                                } else {
                                  groups.push({ heading: null, children: [section] });
                                }
                              }
                              return groups
                                .filter((group) => {
                                  if (group.heading) return true;
                                  return group.children.some((s) => s.paragraphs[0]);
                                })
                                .map((group, groupIndex) => {
                                  const withContent = group.children.filter((s) => s.paragraphs[0]);
                                  const withoutContentNames = [...new Set(
                                    group.children.filter((s) => !s.paragraphs[0]).map((s) => s.heading)
                                  )];
                                  return (
                                    <div key={group.heading?.anchor ?? group.heading?.heading ?? groupIndex} className="docs-outline-group">
                                      {group.heading ? (
                                        <>
                                          <div className="docs-outline-h2">
                                            <strong>{group.heading.heading}</strong>
                                          </div>
                                          {group.heading.paragraphs[0] ? <p className="docs-outline-text">{truncateText(group.heading.paragraphs[0], 220)}</p> : null}
                                        </>
                                      ) : null}
                                      {withContent.map((s, i) => (
                                        <div key={`${s.heading}-${s.anchor ?? i}`} className="docs-outline-detail">
                                          <span className="docs-outline-label">{s.heading}</span>
                                          <span className="docs-outline-text">{truncateText(s.paragraphs[0], 180)}</span>
                                        </div>
                                      ))}
                                      {withoutContentNames.length > 0 ? (
                                        <div className="docs-outline-tags">
                                          {withoutContentNames.map((name) => (
                                            <span key={name} className="docs-outline-tag">{name}</span>
                                          ))}
                                        </div>
                                      ) : null}
                                    </div>
                                  );
                                });
                            })()}
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
                    id="debug"
                    title="History & Debug"
                    meta={`${pageDetail.snapshots.length} snapshots · ${pageDetail.changes.length} changes`}
                    isOpen={openSections.has("debug")}
                    onToggle={toggleSection}
                  >
                    <div className="docs-card-grid docs-accordion-grid">
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
