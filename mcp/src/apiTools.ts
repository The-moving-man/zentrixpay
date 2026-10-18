import { describe, expect, it, vi } from "vitest";
import {
  createApiToolHandler,
  type ApiToolDeps,
  type ApiToolDefinition,
} from "./apiTools.js";

/**
 * Handler-level tests for the pay-per-call tools.
 *
 * These complement the dispatcher-level integration test by exercising
 * `createApiToolHandler` directly with injected dependencies, so we can assert
 * on the exact guard behavior (method allow-list, auto-pay ceiling, funds
 * short-circuit, mainnet / paid-confirmation guards) and on the side effects
 * (purchase recording, settlement tx hash) without going through the network.
 */

import type { ToolDefinition } from "./tools.js";
import { assertWithinSessionSpendLimit, recordSessionSpend } from "./paymentCeiling.js";
import { ZENTRIXPAY_CALL_OUTPUT_SCHEMA } from "./outputSchemas.js";

const API_ID = {
  type: "string",
  description: "The API id, from zentrixpay_list_apis or zentrixpay_my_apis.",
  examples: ["k3v9x2m1q8w7e6r5t4y3u2i1"],
};

function makeDeps(overrides: Partial<ApiToolDeps> = {}): ApiToolDeps {
  const deps: ApiToolDeps = {
    fetch: vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({ result: "ok" }),
      text: async () => JSON.stringify({ result: "ok" }),
    })) as unknown as ApiToolDeps["fetch"],
    getBalanceUsdc: vi.fn(async () => 1),
    pay: vi.fn(async () => ({ txHash: "0xsettlement" })),
    recordPurchase: vi.fn(async () => undefined),
    isMainnet: false,
    confirmPaidCall: undefined,
    ...overrides,
  };
  return deps;
}

