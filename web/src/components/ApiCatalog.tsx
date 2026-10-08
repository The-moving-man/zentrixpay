import React, { useEffect, useState } from "react";
import { fetchApis, type PublicApi } from "../api/apis.js";
import { useAsync } from "../hooks/useAsync.js";
import { ErrorBanner } from "./ErrorBanner.js";

interface Props {
  onTry: (api: PublicApi) => void;
  onCopy: (text: string) => void;
}

export function ApiCatalog({ onTry, onCopy }: Props) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    const id = setTimeout(() => setDebounced(query), 250);
    return () => clearTimeout(id);
  }, [query]);

  const { status, data, error, retry } = useAsync<PublicApi[]>(
    (signal) => fetchApis(debounced, signal),
    [debounced],
  );

  return (
    <section aria-labelledby="catalog-heading">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 id="catalog-heading" className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          APIs you can call
        </h2>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search APIs…"
          aria-label="Search APIs"
          className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 sm:w-72"
        />
      </div>

      {status === "error" && (
        <ErrorBanner message={error ?? "Failed to load APIs"} onRetry={retry} />
      )}

      {(status === "loading" || status === "idle") && !data && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-40 animate-pulse rounded-xl bg-gray-200 dark:bg-gray-800" />
          ))}
        </div>
      )}

      {data && data.length === 0 && (
        <p className="rounded-xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
          {debounced ? `No APIs match “${debounced}”.` : "No APIs are listed yet."}
        </p>
      )}

      {data && data.length > 0 && (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.map((api) => (
            <li
              key={api.id}
              className="flex flex-col rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800"
            >
              <div className="mb-1 flex items-start justify-between gap-2">
                <h3 className="font-semibold text-gray-900 dark:text-gray-100">{api.name}</h3>
                <span className="shrink-0 rounded-full bg-indigo-50 px-2 py-0.5 text-sm font-semibold text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
                  {api.price} USDC
                  <span className="font-normal text-indigo-500 dark:text-indigo-400"> / call</span>
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
      )}
    </section>
  );
}
