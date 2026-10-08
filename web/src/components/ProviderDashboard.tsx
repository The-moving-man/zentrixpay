import React, { useState } from "react";
import {
  HTTP_METHODS,
  createApi,
  fetchApiStats,
  fetchMyApis,
  registerPublisher,
  updateApi,
  verifyApiOwnership,
  type ApiStats,
  type HttpMethod,
  type OwnerApi,
} from "../api/apis.js";
import { useAsync } from "../hooks/useAsync.js";
import type { WalletState } from "../hooks/useWalletConnection.js";
import { ErrorBanner } from "./ErrorBanner.js";

const KEY_STORAGE = "zentrixpay-provider-api-key";

const inputClass =
  "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100";
const primaryButton =
  "rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60";
const secondaryButton =
  "rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100 disabled:opacity-60 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700";
const card =
  "rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800";

function readStoredKey(): string {
  try {
    return localStorage.getItem(KEY_STORAGE) ?? "";
  } catch {
    return "";
  }
}

function storeKey(key: string | null): void {
  try {
    if (key) localStorage.setItem(KEY_STORAGE, key);
    else localStorage.removeItem(KEY_STORAGE);
  } catch {
    // Storage unavailable (private mode): the key just won't survive a reload.
  }
}

function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-3">
      <label
        htmlFor={htmlFor}
        className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-200"
      >
        {label}
      </label>
      {children}
      {hint && <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{hint}</p>}
    </div>
  );
}

// ── Getting an API key ───────────────────────────────────────────────────────

