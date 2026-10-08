import type { IncomingHttpHeaders } from "node:http";

// Header filtering for the API proxy, in both directions.

const HOP_BY_HOP = [
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
];

// Never forwarded to the provider: our own transport/auth/payment headers and
// anything that would let a caller spoof where the request came from.
const STRIP_REQUEST = new Set([
  ...HOP_BY_HOP,
  "host",
  "content-length",
  "cookie",
  "x-api-key",
  "x-payment",
  "payment-signature",
  "forwarded",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-real-ip",
]);

// Never passed back to the caller: hop-by-hop, cookies scoped to the provider,
// CORS (ours applies), and anything that could impersonate x402 headers.
const STRIP_RESPONSE = new Set([
  ...HOP_BY_HOP,
  "content-length",
  "set-cookie",
  "access-control-allow-origin",
  "access-control-allow-credentials",
  "access-control-allow-headers",
  "access-control-allow-methods",
  "access-control-expose-headers",
  "access-control-max-age",
  "payment-required",
  "payment-response",
  "x-payment-response",
]);

function namedInConnection(headers: IncomingHttpHeaders): Set<string> {
  const value = headers.connection;
  const raw = Array.isArray(value) ? value.join(",") : (value ?? "");
  return new Set(
    raw
      .split(",")
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function filterRequestHeaders(headers: IncomingHttpHeaders): Record<string, string> {
  const extra = namedInConnection(headers);
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    const key = name.toLowerCase();
    if (value === undefined || STRIP_REQUEST.has(key) || extra.has(key)) continue;
    out[key] = Array.isArray(value) ? value.join(", ") : value;
  }
  return out;
}

export function filterResponseHeaders(
  headers: IncomingHttpHeaders,
): Record<string, string | string[]> {
  const extra = namedInConnection(headers);
  const out: Record<string, string | string[]> = {};
  for (const [name, value] of Object.entries(headers)) {
    const key = name.toLowerCase();
    if (value === undefined || STRIP_RESPONSE.has(key) || extra.has(key)) continue;
    out[key] = value;
  }
  return out;
}
