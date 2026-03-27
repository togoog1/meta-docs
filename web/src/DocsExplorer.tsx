import { useEffect, useState } from "react";

type DocPageType =
  | "REFERENCE_INDEX"
  | "REFERENCE_ITEM"
  | "GUIDE"
  | "CHANGELOG"
  | "CHANGELOG_VERSION"
  | "UNKNOWN";

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
  extractedData: Record<string, unknown> | null;
  rawHtml: string;
  rawText: string | null;
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    headers: { "content-type": "application/json" },
    ...init
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({ error: "Request failed" }))) as {
      error?: string;
    };
    throw new Error(body.error ?? "Request failed");
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

function titleForPage(page: { title: string | null; path: string }): string {
  return page.title ?? page.path.split("/").filter(Boolean).at(-1) ?? page.path;
}

const pageTypeOptions: Array<{ label: string; value: "" | DocPageType }> = [
  { label: "All", value: "" },
  { label: "Reference Index", value: "REFERENCE_INDEX" },
  { label: "Reference Items", value: "REFERENCE_ITEM" },
  { label: "Guides", value: "GUIDE" },
  { label: "Changelog", value: "CHANGELOG" },
  { label: "Version Changelog", value: "CHANGELOG_VERSION" },
  { label: "Unknown", value: "UNKNOWN" }
];

