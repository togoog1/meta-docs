const DOC_SOURCE_SLUG = "meta-graph-docs";
const DOC_BASE_URL = "https://developers.facebook.com";
const DOC_ALLOWED_PATH = "/docs/graph-api";

const DOC_SEED_URLS = [
  `${DOC_BASE_URL}/docs/graph-api/reference`,
  `${DOC_BASE_URL}/docs/graph-api/changelog/`,
  `${DOC_BASE_URL}/docs/graph-api/guides/versioning`
] as const;

export interface DocSourceDefinition {
  slug: string;
  label: string;
  baseUrl: string;
  allowedPath: string;
  seedUrls: string[];
}

export const docSourceDefinition: DocSourceDefinition = {
  slug: DOC_SOURCE_SLUG,
  label: "Meta Graph Docs",
  baseUrl: DOC_BASE_URL,
  allowedPath: DOC_ALLOWED_PATH,
  seedUrls: [...DOC_SEED_URLS]
};
