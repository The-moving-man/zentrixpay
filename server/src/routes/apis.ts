import express, { Router, type Router as RouterType, type Request, type Response } from "express";
import { apiKeyAuth } from "../middleware/apiKeyAuth.js";
import { requestSignatureAuth } from "../middleware/requestSignatureAuth.js";
import { validate } from "../middleware/validate.js";
import { publishIpRateLimit, publishWalletRateLimit } from "../middleware/rateLimiters.js";
import { apiPaywall, loadProxiedApi } from "../middleware/apiPaywall.js";
import { apiCatalogQuerySchema, createApiSchema, updateApiSchema } from "../schemas/requests.js";
import {
  ApiServiceError,
  createApi,
  getApiById,
  getApiStats,
  getOwnedApi,
  listPublicApis,
  listPublisherApis,
  listRecentCalls,
  recordApiCall,
  toOwnerApi,
  toPublicApi,
  updateApi,
  verifyOwnership,
  type ApiRow,
} from "../services/apiService.js";
import { sendUpstream, UpstreamError } from "../lib/upstreamClient.js";
import { filterRequestHeaders, filterResponseHeaders } from "../lib/proxyHeaders.js";
import { parsePayerFromXPayment } from "../lib/parseXPayment.js";
import { decryptSecret } from "../utils/secretBox.js";
import { getLogger } from "../lib/logger.js";
import { config } from "../config.js";

const router: RouterType = Router();

function sendServiceError(res: Response, err: unknown): void {
  if (err instanceof ApiServiceError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  throw err;
}

// ── Management ────────────────────────────────────────────────────────────────

// POST /apis — register an API to sell per call (authenticated)
router.post(
  "/apis",
  apiKeyAuth,
  publishIpRateLimit,
  publishWalletRateLimit,
  requestSignatureAuth,
  validate(createApiSchema),
  async (req, res) => {
    const publisher = req.publisher!;
    try {
      const api = await createApi({
        ...req.body,
        publisherId: publisher.id,
        walletAddress: req.body.walletAddress ?? publisher.walletAddress,
      });
      const owner = toOwnerApi(api);
      res.status(201).json({
        ...owner,
        nextStep:
          `Serve "${owner.ownershipVerification.expectedContent}" at ` +
          `${owner.ownershipVerification.url}, then POST /apis/${api.id}/verify-ownership to list the API.`,
      });
    } catch (err) {
      sendServiceError(res, err);
    }
  },
);

// GET /apis — public catalog of listed APIs
router.get("/apis", async (req, res) => {
  const parsed = apiCatalogQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.format() });
    return;
  }
  res.json(await listPublicApis(parsed.data));
});

// GET /publishers/me/apis — the caller's own APIs, listed or not
router.get("/publishers/me/apis", apiKeyAuth, async (req, res) => {
  res.json(await listPublisherApis(req.publisher!.id));
});

// GET /apis/:id — public details of a listed API
router.get("/apis/:id", async (req, res) => {
  const api = await getApiById(req.params.id);
  if (!api || !api.listed) {
    res.status(404).json({ error: "API not found" });
    return;
  }
  res.json(toPublicApi(api));
});

// PATCH /apis/:id — update price, upstream, methods, secret header, listing (owner)
router.patch(
  "/apis/:id",
  apiKeyAuth,
  requestSignatureAuth,
  validate(updateApiSchema),
  async (req, res) => {
    try {
      const api = await getOwnedApi(req.params.id as string, req.publisher!.id);
      res.json(toOwnerApi(await updateApi(api, req.body)));
    } catch (err) {
      sendServiceError(res, err);
    }
  },
);

// POST /apis/:id/verify-ownership — check /.well-known/zentrixpay.txt, then list (owner)
router.post("/apis/:id/verify-ownership", apiKeyAuth, requestSignatureAuth, async (req, res) => {
  try {
    const api = await getOwnedApi(req.params.id as string, req.publisher!.id);
    res.json(toOwnerApi(await verifyOwnership(api)));
  } catch (err) {
    sendServiceError(res, err);
  }
});

// GET /apis/:id/stats — call counts, revenue and recent calls (owner)
router.get("/apis/:id/stats", apiKeyAuth, async (req, res) => {
  try {
    const api = await getOwnedApi(req.params.id as string, req.publisher!.id);
    const [totals, recentCalls] = await Promise.all([
      getApiStats(api.id),
      listRecentCalls(api.id, 50),
    ]);
    res.json({ apiId: api.id, ...totals, recentCalls });
  } catch (err) {
    sendServiceError(res, err);
  }
});

// ── Paid proxy ────────────────────────────────────────────────────────────────

