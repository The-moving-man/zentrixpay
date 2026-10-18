import React, { useState } from "react";
import { Routes, Route, Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ApiCatalog } from "./components/ApiCatalog.js";
import { ApiDetailPage } from "./components/ApiDetailPage.js";
import { ProviderDashboard } from "./components/ProviderDashboard.js";
import { TryItModal } from "./components/TryItModal.js";
import { Toast } from "./components/Toast.js";
import { WalletButton } from "./components/WalletButton.js";
import { LanguageSwitcher } from "./components/LanguageSwitcher.js";
import { useTheme } from "./hooks/useTheme.js";
import { useWalletConnection } from "./hooks/useWalletConnection.js";
import type { PublicApi } from "./api/apis.js";

type Tab = "browse" | "provide";

function MainLayout() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("browse");
  const [trying, setTrying] = useState<PublicApi | null>(null);
  const [toast, setToast] = useState<{ message: string; fallbackUrl?: string } | null>(null);
  const { theme, toggleTheme } = useTheme();
  const wallet = useWalletConnection();

  const TABS: Array<{ id: Tab; label: string }> = [
    { id: "browse", label: t("app.tab_browse") },
    { id: "provide", label: t("app.tab_provide") },
  ];

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

      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-8">
        <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              <Link to="/" className="hover:underline">
                {t("app.title")}
              </Link>
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">{t("app.subtitle")}</p>
          </div>
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

        <nav
          aria-label="Sections"
          className="mb-6 flex gap-1 border-b border-gray-200 dark:border-gray-700"
        >
          {TABS.map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              aria-current={tab === id ? "page" : undefined}
              className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${
                tab === id
                  ? "border-indigo-600 text-indigo-600 dark:border-indigo-400 dark:text-indigo-400"
                  : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
              }`}
            >
              {label}
            </button>
          ))}
        </nav>

        <main id="main-content">
          {tab === "browse" ? (
            <ApiCatalog onTry={setTrying} onCopy={copy} />
          ) : (
            <ProviderDashboard wallet={wallet} onCopy={copy} />
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

export default function App() {
  return (
    <Routes>
      <Route path="/apis/:id" element={<ApiDetailPage />} />
      <Route path="/*" element={<MainLayout />} />
    </Routes>
  );
}
