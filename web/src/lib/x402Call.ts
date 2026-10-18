import { x402Client, wrapFetchWithPayment, decodePaymentResponseHeader } from "@x402/fetch";
import { ExactStellarScheme } from "@x402/stellar";
import type { PaymentRequirements, PaymentResponse } from "@x402/core/types";

/**
 * Network identifier for Stellar testnet, as expected by @x402/stellar.
 */
export const x402Network = "stellar:testnet";

/**
 * Result of an x402-paid HTTP call.
 */
export interface X402CallResult {
  /** HTTP status code of the final response. */
  status: number;
  /** Response headers, lower-cased. */
  headers: Record<string, string>;
  /** Parsed JSON body, or raw text if the body is not JSON. */
  body: unknown;
  /** Decoded payment response header, if the server returned one. */
  payment?: PaymentResponse;
}

/**
 * Build an x402 client that can pay Stellar testnet payment requirements
 * using the provided secret key.
 */
export function createX402Client(secretKey: string): x402Client {
  const client = new x402Client({
    network: x402Network,
    schemes: [new ExactStellarScheme({ secretKey })],
  });
  return client;
}

/**
 * Normalize a base URL plus path/query into a single absolute URL string.
 *
 * - Joins the base and path with exactly one slash.
 * - Preserves any query string already present on the path.
 * - Leaves absolute URLs untouched.
 */
export function callUrl(baseUrl: string, path: string, query?: Record<string, string | number | boolean>): string {
  const isAbsolute = /^https?:\/\//i.test(path);
  const base = baseUrl.replace(/\/+$/, "");
  const suffix = path.replace(/^\/+/, "");
  let url = isAbsolute ? path : `${base}/${suffix}`;

  if (query && Object.keys(query).length > 0) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      params.append(key, String(value));
    }
    const separator = url.includes("?") ? "&" : "?";
    url = `${url}${separator}${params.toString()}`;
  }

  return url;
}

/**
 * Perform an x402-paid HTTP request against a ZentrixPay API endpoint.
 *
 * For non-GET requests a JSON body is sent with a matching Content-Type
 * header. GET requests are sent without a body or Content-Type.
 */
export async function x402Call(
  client: x402Client,
  baseUrl: string,
  path: string,
  options: {
    method?: string;
    query?: Record<string, string | number | boolean>;
    body?: unknown;
    headers?: Record<string, string>;
  } = {},
): Promise<X402CallResult> {
  const method = (options.method ?? "GET").toUpperCase();
  const url = callUrl(baseUrl, path, options.query);

  const headers: Record<string, string> = { ...(options.headers ?? {}) };
  let body: string | undefined;

  if (method !== "GET" && options.body !== undefined) {
    headers["Content-Type"] = headers["Content-Type"] ?? "application/json";
    body = typeof options.body === "string" ? options.body : JSON.stringify(options.body);
  }

  const fetchWithPayment = wrapFetchWithPayment(fetch, client);

  const response = await fetchWithPayment(url, {
    method,
    headers,
    body,
  });

  const responseHeaders: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    responseHeaders[key.toLowerCase()] = value;
  });

  const paymentHeader = response.headers.get("x-payment-response");
  const payment = paymentHeader ? decodePaymentResponseHeader(paymentHeader) : undefined;

  const text = await response.text();
  let parsed: unknown = text;
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json") && text.length > 0) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }

  return {
    status: response.status,
    headers: responseHeaders,
    body: parsed,
    payment,
  };
}

/**
 * Convenience helper: create a client from a secret key and immediately
 * perform a paid call.
 */
export async function x402CallWithSecret(
  secretKey: string,
  baseUrl: string,
  path: string,
  options: {
    method?: string;
    query?: Record<string, string | number | boolean>;
    body?: unknown;
    headers?: Record<string, string>;
  } = {},
): Promise<X402CallResult> {
  const client = createX402Client(secretKey);
  return x402Call(client, baseUrl, path, options);
}

export type { PaymentRequirements, PaymentResponse };