function ProviderAccess({ wallet, onKey }: { wallet: WalletState; onKey: (key: string) => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [walletAddress, setWalletAddress] = useState(wallet.address ?? "");
  const [pasted, setPasted] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newKey, setNewKey] = useState<string | null>(null);

  async function register(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const publisher = await registerPublisher({
        name,
        email,
        walletAddress: walletAddress || wallet.address || "",
      });
      setNewKey(publisher.apiKey);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setBusy(false);
    }
  }

  if (newKey) {
    return (
      <div className={card}>
        <h3 className="mb-2 font-semibold text-gray-900 dark:text-gray-100">
          Your provider API key
        </h3>
        <p className="mb-3 text-sm text-amber-700 dark:text-amber-300">
          This is shown only once. Save it somewhere safe — you need it to manage your APIs.
        </p>
        <code className="mb-4 block break-all rounded-lg bg-gray-100 p-3 text-xs dark:bg-gray-900 dark:text-gray-100">
          {newKey}
        </code>
        <button className={primaryButton} onClick={() => onKey(newKey)}>
          I saved it — continue
        </button>
      </div>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <form className={card} onSubmit={register}>
        <h3 className="mb-1 font-semibold text-gray-900 dark:text-gray-100">Become a provider</h3>
        <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
          Sell your API per call. Payments in USDC go straight to your Stellar wallet.
        </p>
        <Field label="Name" htmlFor="pub-name">
          <input
            id="pub-name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Email" htmlFor="pub-email">
          <input
            id="pub-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field
          label="Payout wallet"
          htmlFor="pub-wallet"
          hint="Defaults to your connected Freighter address."
        >
          <input
            id="pub-wallet"
            required
            value={walletAddress || wallet.address || ""}
            onChange={(e) => setWalletAddress(e.target.value)}
            placeholder="G…"
            className={`${inputClass} font-mono`}
          />
        </Field>
        {error && (
          <p role="alert" className="mb-3 text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
        <button className={primaryButton} disabled={busy}>
          {busy ? "Registering…" : "Register"}
        </button>
      </form>

      <form
        className={card}
        onSubmit={(e) => {
          e.preventDefault();
          if (pasted.trim()) onKey(pasted.trim());
        }}
      >
        <h3 className="mb-1 font-semibold text-gray-900 dark:text-gray-100">Already a provider?</h3>
        <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
          Enter your provider API key.
        </p>
        <Field label="API key" htmlFor="pub-key">
          <input
            id="pub-key"
            type="password"
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            className={`${inputClass} font-mono`}
          />
        </Field>
        <button className={primaryButton}>Open dashboard</button>
      </form>
    </div>
  );
}

// ── Registering an API ───────────────────────────────────────────────────────

function NewApiForm({ apiKey, onCreated }: { apiKey: string; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [upstreamUrl, setUpstreamUrl] = useState("");
  const [price, setPrice] = useState("0.01");
  const [methods, setMethods] = useState<HttpMethod[]>(["GET"]);
  const [headerName, setHeaderName] = useState("");
  const [headerValue, setHeaderValue] = useState("");
  const [tags, setTags] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleMethod(m: HttpMethod) {
    setMethods((prev) => (prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await createApi(apiKey, {
        name,
        description: description || undefined,
        upstreamUrl,
        price,
        allowedMethods: methods,
        upstreamHeader:
          headerName && headerValue ? { name: headerName, value: headerValue } : undefined,
        tags: tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
      });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not register the API");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={card} onSubmit={submit}>
      <h3 className="mb-4 font-semibold text-gray-900 dark:text-gray-100">Register an API</h3>
      <div className="grid gap-x-4 md:grid-cols-2">
        <Field label="Name" htmlFor="api-name">
          <input
            id="api-name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Price per call (USDC)" htmlFor="api-price">
          <input
            id="api-price"
            required
            inputMode="decimal"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            className={inputClass}
          />
        </Field>
      </div>
      <Field
        label="Upstream URL"
        htmlFor="api-upstream"
        hint="Your real API base URL. Callers never see it."
      >
        <input
          id="api-upstream"
          type="url"
          required
          placeholder="https://api.example.com/v1"
          value={upstreamUrl}
          onChange={(e) => setUpstreamUrl(e.target.value)}
          className={`${inputClass} font-mono`}
        />
      </Field>
      <Field label="Description" htmlFor="api-desc">
        <textarea
          id="api-desc"
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className={inputClass}
        />
      </Field>
      <fieldset className="mb-3">
        <legend className="mb-1 text-sm font-medium text-gray-700 dark:text-gray-200">
          Allowed methods
        </legend>
        <div className="flex flex-wrap gap-3">
          {HTTP_METHODS.map((m) => (
            <label
              key={m}
              className="flex items-center gap-1 font-mono text-sm text-gray-700 dark:text-gray-200"
            >
              <input
                type="checkbox"
                checked={methods.includes(m)}
                onChange={() => toggleMethod(m)}
              />
              {m}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-x-4 md:grid-cols-2">
        <Field
          label="Secret header name (optional)"
          htmlFor="api-hname"
          hint="Added to every forwarded call, e.g. your own API key."
        >
          <input
            id="api-hname"
            placeholder="x-api-key"
            value={headerName}
            onChange={(e) => setHeaderName(e.target.value)}
            className={`${inputClass} font-mono`}
          />
        </Field>
        <Field
          label="Secret header value"
          htmlFor="api-hvalue"
          hint="Stored encrypted; never shown again."
        >
          <input
            id="api-hvalue"
            type="password"
            value={headerValue}
            onChange={(e) => setHeaderValue(e.target.value)}
            className={`${inputClass} font-mono`}
          />
        </Field>
      </div>
      <Field label="Tags" htmlFor="api-tags" hint="Comma separated, up to 10.">
        <input
          id="api-tags"
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          placeholder="weather, geo"
          className={inputClass}
        />
      </Field>
      {error && (
        <p role="alert" className="mb-3 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
      <button className={primaryButton} disabled={busy || methods.length === 0}>
        {busy ? "Registering…" : "Register API"}
      </button>
    </form>
  );
}

// ── Managing one API ─────────────────────────────────────────────────────────

function StatsPanel({ stats }: { stats: ApiStats }) {
  const tiles = [
    ["Revenue", `${stats.revenue} USDC`],
    ["Paid calls", String(stats.chargedCalls)],
    ["All calls", String(stats.calls)],
    ["Unique payers", String(stats.uniquePayers)],
    ["Avg latency", `${stats.avgDurationMs} ms`],
  ];
  return (
    <div className="mt-4">
      <dl className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
        {tiles.map(([label, value]) => (
          <div key={label} className="rounded-lg bg-gray-50 p-2 dark:bg-gray-900">
            <dt className="text-xs text-gray-500 dark:text-gray-400">{label}</dt>
            <dd className="font-semibold text-gray-900 dark:text-gray-100">{value}</dd>
          </div>
        ))}
      </dl>
      {stats.recentCalls.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-gray-500 dark:text-gray-400">
              <tr>
                <th className="py-1 pr-3">When</th>
                <th className="py-1 pr-3">Call</th>
                <th className="py-1 pr-3">Status</th>
                <th className="py-1 pr-3">Paid</th>
                <th className="py-1">Payer</th>
              </tr>
            </thead>
            <tbody className="text-gray-700 dark:text-gray-200">
              {stats.recentCalls.map((c) => (
                <tr key={c.id} className="border-t border-gray-100 dark:border-gray-700">
                  <td className="py-1 pr-3 whitespace-nowrap">
                    {new Date(c.createdAt).toLocaleString()}
                  </td>
                  <td className="py-1 pr-3 font-mono">
                    {c.method} {c.path}
                  </td>
                  <td className="py-1 pr-3 font-mono">{c.responseStatus}</td>
                  <td className="py-1 pr-3">{c.charged ? `${c.amount} USDC` : "—"}</td>
                  <td className="py-1 font-mono">
                    {c.payerAddress.slice(0, 6)}…{c.payerAddress.slice(-4)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ApiCard({
  api,
  apiKey,
  onChanged,
  onCopy,
}: {
  api: OwnerApi;
  apiKey: string;
  onChanged: (api: OwnerApi) => void;
  onCopy: (text: string) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [price, setPrice] = useState(api.price);
  const [stats, setStats] = useState<ApiStats | null>(null);

  async function run(label: string, action: () => Promise<OwnerApi | void>) {
    setBusy(label);
    setError(null);
    try {
      const updated = await action();
      if (updated) onChanged(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : `${label} failed`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <li className={card}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="font-semibold text-gray-900 dark:text-gray-100">{api.name}</h3>
        <span
          className={`rounded-full px-2 py-0.5 text-xs ${api.listed ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300" : "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300"}`}
        >
          {api.listed ? "Listed" : "Not listed"}
        </span>
        {!api.ownershipVerified && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
            Ownership not verified
          </span>
        )}
      </div>

      <dl className="mb-3 grid gap-1 text-sm">
        <div className="flex flex-wrap gap-2">
          <dt className="text-gray-500 dark:text-gray-400">Proxy URL</dt>
          <dd className="font-mono text-gray-800 dark:text-gray-100 break-all">
            {api.proxyUrl}{" "}
            <button
              className="text-xs text-indigo-600 underline dark:text-indigo-400"
              onClick={() => onCopy(api.proxyUrl)}
            >
              copy
            </button>
          </dd>
        </div>
        <div className="flex flex-wrap gap-2">
          <dt className="text-gray-500 dark:text-gray-400">Upstream</dt>
          <dd className="font-mono text-gray-800 dark:text-gray-100 break-all">
            {api.upstreamUrl}
          </dd>
        </div>
        <div className="flex flex-wrap gap-2">
          <dt className="text-gray-500 dark:text-gray-400">Methods</dt>
          <dd className="font-mono text-gray-800 dark:text-gray-100">
            {api.allowedMethods.join(", ")}
          </dd>
        </div>
        {api.upstreamHeaderName && (
          <div className="flex flex-wrap gap-2">
            <dt className="text-gray-500 dark:text-gray-400">Secret header</dt>
            <dd className="font-mono text-gray-800 dark:text-gray-100">
              {api.upstreamHeaderName}: ••••••
            </dd>
          </div>
        )}
      </dl>

      {!api.ownershipVerified && (
        <div className="mb-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-900/20 dark:text-amber-200">
          <p className="mb-1">To list this API, serve this line at</p>
          <p className="mb-1 break-all font-mono text-xs">{api.ownershipVerification.url}</p>
          <code className="mb-2 block break-all rounded bg-white/70 p-2 text-xs dark:bg-black/30">
            {api.ownershipVerification.expectedContent}
          </code>
          <button
            className={secondaryButton}
            disabled={busy !== null}
            onClick={() => run("Verify", () => verifyApiOwnership(apiKey, api.id))}
          >
            {busy === "Verify" ? "Checking…" : "Verify ownership"}
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label
            htmlFor={`price-${api.id}`}
            className="mb-1 block text-xs text-gray-500 dark:text-gray-400"
          >
            Price per call (USDC)
          </label>
          <input
            id={`price-${api.id}`}
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            inputMode="decimal"
            className={`${inputClass} w-32`}
          />
        </div>
        <button
          className={secondaryButton}
          disabled={busy !== null || price === api.price}
          onClick={() => run("Save price", () => updateApi(apiKey, api.id, { price }))}
        >
          {busy === "Save price" ? "Saving…" : "Save price"}
        </button>
        {api.ownershipVerified && (
          <button
            className={secondaryButton}
            disabled={busy !== null}
            onClick={() => run("Listing", () => updateApi(apiKey, api.id, { listed: !api.listed }))}
          >
            {api.listed ? "Unlist" : "List"}
          </button>
        )}
        <button
          className={secondaryButton}
          disabled={busy !== null}
          onClick={() =>
            stats
              ? setStats(null)
              : run("Stats", async () => {
                  setStats(await fetchApiStats(apiKey, api.id));
                })
          }
        >
          {stats ? "Hide stats" : busy === "Stats" ? "Loading…" : "Stats"}
        </button>
      </div>

      {error && (
        <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
      {stats && <StatsPanel stats={stats} />}
    </li>
  );
}

// ── Dashboard ────────────────────────────────────────────────────────────────

export function ProviderDashboard({
  wallet,
  onCopy,
}: {
  wallet: WalletState;
  onCopy: (text: string) => void;
}) {
  const [apiKey, setApiKey] = useState(readStoredKey);
  const [showForm, setShowForm] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [local, setLocal] = useState<Record<string, OwnerApi>>({});

  const { status, data, error, retry } = useAsync<OwnerApi[] | null>(
    (_signal) => (apiKey ? fetchMyApis(apiKey) : Promise.resolve(null)),
    [apiKey, refresh],
  );

  function changeKey(key: string | null) {
    storeKey(key);
    setApiKey(key ?? "");
    setLocal({});
  }

  if (!apiKey) return <ProviderAccess wallet={wallet} onKey={changeKey} />;

  const apis = (data ?? []).map((api) => local[api.id] ?? api);

  return (
    <section aria-labelledby="provider-heading" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2
          id="provider-heading"
          className="text-lg font-semibold text-gray-900 dark:text-gray-100"
        >
          Your APIs
        </h2>
        <div className="flex gap-2">
          <button className={primaryButton} onClick={() => setShowForm((v) => !v)}>
            {showForm ? "Cancel" : "Register an API"}
          </button>
          <button className={secondaryButton} onClick={() => changeKey(null)}>
            Sign out
          </button>
        </div>
      </div>

      {showForm && (
        <NewApiForm
          apiKey={apiKey}
          onCreated={() => {
            setShowForm(false);
            setRefresh((n) => n + 1);
          }}
        />
      )}

      {status === "error" && (
        <ErrorBanner message={error ?? "Failed to load your APIs"} onRetry={retry} />
      )}

      {data && apis.length === 0 && !showForm && (
        <p className="rounded-xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
          You have not registered any APIs yet.
        </p>
      )}

      {apis.length > 0 && (
        <ul className="flex flex-col gap-4">
          {apis.map((api) => (
            <ApiCard
              key={api.id}
              api={api}
              apiKey={apiKey}
              onCopy={onCopy}
              onChanged={(updated) => setLocal((prev) => ({ ...prev, [updated.id]: updated }))}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
