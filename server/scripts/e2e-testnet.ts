import { spawn, ChildProcess } from "child_process";
import * as http from "http";
import * as path from "path";
import * as fs from "fs";
import { Address, Keypair, Networks, TransactionBuilder, Operation, Asset, Account, Horizon } from "@stellar/stellar-sdk";

/**
 * End-to-end testnet test of the pay-per-call flow.
 *
 * This script exercises the full proxy flow against Stellar testnet with a real
 * facilitator payment:
 *   1. Starts a mock upstream HTTP server.
 *   2. Starts the proxy server.
 *   3. Registers a provider and an API via the /apis management endpoints.
 *   4. Serves the expected `zentrixpay-verification` line from the mock upstream
 *      at /.well-known/zentrixpay.txt.
 *   5. Verifies ownership via POST /apis/:id/verify-ownership.
 *   6. Performs a paid call through /api/:id using a funded Stellar testnet
 *      wallet (signing the x402 payment).
 *   7. Asserts GET /apis/:id/stats reflects the call and revenue.
 *
 * Required environment variables (secrets):
 *   TESTNET_WALLET_SECRET  - Stellar secret key (S...) of a funded testnet wallet
 *                            used to pay for the call. Must hold testnet XLM/USDC.
 *   FACILITATOR_URL        - Base URL of the x402 facilitator used to settle payments.
 *   BASE_URL               - Base URL of the proxy server under test
 *                            (default: http://127.0.0.1:3000).
 *
 * Optional environment variables:
 *   HORIZON_URL            - Stellar Horizon URL (default: https://horizon-testnet.stellar.org).
 *   NETWORK_PASSPHRASE     - Stellar network passphrase (default: testnet).
 *   PROVIDER_WALLET        - Stellar public key (G...) that receives the payment.
 *                            Defaults to the paying wallet's public key.
 *   PORT                   - Port for the proxy server (default: 3000).
 *   MOCK_UPSTREAM_PORT     - Port for the mock upstream server (default: 4100).
 *   SERVER_START_CMD       - Command used to start the proxy server
 *                            (default: `npm run start`).
 *   SERVER_CWD             - Working directory for the proxy server
 *                            (default: repository root, i.e. the parent of server/).
 *   API_PRICE              - Price per call in the smallest unit (default: 1000000 = 0.1 USDC).
 *   API_ASSET              - Asset code for the API (default: USDC).
 *   SKIP_SERVER_START      - If "1", assume the proxy server is already running at BASE_URL.
 *   SKIP_UPSTREAM_START    - If "1", assume the mock upstream is already running.
 *
 * Usage:
 *   TESTNET_WALLET_SECRET=S... FACILITATOR_URL=https://... BASE_URL=http://127.0.0.1:3000 \
 *     npx ts-node server/scripts/e2e-testnet.ts
 */

const BASE_URL = (process.env.BASE_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
const HORIZON_URL = process.env.HORIZON_URL || "https://horizon-testnet.stellar.org";
const NETWORK_PASSPHRASE = process.env.NETWORK_PASSPHRASE || Networks.TESTNET;
const PORT = parseInt(process.env.PORT || "3000", 10);
const MOCK_UPSTREAM_PORT = parseInt(process.env.MOCK_UPSTREAM_PORT || "4100", 10);
const SERVER_START_CMD = process.env.SERVER_START_CMD || "npm run start";
const SERVER_CWD =
  process.env.SERVER_CWD || path.resolve(__dirname, "..", "..");
const API_PRICE = process.env.API_PRICE || "1000000";
const API_ASSET = process.env.API_ASSET || "USDC";
const SKIP_SERVER_START = process.env.SKIP_SERVER_START === "1";
const SKIP_UPSTREAM_START = process.env.SKIP_UPSTREAM_START === "1";

const VERIFICATION_PATH = "/.well-known/zentrixpay.txt";

interface RegistrationResponse {
  id: string;
  ownershipToken?: string;
  ownership_token?: string;
  verificationToken?: string;
  verification_token?: string;
  [key: string]: unknown;
}

interface StatsResponse {
  calls?: number;
  totalCalls?: number;
  total_calls?: number;
  revenue?: number | string;
  totalRevenue?: number | string;
  total_revenue?: number | string;
  [key: string]: unknown;
}

let serverProcess: ChildProcess | null = null;
let upstreamServer: http.Server | null = null;

function log(msg: string): void {
  // eslint-disable-next-line no-console
  console.log(`[e2e-testnet] ${msg}`);
}

function fail(msg: string): never {
  // eslint-disable-next-line no-console
  console.error(`[e2e-testnet] FAIL: ${msg}`);
  process.exit(1);
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    fail(
      `Missing required environment variable ${name}. See the header comment in this script for documentation.`
    );
  }
  return value as string;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHttp(url: string, timeoutMs = 30000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown = null;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { method: "GET" });
      if (res.status < 500) {
        return;
      }
      lastErr = new Error(`status ${res.status}`);
    } catch (err) {
      lastErr = err;
    }
    await sleep(500);
  }
  fail(`Timed out waiting for ${url} to become available: ${String(lastErr)}`);
}

