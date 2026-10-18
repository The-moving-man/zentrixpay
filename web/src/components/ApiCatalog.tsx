import React, { useEffect, useRef, useState } from "react";
import { fetchApis, type PublicApi } from "../api/apis.js";
import { ErrorBanner } from "./ErrorBanner.js";

const PAGE_SIZE = 20;

interface Props {
  onTry: (api: PublicApi) => void;
  onCopy: (text: string) => void;
}

export function ApiCatalog({ onTry, onCopy }: Props) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [items, setItems] = useState<PublicApi[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Debounce the search query
  useEffect(() => {
    const id = setTimeout(() => setDebounced(query), 250);
    return () => clearTimeout(id);
  }, [query]);

  // Reset and load first page whenever the query changes
  useEffect(() => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setItems([]);
    setOffset(0);
    setHasMore(false);
    setStatus("loading");
    setError(null);

    fetchApis(debounced, ctrl.signal, PAGE_SIZE, 0)
      .then((page) => {
        if (ctrl.signal.aborted) return;
        setItems(page);
        setHasMore(page.length === PAGE_SIZE);
        setOffset(PAGE_SIZE);
        setStatus("idle");
      })
      .catch((err) => {
        if (ctrl.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Failed to load APIs");
        setStatus("error");
      });

    return () => ctrl.abort();
  }, [debounced]);

  async function loadMore() {
    setLoadingMore(true);
    try {
      const page = await fetchApis(debounced, undefined, PAGE_SIZE, offset);
      setItems((prev) => [...prev, ...page]);
      setHasMore(page.length === PAGE_SIZE);
      setOffset((prev) => prev + PAGE_SIZE);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load more APIs");
    } finally {
      setLoadingMore(false);
    }
  }

  function retry() {
    setDebounced((d) => d); // trigger the effect
    setStatus("idle");
    setError(null);
  }

  useEffect(() => {
    if (!data) return;
    setKnownTags((prev) => {
      const next = new Set(prev);
      for (const api of data) for (const tag of api.tags) next.add(tag);
      return next.size === prev.length ? prev : [...next].sort();
    });
  }, [data]);

  function toggleTag(tag: string) {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag].sort(),
    );
  }

  const filtering = Boolean(debounced) || selectedTags.length > 0;

  return (
    <section aria-labelledby="catalog-heading">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 id="catalog-heading" className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          {t("catalog.heading")}
        </h2>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("catalog.search_placeholder")}
          aria-label={t("catalog.search_label")}
          className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 sm:w-72"
        />
      </div>

      {knownTags.length > 0 && (
        <div
          className="mb-4 flex flex-wrap items-center gap-1.5"
          role="group"
          aria-label="Filter by tag"
        >
          {knownTags.map((tag) => {
            const on = selectedTags.includes(tag);
            return (
              <button
                key={tag}
                type="button"
                aria-pressed={on}
                onClick={() => toggleTag(tag)}
                className={`${chipBase} ${on ? chipOn : chipOff}`}
              >
                #{tag}
              </button>
            );
          })}
          {selectedTags.length > 0 && (
            <button
              type="button"
              onClick={() => setSelectedTags([])}
              className="ml-1 text-xs text-gray-500 underline hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            >
              Clear tags
            </button>
          )}
        </div>
      )}

      {status === "error" && (
        <ErrorBanner message={error ?? t("catalog.heading")} onRetry={retry} />
      )}

      {status === "loading" && items.length === 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-40 animate-pulse rounded-xl bg-gray-200 dark:bg-gray-800" />
          ))}
        </div>
      )}

      {status !== "loading" && items.length === 0 && !error && (
        <p className="rounded-xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
          {debounced ? `No APIs match "${debounced}".` : "No APIs are listed yet."}
        </p>
      )}

      {items.length > 0 && (
        <>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((api) => (
              <li
                key={api.id}
                className="flex flex-col rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800"
              >
                <div className="mb-1 flex items-start justify-between gap-2">
                  <h3 className="font-semibold text-gray-900 dark:text-gray-100">{api.name}</h3>
                  <span className="shrink-0 rounded-full bg-indigo-50 px-2 py-0.5 text-sm font-semibold text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
                    {api.price} USDC
                    <span className="font-normal text-indigo-500 dark:text-indigo-400">
                      {" "}
                      / call
                    </span>
                  </span>
                </div>
                {api.description && (
                  <p className="mb-3 line-clamp-3 text-sm text-gray-600 dark:text-gray-300">
                    {api.description}
                  </p>
                )}
                <div className="mb-3 flex flex-wrap gap-1">
                  {api.allowedMethods.map((m) => (
                    <span
                      key={m}
                      className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-700 dark:bg-gray-700 dark:text-gray-200"
                    >
                      {m}
                    </span>
                  ))}
                  {api.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded bg-emerald-50 px-1.5 py-0.5 text-xs text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
                    >
                      #{tag}
                    </span>
                  ))}
                </div>
                <div className="mt-auto flex gap-2">
                  <button
                    onClick={() => onTry(api)}
                    className="flex-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
                  >
                    Try it
                  </button>
                  <button
                    onClick={() => onCopy(api.proxyUrl)}
                    className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
                  >
                    Copy URL
                  </button>
                </div>
              </li>
            ))}
          </ul>

          {hasMore && (
            <div className="mt-6 flex justify-center">
              <button
                onClick={loadMore}
                disabled={loadingMore}
                className="rounded-lg border border-gray-300 px-5 py-2 text-sm text-gray-700 hover:bg-gray-100 disabled:opacity-60 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
              >
                {loadingMore ? "Loading…" : "Load more"}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
