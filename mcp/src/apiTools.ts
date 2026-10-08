/**
 * Pay-per-call API tools.
 *
 * ZentrixPay providers sell access to their HTTP APIs one call at a time.
 * Each API has a proxy URL (`<server>/api/<id>`); a call is paid with x402 in
 * USDC on Stellar and forwarded to the provider. These tools let an agent find
 * APIs, call them (paying per call), and — as a provider — register and manage
 * its own APIs.
 *
 * Handlers are built from injected dependencies so this module does not import
 * index.ts (which owns wallet state, the paid fetch and HTTP plumbing).
 */

import type { ToolDefinition } from "./tools.js";

const API_ID = {
  type: "string",
  description: "The API id, from zentrixpay_list_apis or zentrixpay_my_apis.",
  examples: ["k3v9x2m1q8w7e6r5t4y3u2i1"],
};

const CONFIRM_PAID = {
  type: "boolean",
  description:
    "Confirm this USDC spend. Required only when ZENTRIXPAY_CONFIRM_PAID_OPERATIONS asks for confirmation.",
};

const CONFIRM_MAINNET = {
  type: "boolean",
  description:
    "Required on mainnet (or set ZENTRIXPAY_ALLOW_MAINNET=1). Explicitly confirm this action on the public Stellar network.",
};

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];

const API_FIELDS = {
  name: { type: "string", description: "Display name of the API.", examples: ["Weather API"] },
  description: { type: "string", description: "What the API does, shown in the catalog." },
  upstreamUrl: {
    type: "string",
    description:
      "Base URL of the real API. Calls to <proxyUrl>/<path> are forwarded to <upstreamUrl>/<path>. Never shown to callers.",
    examples: ["https://api.example.com/v1"],
  },
  price: {
    type: "string",
    description: "Price per call in USDC (max 7 decimals).",
    examples: ["0.01"],
  },
  walletAddress: {
    type: "string",
    description: "Stellar address that receives payments. Defaults to the publisher wallet.",
  },
  allowedMethods: {
    type: "array",
    items: { type: "string", enum: HTTP_METHODS },
    description: 'HTTP methods callers may use. Defaults to ["GET"].',
  },
  upstreamHeaderName: {
    type: "string",
    description:
      "Name of a secret header ZentrixPay adds to every forwarded call (e.g. your own API key header). Stored encrypted.",
    examples: ["x-api-key"],
  },
  upstreamHeaderValue: {
    type: "string",
    description: "Value for upstreamHeaderName. Never shown to callers.",
  },
  timeoutMs: {
    type: "integer",
    minimum: 1000,
    description: "Upstream timeout per call in milliseconds (capped by the server).",
  },
  tags: { type: "array", items: { type: "string" }, description: "Up to 10 catalog tags." },
};