export function DocsExplorer() {
  const [overview, setOverview] = useState<DocsOverview | null>(null);
  const [pages, setPages] = useState<DocPageSummary[]>([]);
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  const [pageDetail, setPageDetail] = useState<DocPageDetail | null>(null);
  const [selectedSnapshot, setSelectedSnapshot] = useState<DocSnapshotDetail | null>(null);
  const [query, setQuery] = useState("");
  const [pageType, setPageType] = useState<"" | DocPageType>("");
  const [maxPages, setMaxPages] = useState("40");
  const [detailTab, setDetailTab] = useState<"summary" | "raw" | "links" | "history">("summary");
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadOverview() {
    const next = await requestJson<DocsOverview>("/api/docs/overview");
    setOverview(next);
  }

  async function loadPages() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (query.trim()) {
        params.set("q", query.trim());
      }
      if (pageType) {
        params.set("pageType", pageType);
      }
      params.set("limit", "240");
      const next = await requestJson<DocPageSummary[]>(`/api/docs/pages?${params.toString()}`);
      setPages(next);
      setSelectedPageId((current) => {
        if (current && next.some((page) => page.id === current)) {
          return current;
        }
        return next[0]?.id ?? null;
      });
      setError(null);
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
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to load doc detail");
    }
  }

  async function loadSnapshot(snapshotId: string) {
    try {
      const next = await requestJson<DocSnapshotDetail>(`/api/docs/snapshots/${snapshotId}`);
      setSelectedSnapshot(next);
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to load snapshot");
    }
  }

  useEffect(() => {
    void loadOverview();
  }, []);

  useEffect(() => {
    void loadPages();
  }, [query, pageType]);

  useEffect(() => {
    if (!selectedPageId) {
      setPageDetail(null);
      setSelectedSnapshot(null);
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
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to sync docs");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="docs-shell">
      <header className="docs-header">
        <div>
          <p className="docs-eyebrow">Meta Graph Docs</p>
          <h1 className="docs-title">Local docs crawler and explorer</h1>
          <p className="docs-subtitle">
            Raw-first snapshots stored in SQLite with local browse, change history, and link graph.
          </p>
        </div>
        <div className="docs-toolbar">
          <input
            className="docs-max-pages"
            value={maxPages}
            onChange={(event) => setMaxPages(event.target.value)}
            placeholder="40"
          />
          <button className="docs-sync-button" type="button" onClick={() => void handleSync()} disabled={syncing}>
            {syncing ? "Syncing..." : "Sync Docs"}
          </button>
        </div>
      </header>

      <section className="docs-summary-grid">
        <div className="docs-stat-card">
          <span className="docs-stat-label">Pages</span>
          <strong>{overview?.counts.pages ?? 0}</strong>
        </div>
        <div className="docs-stat-card">
          <span className="docs-stat-label">Snapshots</span>
          <strong>{overview?.counts.snapshots ?? 0}</strong>
        </div>
        <div className="docs-stat-card">
          <span className="docs-stat-label">Changes</span>
          <strong>{overview?.counts.changes ?? 0}</strong>
        </div>
        <div className="docs-stat-card">
          <span className="docs-stat-label">Latest Run</span>
          <strong>{overview?.recentRuns[0] ? formatDate(overview.recentRuns[0].createdAt) : "Not run"}</strong>
        </div>
      </section>

      {error ? <div className="docs-error-banner">{error}</div> : null}

      <section className="docs-workspace">
        <aside className="docs-sidebar-panel">
          <div className="docs-sidebar-controls">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search title or path"
            />
            <select value={pageType} onChange={(event) => setPageType(event.target.value as "" | DocPageType)}>
              {pageTypeOptions.map((option) => (
                <option key={option.label} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="docs-page-list">
            {loading ? <p className="docs-empty-state">Loading pages...</p> : null}
            {!loading && pages.length === 0 ? <p className="docs-empty-state">No stored pages yet.</p> : null}
            {pages.map((page) => (
              <button
                key={page.id}
                type="button"
                className={`docs-page-row ${selectedPageId === page.id ? "active" : ""}`}
                onClick={() => {
                  setSelectedPageId(page.id);
                  setDetailTab("summary");
                }}
              >
                <div className="docs-page-row-top">
                  <strong>{titleForPage(page)}</strong>
                  <span className="docs-page-type">{page.pageType}</span>
                </div>
                <span className="docs-page-path">{page.path}</span>
                <span className="docs-page-meta">
                  {page._count.snapshots} snapshots · {page._count.changes} changes · {page._count.outgoingLinks} links
                </span>
              </button>
            ))}
          </div>
        </aside>

        <main className="docs-detail-panel">
          {pageDetail ? (
            <>
              <div className="docs-detail-header">
                <div>
                  <h2>{titleForPage(pageDetail)}</h2>
                  <p>{pageDetail.path}</p>
                </div>
                <a href={pageDetail.url} target="_blank" rel="noreferrer" className="docs-open-link">
                  Open Source Page
                </a>
              </div>

              <div className="docs-detail-tabs">
                {(["summary", "raw", "links", "history"] as const).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    className={detailTab === tab ? "active" : ""}
                    onClick={() => setDetailTab(tab)}
                  >
                    {tab}
                  </button>
                ))}
              </div>

              {detailTab === "summary" ? (
                <div className="docs-card-grid">
                  <div className="docs-card">
                    <h3>Page</h3>
                    <dl className="docs-kv-list">
                      <div><dt>Type</dt><dd>{pageDetail.pageType}</dd></div>
                      <div><dt>Canonical</dt><dd>{pageDetail.canonicalUrl ?? "Not set"}</dd></div>
                      <div><dt>Snapshots</dt><dd>{pageDetail.snapshots.length}</dd></div>
                      <div><dt>Outgoing Links</dt><dd>{pageDetail.outgoingLinks.length}</dd></div>
                      <div><dt>Incoming Links</dt><dd>{pageDetail.incomingLinks.length}</dd></div>
                    </dl>
                  </div>

                  <div className="docs-card">
                    <h3>Latest Snapshot</h3>
                    <dl className="docs-kv-list">
                      <div><dt>Fetched</dt><dd>{selectedSnapshot ? formatDate(selectedSnapshot.fetchedAt) : "Not set"}</dd></div>
                      <div><dt>Status</dt><dd>{selectedSnapshot?.httpStatus ?? "Not set"}</dd></div>
                      <div><dt>Mode</dt><dd>{selectedSnapshot?.fetchMode ?? "Not set"}</dd></div>
                      <div><dt>Hash</dt><dd className="docs-mono">{selectedSnapshot?.contentHash.slice(0, 16) ?? "Not set"}</dd></div>
                    </dl>
                  </div>

                  <div className="docs-card docs-card-wide">
                    <h3>Extracted Data</h3>
                    <pre>{JSON.stringify(selectedSnapshot?.extractedData ?? {}, null, 2)}</pre>
                  </div>
                </div>
              ) : null}

              {detailTab === "raw" ? (
                <div className="docs-card docs-raw-card">
                  <div className="docs-raw-meta">
                    <span>{selectedSnapshot?.responseUrl ?? pageDetail.url}</span>
                    <span>{selectedSnapshot?.fetchMode ?? "DEFAULT"}</span>
                  </div>
                  <pre>{selectedSnapshot?.rawHtml ?? "No snapshot selected."}</pre>
                </div>
              ) : null}

              {detailTab === "links" ? (
                <div className="docs-card-grid docs-links-grid">
                  <div className="docs-card">
                    <h3>Outgoing</h3>
                    <div className="docs-link-list">
                      {pageDetail.outgoingLinks.map((link) => (
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
                          <small>{link.toPage?.path ?? link.targetUrl}</small>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="docs-card">
                    <h3>Incoming</h3>
                    <div className="docs-link-list">
                      {pageDetail.incomingLinks.map((link) => (
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
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}

              {detailTab === "history" ? (
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
                        <small>{snapshot.contentHash.slice(0, 16)}</small>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </>
          ) : (
            <div className="docs-empty-state docs-empty-detail">
              <strong>No doc selected</strong>
              <span>Run a sync and pick a page to inspect snapshots, raw HTML, and discovered links.</span>
            </div>
          )}
        </main>
      </section>

      <section className="docs-footer-grid">
        <div className="docs-card">
          <h3>Recent Sync Runs</h3>
          <div className="docs-mini-list">
            {overview?.recentRuns.map((run) => (
              <div key={run.id} className="docs-mini-row">
                <strong>{run.status}</strong>
                <span>{run.pagesFetched} fetched · {run.pagesChanged} changed</span>
                <small>{formatDate(run.createdAt)}</small>
              </div>
            )) ?? <p className="docs-empty-state">No runs yet.</p>}
          </div>
        </div>

        <div className="docs-card">
          <h3>Recent Changes</h3>
          <div className="docs-mini-list">
            {overview?.recentChanges.map((change) => (
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
            )) ?? <p className="docs-empty-state">No changes yet.</p>}
          </div>
        </div>
      </section>
    </div>
  );
}
