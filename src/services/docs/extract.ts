import { createHash } from "node:crypto";

import { DocFetchMode, DocPageType, DocRelationType } from "../../generated/prisma/client.js";
import { docSourceDefinition } from "./source.js";

const parserVersion = "meta-graph-docs-parser-v1";

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
  const matches = [...html.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/giu)];
  return matches
    .map((match) => stripTags(match[1] ?? ""))
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 24);
}

function extractLinks(html: string, currentUrl: string): string[] {
  const hrefMatches = [...html.matchAll(/href="([^"]+)"/giu)];
  const urls = new Set<string>();

  for (const match of hrefMatches) {
    const normalized = normalizeDocUrl(match[1] ?? "", currentUrl);
    if (normalized) {
      urls.add(normalized);
    }
  }

  return [...urls];
}

export interface ExtractedDocSnapshot {
  parserVersion: string;
  title: string | null;
  canonicalUrl: string | null;
  description: string | null;
  rawText: string;
  headings: string[];
  discoveredUrls: string[];
  contentHash: string;
  extractedData: {
    title: string | null;
    canonicalUrl: string | null;
    description: string | null;
    headings: string[];
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
  const discoveredUrls = extractLinks(html, responseUrl);
  const contentHash = createHash("sha256").update(html).digest("hex");

  return {
    parserVersion,
    title,
    canonicalUrl,
    description,
    rawText,
    headings,
    discoveredUrls,
    contentHash,
    extractedData: {
      title,
      canonicalUrl,
      description,
      headings,
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
