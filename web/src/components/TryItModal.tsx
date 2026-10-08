import React, { useState } from "react";
import type { PublicApi } from "../api/apis.js";
import type { WalletState } from "../hooks/useWalletConnection.js";
import { callPaidApi, callUrl, type ApiCallResult } from "../lib/x402Call.js";

interface Props {
  api: PublicApi;
  wallet: WalletState;
  onClose: () => void;
}

const inputClass =
  "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100";

function prettyBody(result: ApiCallResult): string {
  if (result.contentType?.includes("json")) {
    try {
      return JSON.stringify(JSON.parse(result.body), null, 2);
    } catch {
      // Not valid JSON after all; show it raw.
    }
  }
  return result.body;
}

export function TryItModal({ api, wallet, onClose }: Props) {
  const [method, setMethod] = useState<string>(api.allowedMethods[0] ?? "GET");
  const [path, setPath] = useState("");
  const [query, setQuery] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ApiCallResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const url = callUrl(api.proxyUrl, path, query);
  const canSendBody = method !== "GET";

  async function send() {
    if (!wallet.address) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(
        await callPaidApi(
          api.proxyUrl,
          { method, path, query, body, contentType: "application/json" },
          wallet.address,
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "The call could not be completed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="try-it-title"
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-6 shadow-xl dark:bg-gray-800">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2
              id="try-it-title"
              className="text-lg font-semibold text-gray-900 dark:text-gray-100"
            >
              {api.name}
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {api.price} USDC per successful call, paid from your Freighter wallet. Failed calls
              are not charged.
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg px-2 py-1 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            ✕
          </button>
        </div>

        <div className="mb-3 flex gap-2">
          <label className="sr-only" htmlFor="try-method">
            Method
          </label>
          <select
            id="try-method"
            value={method}
            onChange={(e) => setMethod(e.target.value)}
            className={`${inputClass} w-28 font-mono`}
          >
            {api.allowedMethods.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
          <label className="sr-only" htmlFor="try-path">
            Path
          </label>
          <input
            id="try-path"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="/path/under/the/api"
            className={`${inputClass} font-mono`}
          />
        </div>

        <label
          className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-200"
          htmlFor="try-query"
        >
          Query string
        </label>
        <input
          id="try-query"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="units=metric&lang=en"
          className={`${inputClass} mb-3 font-mono`}
        />

        {canSendBody && (
          <>
            <label
              className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-200"
              htmlFor="try-body"
            >
              JSON body
            </label>
            <textarea
              id="try-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={5}
              placeholder='{"key": "value"}'
              className={`${inputClass} mb-3 font-mono`}
            />
          </>
        )}

        <p className="mb-4 break-all rounded-lg bg-gray-50 px-3 py-2 font-mono text-xs text-gray-600 dark:bg-gray-900 dark:text-gray-300">
          {method} {url}
        </p>

        {wallet.status !== "connected" ? (
          <button
            onClick={wallet.connect}
            className="w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          >
            Connect Freighter to call this API
          </button>
        ) : (
          <button
            onClick={send}
            disabled={busy}
            className="w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
          >
            {busy ? "Paying and calling…" : `Pay ${api.price} USDC and send`}
          </button>
        )}

        {error && (
          <p
            role="alert"
            className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300"
          >
            {error}
          </p>
        )}

        {result && (
          <div className="mt-4">
            <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
              <span
                className={`rounded px-2 py-0.5 font-mono font-semibold ${
                  result.charged
                    ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300"
                    : "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300"
                }`}
              >
                {result.status}
              </span>
              <span className="text-gray-600 dark:text-gray-300">
                {result.charged ? `Charged ${api.price} USDC` : "Not charged"} · {result.durationMs}{" "}
                ms
              </span>
              {result.explorerUrl && (
                <a
                  href={result.explorerUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-indigo-600 underline hover:no-underline dark:text-indigo-400"
                >
                  View payment
                </a>
              )}
            </div>
            <pre className="max-h-80 overflow-auto rounded-lg bg-gray-900 p-3 text-xs text-gray-100">
              {prettyBody(result) || "(empty body)"}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
