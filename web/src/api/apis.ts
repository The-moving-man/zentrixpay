import { signedPublisherFetch } from "./requestSignature.js";

const API_BASE = import.meta.env.VITE_API_URL ?? "";

export const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

/** A pay-per-call API as anyone sees it in the catalog. */
export interface PublicApi {
  id: string;
  name: string;
  description: string | null;
  price: string;
  currency: "USDC";
  walletAddress: string;
  allowedMethods: HttpMethod[];
  tags: string[];
  proxyUrl: string;
  createdAt: string;
}

/** The provider's own view of an API. */
export interface OwnerApi extends PublicApi {
  upstreamUrl: string;
  upstreamHeaderName: string | null;
  hasUpstreamSecret: boolean;
  timeoutMs: number | null;
  listed: boolean;
  ownershipVerified: boolean;
  ownershipVerification: { url: string; expectedContent: string };
}

export interface ApiCall {
  id: string;
  payerAddress: string;
  amount: string;
  charged: boolean;
  method: string;
  path: string;
  responseStatus: number;
  durationMs: number;
  createdAt: string;
}

export interface ApiStats {
  apiId: string;
  calls: number;
  chargedCalls: number;
  revenue: string;
  uniquePayers: number;
  avgDurationMs: number;
  currency: "USDC";
  recentCalls: ApiCall[];
}

export interface ApiInput {
  name?: string;
  description?: string | null;
  upstreamUrl?: string;
  price?: string;
  walletAddress?: string;
  allowedMethods?: HttpMethod[];
  upstreamHeader?: { name: string; value: string } | null;
  timeoutMs?: number | null;
  tags?: string[];
  listed?: boolean;
}

export interface RegisteredPublisher {
  id: string;
  name: string;
  email: string;
  walletAddress: string;
  apiKey: string;
}

/** Turn a server error body (string or zod format tree) into one readable line. */
function errorText(body: unknown, status: number): string {
  const error = (body as { error?: unknown } | null)?.error;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const messages: string[] = [];
    const walk = (node: unknown, path: string) => {
      if (!node || typeof node !== "object") return;
      const errs = (node as { _errors?: string[] })._errors;
      if (errs?.length) messages.push(path ? `${path}: ${errs.join(", ")}` : errs.join(", "));
      for (const [k, v] of Object.entries(node))
        if (k !== "_errors") walk(v, path ? `${path}.${k}` : k);
    };
    walk(error, "");
    if (messages.length) return messages.join("; ");
  }
  return `Request failed (HTTP ${status})`;
}

async function readJson<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(errorText(body, res.status));
  return body as T;
}

export async function fetchApis(q: string, signal?: AbortSignal): Promise<PublicApi[]> {
  const url = new URL(`${API_BASE}/apis`, window.location.origin);
  if (q.trim()) url.searchParams.set("q", q.trim());
  url.searchParams.set("limit", "100");
  return readJson(await fetch(url, { signal }));
}

export async function registerPublisher(input: {
  name: string;
  email: string;
  walletAddress: string;
}): Promise<RegisteredPublisher> {
  return readJson(
    await fetch(`${API_BASE}/publishers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }),
  );
}

function absolute(path: string): string {
  return new URL(`${API_BASE}${path}`, window.location.origin).toString();
}

export async function fetchMyApis(apiKey: string): Promise<OwnerApi[]> {
  return readJson(await signedPublisherFetch(absolute("/publishers/me/apis"), apiKey));
}

export async function createApi(apiKey: string, input: ApiInput): Promise<OwnerApi> {
  return readJson(
    await signedPublisherFetch(absolute("/apis"), apiKey, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  );
}

export async function updateApi(apiKey: string, id: string, input: ApiInput): Promise<OwnerApi> {
  return readJson(
    await signedPublisherFetch(absolute(`/apis/${id}`), apiKey, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  );
}

export async function verifyApiOwnership(apiKey: string, id: string): Promise<OwnerApi> {
  return readJson(
    await signedPublisherFetch(absolute(`/apis/${id}/verify-ownership`), apiKey, {
      method: "POST",
    }),
  );
}

export async function fetchApiStats(apiKey: string, id: string): Promise<ApiStats> {
  return readJson(await signedPublisherFetch(absolute(`/apis/${id}/stats`), apiKey));
}
