import React, { useState } from "react";
import { ApiCatalog } from "./components/ApiCatalog.js";
import { ProviderDashboard } from "./components/ProviderDashboard.js";
import { TryItModal } from "./components/TryItModal.js";
import { Toast } from "./components/Toast.js";
import { WalletButton } from "./components/WalletButton.js";
import { useTheme } from "./hooks/useTheme.js";
import { useWalletConnection } from "./hooks/useWalletConnection.js";
import type { PublicApi } from "./api/apis.js";

type Tab = "browse" | "provide";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "browse", label: "Browse APIs" },
  { id: "provide", label: "Sell your API" },
];

export default function App() {
  const [tab, setTab] = useState<Tab>("browse");
  const [trying, setTrying] = useState<PublicApi | null>(null);
  const [toast, setToast] = useState<{ message: string; fallbackUrl?: string } | null>(null);
  const { theme, toggleTheme } = useTheme();
  const wallet = useWalletConnection();

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setToast({ message: "Copied to clipboard" });
    } catch {
      setToast({ message: "Copy this URL:", fallbackUrl: text });
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-indigo-600 focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-white focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
      >
        Skip to main content
      </a>

      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-8">
        <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">ZentrixPay</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Pay-per-call APIs. One HTTP call, one USDC payment on Stellar — no accounts, no
              subscriptions.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={toggleTheme}
              aria-label="Toggle light/dark theme"
              title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
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