export const API_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "zentrixpay_list_apis",
    description:
      "List pay-per-call APIs in the ZentrixPay catalog, newest first. Optional keyword search over name and description.",
    inputSchema: {
      type: "object",
      properties: {
        q: { type: "string", description: "Keyword to search for.", examples: ["weather"] },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 100,
          default: 20,
          description: "Maximum number of APIs to return.",
        },
        offset: {
          type: "integer",
          minimum: 0,
          default: 0,
          description: "Number of APIs to skip, for paging.",
        },
      },
      required: [],
    },
    annotations: {
      title: "List APIs",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  {
    name: "zentrixpay_api_info",
    description:
      "Show one API's details: price per call, allowed methods, payee wallet and proxy URL.",
    inputSchema: {
      type: "object",
      properties: { apiId: API_ID },
      required: ["apiId"],
    },
    annotations: {
      title: "API Info",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  {
    name: "zentrixpay_call",
    description:
      "Call a pay-per-call API, paying its per-call price in USDC via x402 from the agent wallet. The caller is not charged when the API returns an error (status >= 400) or times out. Calls above ZENTRIXPAY_MAX_AUTO_PAY_USDC need maxAutoPayUsdc.",
    inputSchema: {
      type: "object",
      properties: {
        apiId: API_ID,
        path: {
          type: "string",
          description: "Path under the API, appended to its base URL.",
          examples: ["/weather/lagos", "users/42"],
        },
        method: {
          type: "string",
          enum: HTTP_METHODS,
          default: "GET",
          description: "HTTP method. Must be one the API allows.",
        },
        query: {
          type: "object",
          additionalProperties: { type: "string" },
          description: "Query parameters to send.",
          examples: [{ units: "metric" }],
        },
        body: {
          type: ["object", "array", "string"],
          description: "Request body. Objects are sent as JSON; strings are sent as-is.",
        },
        headers: {
          type: "object",
          additionalProperties: { type: "string" },
          description: "Extra request headers for the API.",
        },
        maxAutoPayUsdc: {
          type: "string",
          description:
            "Per-call maximum automatic payment in USDC. Required when the price is above ZENTRIXPAY_MAX_AUTO_PAY_USDC.",
        },
        confirmPaid: CONFIRM_PAID,
        confirmMainnet: CONFIRM_MAINNET,
      },
      required: ["apiId"],
    },
    annotations: {
      title: "Call API (paid)",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
  },
  {
    name: "zentrixpay_register_api",
    description:
      "Register an API to sell per call (requires zentrixpay_register first). Returns the proxy URL and an ownership token: serve it at /.well-known/zentrixpay.txt on the upstream domain, then run zentrixpay_verify_api_ownership to list the API.",
    inputSchema: {
      type: "object",
      properties: { ...API_FIELDS, confirmMainnet: CONFIRM_MAINNET },
      required: ["name", "upstreamUrl", "price"],
    },
    annotations: {
      title: "Register API",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
  },
  {
    name: "zentrixpay_update_api",
    description:
      "Update one of your APIs: price, upstream, methods, secret header, tags, or listing (listed: false hides it from the catalog and stops calls). Pass removeUpstreamHeader: true to delete the secret header.",
    inputSchema: {
      type: "object",
      properties: {
        apiId: API_ID,
        ...API_FIELDS,
        removeUpstreamHeader: {
          type: "boolean",
          description: "Delete the stored secret header.",
        },
        listed: { type: "boolean", description: "List or unlist the API." },
        confirmMainnet: CONFIRM_MAINNET,
      },
      required: ["apiId"],
    },
    annotations: {
      title: "Update API",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  {
    name: "zentrixpay_verify_api_ownership",
    description:
      "Check that the upstream serves your ownership token at /.well-known/zentrixpay.txt and, if so, list the API in the catalog.",
    inputSchema: {
      type: "object",
      properties: { apiId: API_ID },
      required: ["apiId"],
    },
    annotations: {
      title: "Verify API Ownership",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  {
    name: "zentrixpay_my_apis",
    description:
      "List the APIs you registered, including unlisted ones, upstream URLs and ownership status.",
    inputSchema: { type: "object", properties: {}, required: [] },
    annotations: {
      title: "My APIs",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  {
    name: "zentrixpay_api_stats",
    description:
      "Usage and earnings for one of your APIs: total and charged calls, USDC revenue, unique payers, average latency and the 50 most recent calls.",
    inputSchema: {
      type: "object",
      properties: { apiId: API_ID },
      required: ["apiId"],
    },
    annotations: {
      title: "API Stats",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
];

export const API_TOOL_NAMES: ReadonlySet<string> = new Set(
  API_TOOL_DEFINITIONS.map((tool) => tool.name),
);

export interface ApiJsonResponse {
  ok: boolean;
  status: number;
  data: any;
}

export interface ApiToolDeps {
  baseUrl(): string;
  network(): string;
  jsonFetch(url: string, init?: RequestInit): Promise<ApiJsonResponse>;
  requireApiKey(): string;
  requireWallet(): { publicKey: string; secretKey: string };
  paidFetch(wallet: { publicKey: string; secretKey: string }): typeof fetch;
  assertWithinCeiling(price: string, maxAutoPayUsdc?: string): void;
  insufficientFundsMessage(
    wallet: { publicKey: string; secretKey: string },
    amount: string,
    action: string,
  ): Promise<string | null>;
  recordPurchase(input: {
    resourceId: string;
    amount: string;
    network: string;
    txHash: string | null;
    receiptRef: string | null;
    title?: string;
  }): void;
}

/** Bounded so a large API response cannot flood the agent's context. */
const MAX_BODY_CHARS = 20_000;

function str(args: Record<string, unknown>, key: string, required = false): string | undefined {
  const value = args[key];
  if (value === undefined || value === null || value === "") {
    if (required) throw new Error(`${key} is required`);
    return undefined;
  }
  if (typeof value !== "string") throw new Error(`${key} must be a string`);
  return value;
}

function apiId(args: Record<string, unknown>): string {
  const id = str(args, "apiId", true)!;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new Error("apiId has an invalid format");
  return id;
}

function stringMap(args: Record<string, unknown>, key: string): Record<string, string> {
  const value = args[key];
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value))
    throw new Error(`${key} must be an object`);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value)) out[k] = String(v);
  return out;
}

function serverError(operation: string, res: ApiJsonResponse): Error {
  const detail =
    typeof res.data === "object" && res.data?.error !== undefined
      ? typeof res.data.error === "string"
        ? res.data.error
        : JSON.stringify(res.data.error)
      : String(res.data).slice(0, 500);
  return new Error(`${operation} failed [${res.status}]: ${detail}`);
}

/** Copy only the API fields a tool call supplied into a request body. */
function apiBody(args: Record<string, unknown>): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const key of [
    "name",
    "description",
    "upstreamUrl",
    "price",
    "walletAddress",
    "allowedMethods",
    "timeoutMs",
    "tags",
    "listed",
  ]) {
    if (args[key] !== undefined) body[key] = args[key];
  }
  const headerName = str(args, "upstreamHeaderName");
  const headerValue = str(args, "upstreamHeaderValue");
  if (headerName || headerValue) {
    if (!headerName || !headerValue) {
      throw new Error("upstreamHeaderName and upstreamHeaderValue must be given together");
    }
    body.upstreamHeader = { name: headerName, value: headerValue };
  }
  if (args.removeUpstreamHeader === true) body.upstreamHeader = null;
  return body;
}

/** Transaction hash from an x402 PAYMENT-RESPONSE header, when present. */
function settlementTx(header: string | null): string | null {
  if (!header) return null;
  try {
    const decoded = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
    return typeof decoded?.transaction === "string" ? decoded.transaction : null;
  } catch {
    return null;
  }
}

function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function createApiToolHandler(deps: ApiToolDeps) {
  const authed = (init: RequestInit = {}): RequestInit => ({
    ...init,
    headers: { ...(init.headers as Record<string, string>), "x-api-key": deps.requireApiKey() },
  });

  async function getApi(id: string) {
    const res = await deps.jsonFetch(`${deps.baseUrl()}/apis/${encodeURIComponent(id)}`);
    if (!res.ok) throw serverError("API lookup", res);
    return res.data as {
      id: string;
      name: string;
      price: string;
      allowedMethods: string[];
      proxyUrl: string;
    };
  }

  async function call(args: Record<string, unknown>): Promise<string> {
    const id = apiId(args);
    const method = (str(args, "method") ?? "GET").toUpperCase();
    if (!HTTP_METHODS.includes(method))
      throw new Error(`method must be one of ${HTTP_METHODS.join(", ")}`);

    const api = await getApi(id);
    if (!api.allowedMethods.includes(method)) {
      throw new Error(
        `${api.name} does not accept ${method}; allowed: ${api.allowedMethods.join(", ")}`,
      );
    }
    deps.assertWithinCeiling(api.price, str(args, "maxAutoPayUsdc"));

    const wallet = deps.requireWallet();
    const short = await deps.insufficientFundsMessage(wallet, api.price, `call "${api.name}"`);
    if (short) return short;

    const path = (str(args, "path") ?? "").replace(/^\/+/, "");
    const url = new URL(`${api.proxyUrl}${path ? `/${path}` : ""}`);
    for (const [k, v] of Object.entries(stringMap(args, "query"))) url.searchParams.append(k, v);

    const headers = stringMap(args, "headers");
    let body: string | undefined;
    if (args.body !== undefined && args.body !== null) {
      if (typeof args.body === "string") {
        body = args.body;
      } else {
        body = JSON.stringify(args.body);
        if (!Object.keys(headers).some((h) => h.toLowerCase() === "content-type")) {
          headers["content-type"] = "application/json";
        }
      }
    }

    const res = await deps.paidFetch(wallet)(url.toString(), { method, headers, body });
    const text = await res.text();
    const charged = res.status < 400;
    const txHash = settlementTx(
      res.headers.get("payment-response") ?? res.headers.get("x-payment-response"),
    );

    if (charged) {
      deps.recordPurchase({
        resourceId: api.id,
        amount: api.price,
        network: deps.network(),
        txHash,
        receiptRef: null,
        title: api.name,
      });
    }

    return json({
      api: { id: api.id, name: api.name },
      request: { method, url: url.toString() },
      status: res.status,
      charged,
      amount: charged ? `${api.price} USDC` : "0 USDC (not charged: the call failed)",
      txHash,
      contentType: res.headers.get("content-type"),
      body:
        text.length > MAX_BODY_CHARS
          ? `${text.slice(0, MAX_BODY_CHARS)}\n…[truncated ${text.length - MAX_BODY_CHARS} chars]`
          : text,
    });
  }

  return async function handle(name: string, args: Record<string, unknown>): Promise<string> {
    // Same contract as the generic validator: an argument the schema does not
    // advertise is an error, not something to silently ignore.
    const known = API_TOOL_DEFINITIONS.find((t) => t.name === name)?.inputSchema.properties ?? {};
    const unknown = Object.keys(args).filter((key) => !(key in known));
    if (unknown.length > 0) {
      throw new Error(
        `Invalid arguments for ${name}: ${unknown.join(", ")} is not a recognized argument`,
      );
    }
    const base = deps.baseUrl();
    switch (name) {
      case "zentrixpay_list_apis": {
        const url = new URL(`${base}/apis`);
        for (const key of ["q", "limit", "offset"]) {
          if (args[key] !== undefined) url.searchParams.set(key, String(args[key]));
        }
        const res = await deps.jsonFetch(url.toString());
        if (!res.ok) throw serverError("Listing APIs", res);
        return json(res.data);
      }
      case "zentrixpay_api_info":
        return json(await getApi(apiId(args)));
      case "zentrixpay_call":
        return call(args);
      case "zentrixpay_register_api": {
        const res = await deps.jsonFetch(
          `${base}/apis`,
          authed({ method: "POST", body: JSON.stringify(apiBody(args)) }),
        );
        if (!res.ok) throw serverError("Registering API", res);
        return json(res.data);
      }
      case "zentrixpay_update_api": {
        const res = await deps.jsonFetch(
          `${base}/apis/${encodeURIComponent(apiId(args))}`,
          authed({ method: "PATCH", body: JSON.stringify(apiBody(args)) }),
        );
        if (!res.ok) throw serverError("Updating API", res);
        return json(res.data);
      }
      case "zentrixpay_verify_api_ownership": {
        const res = await deps.jsonFetch(
          `${base}/apis/${encodeURIComponent(apiId(args))}/verify-ownership`,
          authed({ method: "POST" }),
        );
        if (!res.ok) throw serverError("Ownership verification", res);
        return json(res.data);
      }
      case "zentrixpay_my_apis": {
        const res = await deps.jsonFetch(`${base}/publishers/me/apis`, authed());
        if (!res.ok) throw serverError("Listing your APIs", res);
        return json(res.data);
      }
      case "zentrixpay_api_stats": {
        const res = await deps.jsonFetch(
          `${base}/apis/${encodeURIComponent(apiId(args))}/stats`,
          authed(),
        );
        if (!res.ok) throw serverError("Loading API stats", res);
        return json(res.data);
      }
      default:
        throw new Error(`Unknown API tool: ${name}`);
    }
  };
}