describe("createApiToolHandler / zentrixpay_call", () => {
  it("rejects a method not allowed by the API", async () => {
    const deps = makeDeps();
    const handler = createApiToolHandler(TOOL, deps);

    const result = await handler({ method: "DELETE" });

    expect(result.isError).toBe(true);
    expect(String(result.content)).toMatch(/method/i);
    expect(deps.fetch).not.toHaveBeenCalled();
    expect(deps.pay).not.toHaveBeenCalled();
    expect(deps.recordPurchase).not.toHaveBeenCalled();
  });

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
        dryRun: {
          type: "boolean",
          description:
            "When true, resolve the request (URL, method, price) and return a preview without making any paid call or spending USDC.",
        },
        confirmPaid: CONFIRM_PAID,
        confirmMainnet: CONFIRM_MAINNET,
      },
      required: ["apiId"],
    },
    outputSchema: ZENTRIXPAY_CALL_OUTPUT_SCHEMA as unknown as Record<string, unknown>,
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

    const result = await handler({ method: "POST" });

    expect(result.isError).toBe(true);
    expect(String(result.content)).toMatch(/ceiling|max/i);
    expect(deps.fetch).not.toHaveBeenCalled();
    expect(deps.pay).not.toHaveBeenCalled();
    expect(deps.recordPurchase).not.toHaveBeenCalled();
  });

  it("short-circuits when funds are insufficient", async () => {
    const deps = makeDeps({
      getBalanceUsdc: vi.fn(async () => 0.01),
    });
    const handler = createApiToolHandler(TOOL, deps);

    const result = await handler({ method: "POST" });

/**
 * Binary content-type prefixes and patterns that should not be decoded as text.
 * When matched, `call()` returns size, type and a base64 payload instead of
 * attempting to render the raw bytes as a string (#101).
 */
const BINARY_CONTENT_TYPE_PATTERNS = [
  /^image\//,
  /^audio\//,
  /^video\//,
  /^application\/pdf/,
  /^application\/zip/,
  /^application\/gzip/,
  /^application\/octet-stream/,
  /^application\/x-tar/,
  /^application\/x-bzip/,
  /^application\/wasm/,
  /^font\//,
];

/** Returns true when `contentType` signals binary (non-text) content. */
function isBinaryContentType(contentType: string | null): boolean {
  if (!contentType) return false;
  const ct = contentType.toLowerCase().split(";")[0].trim();
  return BINARY_CONTENT_TYPE_PATTERNS.some((p) => p.test(ct));
}

function str(args: Record<string, unknown>, key: string, required = false): string | undefined {
  const value = args[key];
  if (value === undefined || value === null || value === "") {
    if (required) throw new Error(`${key} is required`);
    return undefined;
  }
  if (typeof value !== "string") throw new Error(`${key} must be a string`);
  return value;
}

  it("performs a successful paid call and records the purchase with the settlement tx hash", async () => {
    const deps = makeDeps();
    const handler = createApiToolHandler(TOOL, deps);

    const result = await handler({ method: "POST", body: { foo: "bar" } });

    expect(result.isError).toBeFalsy();
    expect(deps.fetch).toHaveBeenCalledTimes(1);
    expect(deps.pay).toHaveBeenCalledTimes(1);
    expect(deps.recordPurchase).toHaveBeenCalledTimes(1);

    const purchaseArg = (deps.recordPurchase as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(purchaseArg).toMatchObject({
      tool: "zentrixpay_call",
      txHash: "0xsettlement",
    });
  });

  it("does not charge or record a purchase when the upstream call fails (>=400)", async () => {
    const deps = makeDeps({
      fetch: vi.fn(async () => ({
        ok: false,
        status: 500,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({ error: "boom" }),
        text: async () => JSON.stringify({ error: "boom" }),
      })) as unknown as ApiToolDeps["fetch"],
    });
    const handler = createApiToolHandler(TOOL, deps);

    const result = await handler({ method: "POST" });

    expect(result.isError).toBe(true);
    expect(deps.pay).not.toHaveBeenCalled();
    expect(deps.recordPurchase).not.toHaveBeenCalled();
  });

  it("rejects unknown arguments", async () => {
    const deps = makeDeps();
    const handler = createApiToolHandler(TOOL, deps);

    const result = await handler({ method: "POST", bogus: true });

    const api = await getApi(id);
    if (!api.allowedMethods.includes(method)) {
      throw new Error(
        `${api.name} does not accept ${method}; allowed: ${api.allowedMethods.join(", ")}`,
      );
    }

    const path = (str(args, "path") ?? "").replace(/^\/+/, "");
    const url = new URL(`${api.proxyUrl}${path ? `/${path}` : ""}`);
    for (const [k, v] of Object.entries(stringMap(args, "query"))) url.searchParams.append(k, v);

    // Dry-run: return the resolved request details and price without paying.
    if (args.dryRun === true) {
      return json({
        dryRun: true,
        api: { id: api.id, name: api.name },
        request: { method, url: url.toString() },
        price: `${api.price} USDC`,
        note: "No payment was made. Pass dryRun: false (or omit it) to execute the call.",
      });
    }

    deps.assertWithinCeiling(api.price, str(args, "maxAutoPayUsdc"));
    assertWithinSessionSpendLimit({ price: api.price });

  it("blocks paid calls on mainnet without explicit confirmation", async () => {
    const deps = makeDeps({ isMainnet: true });
    const handler = createApiToolHandler(TOOL, deps);

    const result = await handler({ method: "POST" });

    expect(result.isError).toBe(true);
    expect(String(result.content)).toMatch(/mainnet|confirm/i);
    expect(deps.pay).not.toHaveBeenCalled();
    expect(deps.recordPurchase).not.toHaveBeenCalled();
  });

    const res = await deps.paidFetch(wallet)(url.toString(), { method, headers, body });
    const contentType = res.headers.get("content-type");
    const charged = res.status < 400;
    const txHash = settlementTx(
      res.headers.get("payment-response") ?? res.headers.get("x-payment-response"),
    );

    let bodyPayload: unknown;
    if (isBinaryContentType(contentType)) {
      // Binary response: return size, type and base64 instead of raw bytes (#101).
      const buffer = await res.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      const base64 = Buffer.from(bytes).toString("base64");
      bodyPayload = {
        encoding: "base64",
        sizeBytes: bytes.byteLength,
        data:
          base64.length > MAX_BODY_CHARS
            ? `${base64.slice(0, MAX_BODY_CHARS)}…[truncated ${base64.length - MAX_BODY_CHARS} base64 chars]`
            : base64,
      };
    } else {
      const text = await res.text();
      bodyPayload =
        text.length > MAX_BODY_CHARS
          ? `${text.slice(0, MAX_BODY_CHARS)}\n…[truncated ${text.length - MAX_BODY_CHARS} chars]`
          : text;
    }

    if (charged) {
      deps.recordPurchase({
        resourceId: api.id,
        amount: api.price,
        network: deps.network(),
        txHash,
        receiptRef: null,
        title: api.name,
      });
      recordSessionSpend(api.price);
    }

    return json({
      api: { id: api.id, name: api.name },
      request: { method, url: url.toString() },
      status: res.status,
      charged,
      amount: charged ? `${api.price} USDC` : "0 USDC (not charged: the call failed)",
      txHash,
      contentType,
      body: bodyPayload,
    });
  }

  it("allows a paid call on mainnet once the paid-confirmation guard approves", async () => {
    const confirmPaidCall = vi.fn(async () => true);
    const deps = makeDeps({ isMainnet: true, confirmPaidCall });
    const handler = createApiToolHandler(TOOL, deps);

    const result = await handler({ method: "POST" });

    expect(result.isError).toBeFalsy();
    expect(confirmPaidCall).toHaveBeenCalled();
    expect(deps.pay).toHaveBeenCalledTimes(1);
    expect(deps.recordPurchase).toHaveBeenCalledTimes(1);
  });
});