/** Map /api/:id/<segments>?<query> onto the API's upstream URL. */
export function buildUpstreamUrl(
  upstreamUrl: string,
  segments: string[],
  originalUrl: string,
): URL | null {
  // Segments arrive decoded. Refuse anything that could climb out of the
  // upstream base path or smuggle a separator.
  if (segments.some((s) => s === "." || s === ".." || /[/\\]/.test(s))) return null;

  const base = new URL(upstreamUrl);
  const basePath = base.pathname.replace(/\/+$/, "");
  const subPath = segments.map(encodeURIComponent).join("/");
  const target = new URL(base.origin);
  target.pathname = subPath ? `${basePath}/${subPath}` : basePath || "/";

  const queryStart = originalUrl.indexOf("?");
  const requestQuery = queryStart === -1 ? "" : originalUrl.slice(queryStart + 1);
  target.search = [base.search.slice(1), requestQuery].filter(Boolean).join("&");
  return target;
}

function rewriteLocation(location: string, api: ApiRow): string {
  const base = api.upstreamUrl.replace(/\/+$/, "");
  return location.startsWith(base)
    ? `${config.BASE_URL}/api/${api.id}${location.slice(base.length)}`
    : location;
}

function payerFrom(req: Request): string {
  const header = req.headers["payment-signature"] ?? req.headers["x-payment"];
  if (typeof header !== "string") return "unknown";
  return parsePayerFromXPayment(header).payer ?? "unknown";
}

const UPSTREAM_ERROR_STATUS = { blocked: 502, network: 502, too_large: 502, timeout: 504 } as const;

async function proxyHandler(req: Request, res: Response) {
  const api = res.locals.api as ApiRow;
  const segments = (req.params.path as unknown as string[] | undefined) ?? [];
  const target = buildUpstreamUrl(api.upstreamUrl, segments, req.originalUrl);
  if (!target) {
    res.status(400).json({ error: "Invalid path" });
    return;
  }

  const headers = filterRequestHeaders(req.headers);
  if (api.upstreamHeaderName && api.upstreamHeaderValueEnc && config.UPSTREAM_SECRET_KEY) {
    headers[api.upstreamHeaderName] = decryptSecret(
      api.upstreamHeaderValueEnc,
      config.UPSTREAM_SECRET_KEY,
    );
  }
  const body = Buffer.isBuffer(req.body) && req.body.length > 0 ? req.body : undefined;

  const started = Date.now();
  // Recorded once the response (and settlement) is complete: a final status
  // below 400 means the x402 middleware settled the payment.
  res.on("finish", () => {
    recordApiCall({
      apiId: api.id,
      payerAddress: payerFrom(req),
      amount: api.price,
      charged: res.statusCode < 400,
      method: req.method,
      path:
        target.pathname.slice(new URL(api.upstreamUrl).pathname.replace(/\/+$/, "").length) || "/",
      responseStatus: res.statusCode,
      durationMs: Date.now() - started,
    }).catch((err) =>
      getLogger().error(
        { event: "api_call_record_failed", apiId: api.id, err },
        "failed to record API call",
      ),
    );
  });

  let upstream;
  try {
    upstream = await sendUpstream({
      url: target,
      method: req.method,
      headers,
      body,
      timeoutMs: api.timeoutMs ?? config.PROXY_DEFAULT_TIMEOUT_MS,
      maxResponseBytes: config.PROXY_MAX_RESPONSE_BYTES,
      allowPrivate: config.PROXY_ALLOW_PRIVATE_UPSTREAMS,
    });
  } catch (err) {
    if (err instanceof UpstreamError) {
      getLogger().warn(
        { event: "api_upstream_failed", apiId: api.id, kind: err.kind, error: err.message },
        "upstream call failed; caller not charged",
      );
      res
        .status(UPSTREAM_ERROR_STATUS[err.kind])
        .json({ error: "upstream_failed", reason: err.kind });
      return;
    }
    throw err;
  }

  res.status(upstream.status);
  for (const [name, value] of Object.entries(filterResponseHeaders(upstream.headers))) {
    res.setHeader(
      name,
      name === "location" && typeof value === "string" ? rewriteLocation(value, api) : value,
    );
  }
  // res.end, not res.send: send() would add an ETag and could turn the reply
  // into a bodiless 304 that still counts as a successful (charged) call.
  res.setHeader("Content-Length", String(upstream.body.length));
  res.end(upstream.body);
}

// ANY /api/:id[/*path] — one paid call to the provider's API
router.all(
  "/api/:id{/*path}",
  loadProxiedApi,
  express.raw({ type: () => true, limit: config.PROXY_MAX_REQUEST_BODY }),
  apiPaywall,
  proxyHandler,
);

export default router;
