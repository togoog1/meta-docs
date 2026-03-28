import { createHash } from "node:crypto";

import { DocFetchMode, DocPageType, DocRelationType } from "../../generated/prisma/client.js";
import { docSourceDefinition } from "./source.js";

const parserVersion = "meta-graph-docs-parser-v3";

interface HeadingMarker {
  index: number;
  heading: string;
  level: number;
  anchor: string | null;
}

function trimTrailingSlash(pathname: string): string {
  if (pathname.length <= 1) {
    return pathname;
  }
  return pathname.replace(/\/+$/u, "");
}

function decodeHtml(text: string): string {
  return text
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", "\"")
    .replaceAll("&#039;", "'")
    .replaceAll("&nbsp;", " ");
}

function stripTags(html: string): string {
  return decodeHtml(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, " ")
      .replace(/<[^>]+>/gu, " ")
      .replace(/\s+/gu, " ")
      .trim()
  );
}

function normalizeWhitespace(text: string): string {
  return decodeHtml(text).replace(/\s+/gu, " ").trim();
}

function dedupeTexts(values: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];

  for (const value of values) {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    output.push(normalized);
  }

  return output;
}

function slugifyFragment(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}

function buildFragmentUrl(url: string, fragment: string | null): string {
  if (!fragment) {
    return url;
  }
  const parsed = new URL(url);
  parsed.hash = fragment;
  return parsed.toString();
}

function extractTextLines(html: string): string[] {
  return decodeHtml(
    html
      .replace(/<br\s*\/?>/giu, "\n")
      .replace(/<\/p>/giu, "\n")
      .replace(/<\/div>/giu, "\n")
      .replace(/<\/li>/giu, "\n")
      .replace(/<[^>]+>/gu, " ")
  )
    .split("\n")
    .map((line) => line.replace(/\s+/gu, " ").trim())
    .filter(Boolean);
}

export function buildNoscriptUrl(url: string): string {
  const parsed = new URL(url);
  parsed.searchParams.set("_fb_noscript", "1");
  parsed.hash = "";
  return parsed.toString();
}

export function normalizeDocUrl(rawUrl: string, baseUrl = docSourceDefinition.baseUrl): string | null {
  try {
    const url = new URL(rawUrl, baseUrl);
    if (url.hostname !== "developers.facebook.com") {
      return null;
    }

    const pathname = trimTrailingSlash(url.pathname);
    if (!pathname.startsWith(docSourceDefinition.allowedPath)) {
      return null;
    }

    url.pathname = pathname;
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

export function classifyDocPage(pathname: string): DocPageType {
  const normalized = trimTrailingSlash(pathname);
  if (normalized === "/docs/graph-api/reference") {
    return DocPageType.REFERENCE_INDEX;
  }
  if (normalized.startsWith("/docs/graph-api/reference/")) {
    return DocPageType.REFERENCE_ITEM;
  }
  if (normalized === "/docs/graph-api/changelog") {
    return DocPageType.CHANGELOG;
  }
  if (normalized.startsWith("/docs/graph-api/changelog/version")) {
    return DocPageType.CHANGELOG_VERSION;
  }
  if (normalized.startsWith("/docs/graph-api/guides/")) {
    return DocPageType.GUIDE;
  }
  return DocPageType.UNKNOWN;
}

export function inferRelationType(fromType: DocPageType, targetPath: string): DocRelationType {
  const targetType = classifyDocPage(targetPath);
  if (fromType === DocPageType.REFERENCE_INDEX && targetType === DocPageType.REFERENCE_ITEM) {
    return DocRelationType.DISCOVERED_CHILD;
  }
  if (fromType === DocPageType.CHANGELOG && targetType === DocPageType.CHANGELOG_VERSION) {
    return DocRelationType.CHANGELOG_ENTRY;
  }
  return DocRelationType.RELATED;
}

function extractTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>([^<]+)<\/title>/iu);
  return match?.[1]?.trim() ?? null;
}

function extractCanonicalUrl(html: string): string | null {
  const match = html.match(/<link[^>]+rel="canonical"[^>]+href="([^"]+)"/iu);
  return match?.[1] ?? null;
}

function extractDescription(html: string): string | null {
  const match = html.match(/<meta[^>]+name="description"[^>]+content="([^"]*)"/iu);
  return match?.[1]?.trim() ?? null;
}