async function startMockUpstream(verificationLine: string): Promise<void> {
  if (SKIP_UPSTREAM_START) {
    log("Skipping mock upstream start (SKIP_UPSTREAM_START=1)");
    return;
  }

  upstreamServer = http.createServer((req, res) => {
    const url = req.url || "/";
    if (url === VERIFICATION_PATH) {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end(verificationLine);
      return;
    }
    // Default upstream response for proxied calls.
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, path: url, method: req.method }));
  });

  await new Promise<void>((resolve, reject) => {
    upstreamServer!.once("error", reject);
    upstreamServer!.listen(MOCK_UPSTREAM_PORT, "127.0.0.1", () => resolve());
  });

  log(`Mock upstream listening on http://127.0.0.1:${MOCK_UPSTREAM_PORT}`);
}

async function startServer(): Promise<void> {
  if (SKIP_SERVER_START) {
    log("Skipping server start (SKIP_SERVER_START=1)");
    return;
  }

  log(`Starting proxy server: ${SERVER_START_CMD} (cwd=${SERVER_CWD})`);
  const [cmd, ...args] = SERVER_START_CMD.split(" ");
  serverProcess = spawn(cmd, args, {
    cwd: SERVER_CWD,
    env: {
      ...process.env,
      PORT: String(PORT),
      FACILITATOR_URL: process.env.FACILITATOR_URL,
    },
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  serverProcess.on("exit", (code) => {
    if (code !== 0 && code !== null) {
      // eslint-disable-next-line no-console
      console.error(`[e2e-testnet] server exited with code ${code}`);
    }
  });
}

async function registerProviderAndApi(
  providerWallet: string,
  upstreamUrl: string
): Promise<RegistrationResponse> {
  const providerRes = await fetch(`${BASE_URL}/apis/providers`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: `e2e-provider-${Date.now()}`,
      wallet: providerWallet,
    }),
  });

  if (!providerRes.ok) {
    fail(
      `Failed to register provider: ${providerRes.status} ${await providerRes.text()}`
    );
  }
  const provider = (await providerRes.json()) as RegistrationResponse;
  log(`Registered provider ${provider.id}`);

  const apiRes = await fetch(`${BASE_URL}/apis`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      providerId: provider.id,
      name: `e2e-api-${Date.now()}`,
      upstreamUrl,
      price: API_PRICE,
      asset: API_ASSET,
    }),
  });

  if (!apiRes.ok) {
    fail(`Failed to register API: ${apiRes.status} ${await apiRes.text()}`);
  }
  const api = (await apiRes.json()) as RegistrationResponse;
  log(`Registered API ${api.id}`);

  return api;
}

function extractOwnershipToken(api: RegistrationResponse): string {
  const token =
    api.ownershipToken ||
    api.ownership_token ||
    api.verificationToken ||
    api.verification_token;
  if (!token) {
    fail(
      `Registration response did not include an ownership token: ${JSON.stringify(
        api
      )}`
    );
  }
  return token as string;
}

