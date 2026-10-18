import React, { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { fetchApiById, type PublicApi } from "../api/apis.js";
import { useAsync } from "../hooks/useAsync.js";
import { TryItModal } from "./TryItModal.js";
import { Toast } from "./Toast.js";
import { WalletButton } from "./WalletButton.js";
import { LanguageSwitcher } from "./LanguageSwitcher.js";
import { useTheme } from "../hooks/useTheme.js";
import { useWalletConnection } from "../hooks/useWalletConnection.js";

/** Shown when the id is present but the API has listed=false (404 from server). */
function NotFound({ title, description }: { title: string; description: string }) {
  const { t } = useTranslation();
  return (
    <div className="rounded-xl border border-dashed border-gray-300 p-12 text-center dark:border-gray-700">
      <h2 className="mb-2 text-lg font-semibold text-gray-900 dark:text-gray-100">{title}</h2>
      <p className="mb-6 text-sm text-gray-500 dark:text-gray-400">{description}</p>
      <Link
        to="/"
        className="inline-block rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
      >
        {t("api_detail.back")}
      </Link>
    </div>
  );
}

export function ApiDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const { theme, toggleTheme } = useTheme();
  const wallet = useWalletConnection();

  const [trying, setTrying] = useState<PublicApi | null>(null);
  const [toast, setToast] = useState<{ message: string; fallbackUrl?: string } | null>(null);

  const {
    status,
    data: api,
    error,
  } = useAsync<PublicApi>((signal) => fetchApiById(id ?? "", signal), [id]);

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setToast({ message: t("catalog.copied_to_clipboard") });
    } catch {
      setToast({ message: t("catalog.copy_this_url"), fallbackUrl: text });
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-indigo-600 focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-white focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
      >
        {t("app.skip_to_main")}
      </a>

      <div className="mx-auto max-w-3xl px-4 py-6 sm:px-8">
        {/* Header */}
        <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <Link
            to="/"
            className="text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400"
          >
            {t("api_detail.back")}
          </Link>
          <div className="flex items-center gap-2">
            <LanguageSwitcher />
            <button
              onClick={toggleTheme}
              aria-label={t("app.theme_toggle_label")}
              title={`${t(theme === "dark" ? "app.theme_light" : "app.theme_dark")} mode`}
              className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
            >
              {theme === "dark" ? "☀️" : "🌙"}
            </button>
            <WalletButton wallet={wallet} />
          </div>
        </header>

        <main id="main-content">
          {/* Loading state */}
          {(status === "loading" || status === "idle") && !api && (
            <div aria-busy="true" aria-label={t("api_detail.loading")} className="space-y-4">
              <div className="h-8 w-64 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
              <div className="h-4 w-full animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
              <div className="h-4 w-3/4 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
            </div>
          )}

          {/* Error / not found state */}
          {status === "error" && (
            <NotFound
              title={t("api_detail.not_found_title")}
              description={error ?? t("api_detail.error")}
            />
          )}

          {/* Success state */}
          {api && (
            <article aria-labelledby="api-detail-title">
              <div className="mb-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-800">
                {/* Title + price */}
                <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                  <h1
                    id="api-detail-title"
                    className="text-2xl font-bold text-gray-900 dark:text-gray-100"
                  >
                    {api.name}
                  </h1>
                  <span className="rounded-full bg-indigo-50 px-3 py-1 text-base font-semibold text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
                    {api.price} {t("api_detail.price_per_call")}
                  </span>
                </div>

                {/* Description */}
                {api.description && (
                  <p className="mb-4 text-gray-600 dark:text-gray-300">{api.description}</p>
                )}

                {/* Methods */}
                <dl className="mb-4 space-y-2 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <dt className="font-medium text-gray-700 dark:text-gray-200">
                      {t("api_detail.methods_label")}
                    </dt>
                    <dd className="flex flex-wrap gap-1">
                      {api.allowedMethods.map((m) => (
                        <span
                          key={m}
                          className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-700 dark:bg-gray-700 dark:text-gray-200"
                        >
                          {m}
                        </span>
                      ))}
                    </dd>
                  </div>

                  {/* Tags */}
                  {api.tags.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2">
                      <dt className="font-medium text-gray-700 dark:text-gray-200">
                        {t("api_detail.tags_label")}
                      </dt>
                      <dd className="flex flex-wrap gap-1">
                        {api.tags.map((tag) => (
                          <span
                            key={tag}
                            className="rounded bg-emerald-50 px-1.5 py-0.5 text-xs text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
                          >
                            #{tag}
                          </span>
                        ))}
                      </dd>
                    </div>
                  )}

                  {/* Proxy URL */}
                  <div className="flex flex-wrap items-center gap-2">
                    <dt className="font-medium text-gray-700 dark:text-gray-200">
                      {t("api_detail.proxy_url_label")}
                    </dt>
                    <dd className="flex items-center gap-2">
                      <code className="break-all rounded bg-gray-100 px-2 py-0.5 font-mono text-xs text-gray-800 dark:bg-gray-700 dark:text-gray-100">
                        {api.proxyUrl}
                      </code>
                      <button
                        onClick={() => copy(api.proxyUrl)}
                        className="shrink-0 rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
                      >
                        {t("api_detail.copy_url")}
                      </button>
                    </dd>
                  </div>
                </dl>

                {/* Actions */}
                <button
                  onClick={() => setTrying(api)}
                  className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-700"
                >
                  {t("api_detail.try_it")}
                </button>
              </div>
            </article>
          )}
        </main>
      </div>

      {trying && <TryItModal api={trying} wallet={wallet} onClose={() => setTrying(null)} />}
      {toast && (
        <Toast
          message={toast.message}
          fallbackUrl={toast.fallbackUrl}
          onDismiss={() => setToast(null)}
        />
      )}
    </div>
  );
}