function extractHeadings(html: string): string[] {
  return [...html.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/giu)]
    .map((match) => stripTags(match[1] ?? ""))
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 24);
}

function extractLinks(html: string, currentUrl: string): string[] {
  const urls = new Set<string>();
  for (const match of html.matchAll(/href="([^"]+)"/giu)) {
    const normalized = normalizeDocUrl(match[1] ?? "", currentUrl);
    if (normalized) {
      urls.add(normalized);
    }
  }
  return [...urls];
}

export interface ExtractedLinkReference {
  href: string;
  normalizedUrl: string | null;
  label: string;
}

export interface ExtractedTableRow {
  cells: string[];
  cellLines: string[][];
  links: ExtractedLinkReference[];
}

export interface ExtractedTable {
  caption: string | null;
  sectionHeading: string | null;
  sectionAnchor: string | null;
  sourceUrl: string;
  headers: string[];
  rows: ExtractedTableRow[];
  rowsTruncated: boolean;
}

export interface ExtractedSection {
  heading: string;
  level: number;
  anchor: string | null;
  sourceUrl: string;
  paragraphs: string[];
}

export interface ExtractedNodeDirectoryEntry {
  label: string;
  description: string;
  href: string | null;
  normalizedUrl: string | null;
  slug: string | null;
  sectionHeading: string | null;
  sectionAnchor: string | null;
  sourceUrl: string;
}

export interface ExtractedReferenceEntry {
  name: string;
  detail: string | null;
  description: string;
  href: string | null;
  normalizedUrl: string | null;
  sectionHeading: string | null;
  sectionAnchor: string | null;
  sourceUrl: string;
}

export interface ExtractedReferenceCollection {
  key: string;
  label: string;
  anchor: string | null;
  sourceUrl: string;
  entries: ExtractedReferenceEntry[];
}

function extractLinksFromHtml(html: string, currentUrl: string): ExtractedLinkReference[] {
  return [...html.matchAll(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/giu)]
    .map((match) => {
      const href = match[1] ?? "";
      return {
        href,
        normalizedUrl: normalizeDocUrl(href, currentUrl),
        label: stripTags(match[2] ?? "")
      };
    })
    .filter((link) => link.href.length > 0);
}

function extractParagraphsAndSections(
  html: string,
  responseUrl: string
): {
  introParagraphs: string[];
  sections: ExtractedSection[];
  headingMarkers: HeadingMarker[];
  sectionUrls: string[];
} {
  const tokenMatches = [
    ...html.matchAll(/<(h[1-3])([^>]*)>([\s\S]*?)<\/\1>|<p[^>]*>([\s\S]*?)<\/p>/giu)
  ];
  const introParagraphs: string[] = [];
  const sections: ExtractedSection[] = [];
  const headingMarkers: HeadingMarker[] = [];
  let currentSection: ExtractedSection | null = null;

  for (const match of tokenMatches) {
    if (match[1]) {
      const heading = stripTags(match[3] ?? "");
      const headingAttrs = match[2] ?? "";
      if (!heading) {
        continue;
      }

      const explicitAnchor = headingAttrs.match(/\sid="([^"]+)"/iu)?.[1] ?? null;
      const anchor = explicitAnchor ?? slugifyFragment(heading);
      currentSection = {
        heading,
        level: Number.parseInt(match[1].slice(1), 10),
        anchor,
        sourceUrl: buildFragmentUrl(responseUrl, anchor),
        paragraphs: []
      };
      sections.push(currentSection);
      headingMarkers.push({
        index: match.index ?? 0,
        heading,
        level: currentSection.level,
        anchor
      });
      continue;
    }

    const paragraph = normalizeWhitespace(stripTags(match[4] ?? ""));
    if (!paragraph || paragraph.length < 12) {
      continue;
    }

    if (currentSection && currentSection.paragraphs.length < 4) {
      currentSection.paragraphs.push(paragraph);
      continue;
    }

    if (!currentSection && introParagraphs.length < 4) {
      introParagraphs.push(paragraph);
    }
  }

  const normalizedSections = sections
    .map((section) => ({
      ...section,
      paragraphs: dedupeTexts(section.paragraphs).slice(0, 4)
    }))
    .filter((section) => section.heading.length > 0)
    .slice(0, 32);

  return {
    introParagraphs: dedupeTexts(introParagraphs).slice(0, 4),
    sections: normalizedSections,
    headingMarkers,
    sectionUrls: normalizedSections.map((section) => section.sourceUrl)
  };
}