async function verifyOwnership(apiId: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/apis/${apiId}/verify-ownership`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });

  if (!res.ok) {
    fail(
      `Ownership verification failed: ${res.status} ${await res.text()}`
    );
  }
  log(`Ownership verified for API ${apiId}`);
}

async function fetchStats(apiId: string): Promise<StatsResponse> {
  const res = await fetch(`${BASE_URL}/apis/${apiId}/stats`);
  if (!res.ok) {
    fail(`Failed to fetch stats: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as StatsResponse;
}

function getCalls(stats: StatsResponse): number {
  const value = stats.calls ?? stats.totalCalls ?? stats.total_calls ?? 0;
  return typeof value === "string" ? parseInt(value, 10) : value;
}

function getRevenue(stats: StatsResponse): number {
  const value =
    stats.revenue ?? stats.totalRevenue ?? stats.total_revenue ?? 0;
  return typeof value === "string" ? parseFloat(value) : value;
}

/**
 * Build and sign an x402 payment for the given API call.
 *
 * The proxy is expected to respond with HTTP 402 and an x402 payment
 * requirement. We parse the requirement, construct a Stellar payment
 * transaction, sign it with the funded testnet wallet, and retry the request
 * with the signed payment attached.
 */
async function paidCall(
  apiId: string,
  payer: Keypair,
  providerWallet: string
): Promise<Response> {
  const callUrl = `${BASE_URL}/api/${apiId}`;

  // Initial request: expect a 402 with payment requirements.
  const initial = await fetch(callUrl, { method: "GET" });
  if (initial.status !== 402) {
    fail(
      `Expected HTTP 402 from paid endpoint, got ${initial.status}: ${await initial.text()}`
    );
  }

  const bodyText = await initial.text();
  let requirement: any;
  try {
    requirement = JSON.parse(bodyText);
  } catch {
    fail(`402 response was not valid JSON: ${bodyText}`);
  }

  // x402 payment requirement may be nested under `accepts` or `payment`.
  const accepts =
    requirement.accepts?.[0] ||
    requirement.payment ||
    requirement.requirements ||
    requirement;

  const amount: string =
    accepts.maxAmountRequired ||
    accepts.amount ||
    accepts.price ||
    API_PRICE;
  const asset: string =
    accepts.asset || accepts.assetCode || API_ASSET;
  const payTo: string =
    accepts.payTo || accepts.pay_to || accepts.address || providerWallet;

  log(
    `Payment requirement: amount=${amount} asset=${asset} payTo=${payTo}`
  );

  const horizon = new Horizon.Server(HORIZON_URL);
  const sourceAccount = await horizon.loadAccount(payer.publicKey());

  const isNative = asset === "XLM" || asset === "native";
  const paymentAsset = isNative
    ? Asset.native()
    : new Asset(asset, accepts.assetIssuer || accepts.asset_issuer);

  const tx = new TransactionBuilder(
    new Account(sourceAccount.accountId(), sourceAccount.sequenceNumber()),
    {
      fee: "100000",
      networkPassphrase: NETWORK_PASSPHRASE,
    }
  )
    .addOperation(
      Operation.payment({
        destination: payTo,
        asset: paymentAsset,
        amount: normalizeAmount(amount, isNative),
      })
    )
    .addMemo(
      // Include the API id so the facilitator can correlate the payment.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      require("@stellar/stellar-sdk").Memo.text(`api:${apiId}`.slice(0, 28))
    )
    .setTimeout(180)
    .build();

  tx.sign(payer);
  const signedXdr = tx.toXDR();

  // Retry the call with the signed x402 payment.
  const paid = await fetch(callUrl, {
    method: "GET",
    headers: {
      "X-PAYMENT": signedXdr,
      "X-Payment": signedXdr,
      "Content-Type": "application/json",
    },
  });

  if (!paid.ok) {
    fail(
      `Paid call failed: ${paid.status} ${await paid.text()}`
    );
  }

  log(`Paid call succeeded with status ${paid.status}`);
  return paid;
}