function findNearestHeadingMarker(markers: HeadingMarker[], index: number): HeadingMarker | null {
  let nearest: HeadingMarker | null = null;
  for (const marker of markers) {
    if (marker.index > index) {
      break;
    }
    nearest = marker;
  }
  return nearest;
}

function extractTables(html: string, currentUrl: string, headingMarkers: HeadingMarker[]): ExtractedTable[] {
  const tables: ExtractedTable[] = [];

  for (const match of html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/giu)) {
    const tableHtml = match[0];
    const sectionMarker = findNearestHeadingMarker(headingMarkers, match.index ?? 0);
    const captionMatch = tableHtml.match(/<caption[^>]*>([\s\S]*?)<\/caption>/iu);
    const headers = dedupeTexts(
      [...tableHtml.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/giu)]
        .map((headerMatch) => stripTags(headerMatch[1] ?? ""))
        .slice(0, 12)
    );

    const rows = [...tableHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/giu)]
      .map((rowMatch) => {
        const rowHtml = rowMatch[1] ?? "";
        const cells = [...rowHtml.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/giu)].map((cellMatch) => {
          const cellHtml = cellMatch[1] ?? "";
          return {
            text: normalizeWhitespace(stripTags(cellHtml)),
            lines: extractTextLines(cellHtml),
            links: extractLinksFromHtml(cellHtml, currentUrl)
          };
        });

        return {
          cells: cells.map((cell) => cell.text),
          cellLines: cells.map((cell) => cell.lines),
          links: cells.flatMap((cell) => cell.links)
        };
      })
      .filter((row) => row.cells.some(Boolean));

    if (rows.length === 0) {
      continue;
    }

    const normalizedRows =
      headers.length > 0 && (rows[0]?.cells.join("|") ?? "") === headers.join("|")
        ? rows.slice(1)
        : rows;

    tables.push({
      caption: captionMatch ? normalizeWhitespace(stripTags(captionMatch[1] ?? "")) : null,
      sectionHeading: sectionMarker?.heading ?? null,
      sectionAnchor: sectionMarker?.anchor ?? null,
      sourceUrl: buildFragmentUrl(currentUrl, sectionMarker?.anchor ?? null),
      headers,
      rows: normalizedRows.slice(0, 160),
      rowsTruncated: normalizedRows.length > 160
    });
  }

  return tables.slice(0, 24);
}

function extractNodeDirectory(tables: ExtractedTable[]): ExtractedNodeDirectoryEntry[] {
  for (const table of tables) {
    const firstHeader = table.headers[0]?.toLowerCase() ?? "";
    const secondHeader = table.headers[1]?.toLowerCase() ?? "";
    const looksLikeNodeTable =
      (firstHeader.includes("node") || firstHeader.includes("object")) &&
      secondHeader.includes("description");

    if (!looksLikeNodeTable) {
      continue;
    }

    return table.rows
      .map((row) => {
        const primaryLink = row.links[0] ?? null;
        const normalizedUrl = primaryLink?.normalizedUrl ?? null;
        const slug = normalizedUrl
          ? new URL(normalizedUrl).pathname.split("/").filter(Boolean).at(-1) ?? null
          : null;

        return {
          label: row.cellLines[0]?.[0] ?? row.cells[0] ?? "",
          description: row.cells[1] ?? "",
          href: primaryLink?.href ?? null,
          normalizedUrl,
          slug,
          sectionHeading: table.sectionHeading,
          sectionAnchor: table.sectionAnchor,
          sourceUrl: table.sourceUrl
        };
      })
      .filter((entry) => entry.label.length > 0);
  }

  return [];
}

function extractReferenceCollections(tables: ExtractedTable[]): ExtractedReferenceCollection[] {
  const collections: ExtractedReferenceCollection[] = [];

  for (const table of tables) {
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
      continue;
    }

    collections.push({
      key: collectionMeta.key,
      label: collectionMeta.label,
      anchor: table.sectionAnchor,
      sourceUrl: table.sourceUrl,
      entries: table.rows
        .map((row) => {
          const primaryLink = row.links[0] ?? null;
          const firstCellLines = row.cellLines[0] ?? [];

          return {
            name: firstCellLines[0] ?? row.cells[0] ?? "",
            detail: firstCellLines.slice(1).join(" · ") || null,
            description: row.cells[1] ?? "",
            href: primaryLink?.href ?? null,
            normalizedUrl: primaryLink?.normalizedUrl ?? null,
            sectionHeading: table.sectionHeading,
            sectionAnchor: table.sectionAnchor,
            sourceUrl: table.sourceUrl
          };
        })
        .filter((entry) => entry.name.length > 0)
    });
  }

  return collections;
}