function normalizeAmount(amount: string, isNative: boolean): string {
  // Stellar amounts are decimal strings with up to 7 decimal places.
  const numeric = Number(amount);
  if (!Number.isFinite(numeric)) {
    fail(`Invalid payment amount: ${amount}`);
  }
  if (isNative) {
    // If the amount looks like stroops (>= 1e6), convert to XLM.
    if (numeric >= 1_000_000) {
      return (numeric / 10_000_000).toFixed(7);
    }
    return numeric.toFixed(7);
  }
  // For issued assets, assume the amount is already in the asset's smallest
  // unit and convert using 7 decimals.
  return (numeric / 10_000_000).toFixed(7);
}

async function main(): Promise<void> {
  const walletSecret = requireEnv("TESTNET_WALLET_SECRET");
  requireEnv("FACILITATOR_URL");

  const payer = Keypair.fromSecret(walletSecret);
  const providerWallet = process.env.PROVIDER_WALLET || payer.publicKey();

  log(`Payer wallet: ${payer.publicKey()}`);
  log(`Provider wallet: ${providerWallet}`);
  log(`Base URL: ${BASE_URL}`);
  log(`Facilitator URL: ${process.env.FACILITATOR_URL}`);

  const upstreamUrl = `http://127.0.0.1:${MOCK_UPSTREAM_PORT}`;

  // The ownership token is generated by the server during registration, but the
  // mock upstream must serve it at /.well-known/zentrixpay.txt. We therefore
  // start the upstream lazily once we know the token.
  let verificationLine = "";
  const upstreamHandler = (req: http.IncomingMessage, res: http.ServerResponse) => {
    const url = req.url || "/";
    if (url === VERIFICATION_PATH) {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end(verificationLine);
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, path: url, method: req.method }));
  };

  if (!SKIP_UPSTREAM_START) {
    upstreamServer = http.createServer(upstreamHandler);
    await new Promise<void>((resolve, reject) => {
      upstreamServer!.once("error", reject);
      upstreamServer!.listen(MOCK_UPSTREAM_PORT, "127.0.0.1", () => resolve());
    });
    log(`Mock upstream listening on ${upstreamUrl}`);
  }

  await startServer();
  await waitForHttp(`${BASE_URL}/health`).catch(async () => {
    // Fall back to the root path if /health is not implemented.
    await waitForHttp(`${BASE_URL}/`);
  });

  const api = await registerProviderAndApi(providerWallet, upstreamUrl);
  const ownershipToken = extractOwnershipToken(api);

  // Serve the ownership token from the mock upstream.
  verificationLine = `zentrixpay-verification: ${ownershipToken}`;
  log(`Serving ownership token at ${upstreamUrl}${VERIFICATION_PATH}`);

  await verifyOwnership(api.id);

  const statsBefore = await fetchStats(api.id);
  const callsBefore = getCalls(statsBefore);
  const revenueBefore = getRevenue(statsBefore);
  log(
    `Stats before call: calls=${callsBefore} revenue=${revenueBefore}`
  );

  await paidCall(api.id, payer, providerWallet);

  // Allow the server a moment to persist stats.
  await sleep(2000);

  const statsAfter = await fetchStats(api.id);
  const callsAfter = getCalls(statsAfter);
  const revenueAfter = getRevenue(statsAfter);
  log(`Stats after call: calls=${callsAfter} revenue=${revenueAfter}`);

  if (callsAfter <= callsBefore) {
    fail(
      `Expected call count to increase (before=${callsBefore}, after=${callsAfter})`
    );
  }
  if (revenueAfter <= revenueBefore) {
    fail(
      `Expected revenue to increase (before=${revenueBefore}, after=${revenueAfter})`
    );
  }

  log("E2E testnet test PASSED");
}

function cleanup(): void {
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill("SIGTERM");
  }
  if (upstreamServer) {
    upstreamServer.close();
  }
}

process.on("exit", cleanup);
process.on("SIGINT", () => {
  cleanup();
  process.exit(130);
});
process.on("SIGTERM", () => {
  cleanup();
  process.exit(143);
});

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(`[e2e-testnet] Unexpected error:`, err);
  cleanup();
  process.exit(1);
});

// Silence unused import warnings for helpers that may be conditionally used.
void Address;
void fs;