export interface ExtractedDocSnapshot {
  parserVersion: string;
  title: string | null;
  canonicalUrl: string | null;
  description: string | null;
  rawText: string;
  headings: string[];
  introParagraphs: string[];
  sections: ExtractedSection[];
  tables: ExtractedTable[];
  nodeDirectory: ExtractedNodeDirectoryEntry[];
  referenceCollections: ExtractedReferenceCollection[];
  sectionUrls: string[];
  discoveredUrls: string[];
  contentHash: string;
  extractedData: {
    title: string | null;
    canonicalUrl: string | null;
    description: string | null;
    headings: string[];
    introParagraphs: string[];
    sections: ExtractedSection[];
    tables: ExtractedTable[];
    nodeDirectory: ExtractedNodeDirectoryEntry[];
    referenceCollections: ExtractedReferenceCollection[];
    sectionUrls: string[];
    discoveredUrls: string[];
    textPreview: string;
    pageType: DocPageType;
  };
}

export function extractDocSnapshot(
  html: string,
  responseUrl: string,
  pageType: DocPageType
): ExtractedDocSnapshot {
  const rawText = stripTags(html);
  const title = extractTitle(html);
  const canonicalUrl = extractCanonicalUrl(html);
  const description = extractDescription(html);
  const headings = extractHeadings(html);
  const { introParagraphs, sections, headingMarkers, sectionUrls } = extractParagraphsAndSections(html, responseUrl);
  const tables = extractTables(html, responseUrl, headingMarkers);
  const nodeDirectory = extractNodeDirectory(tables);
  const referenceCollections = extractReferenceCollections(tables);
  const discoveredUrls = extractLinks(html, responseUrl);
  const contentHash = createHash("sha256").update(html).digest("hex");

  return {
    parserVersion,
    title,
    canonicalUrl,
    description,
    rawText,
    headings,
    introParagraphs,
    sections,
    tables,
    nodeDirectory,
    referenceCollections,
    sectionUrls,
    discoveredUrls,
    contentHash,
    extractedData: {
      title,
      canonicalUrl,
      description,
      headings,
      introParagraphs,
      sections,
      tables,
      nodeDirectory,
      referenceCollections,
      sectionUrls,
      discoveredUrls,
      textPreview: rawText.slice(0, 2_000),
      pageType
    }
  };
}

export interface FetchDocResult {
  requestUrl: string;
  responseUrl: string;
  fetchMode: DocFetchMode;
  httpStatus: number;
  responseHeaders: Record<string, string>;
  rawHtml: string;
}

function scoreHtml(html: string, responseUrl: string): number {
  const textLength = stripTags(html).length;
  const linkCount = extractLinks(html, responseUrl).length;
  return textLength + linkCount * 250;
}

async function fetchVariant(url: string, fetchMode: DocFetchMode): Promise<FetchDocResult> {
  const response = await fetch(url, {
    redirect: "follow",
    headers: {
      accept: "text/html,application/xhtml+xml",
      "user-agent": "meta-graph-docs-local/0.1"
    }
  });
  const rawHtml = await response.text();
  return {
    requestUrl: url,
    responseUrl: response.url,
    fetchMode,
    httpStatus: response.status,
    responseHeaders: Object.fromEntries(response.headers.entries()),
    rawHtml
  };
}

export async function fetchBestDocVariant(url: string): Promise<FetchDocResult> {
  const primary = await fetchVariant(url, DocFetchMode.DEFAULT);
  if (!primary.rawHtml.includes("_fb_noscript")) {
    return primary;
  }

  const noscriptUrl = buildNoscriptUrl(url);
  const fallback = await fetchVariant(noscriptUrl, DocFetchMode.NOSCRIPT);
  return scoreHtml(fallback.rawHtml, fallback.responseUrl) > scoreHtml(primary.rawHtml, primary.responseUrl)
    ? fallback
    : primary;
}
