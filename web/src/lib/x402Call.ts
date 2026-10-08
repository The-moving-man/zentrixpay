/**
 * Paid API calls from the browser.
 *
 * Wraps `fetch` with the x402 client so a call to an API's proxy URL that
 * returns 402 is retried with a Freighter-signed USDC payment. The server only
 * settles the payment when the API answers with a status below 400, so a
 * failed call costs nothing.
 */
import { decodePaymentResponseHeader, wrapFetchWithPayment, x402Client } from "@x402/fetch";
import type { Network } from "@x402/fetch";
import { ExactStellarScheme } from "@x402/stellar/exact/client";
import { networks } from "@zentrixpay/registry-client";
import { createFreighterSigner } from "./x402Buy.js";
import { explorerTxUrl } from "./stellarExplorer.js";

export interface ApiCallRequest {
  method: string;
  path: string;
  query: string;
  body: string;
  contentType: string;
}

export interface ApiCallResult {
  status: number;
  charged: boolean;
  contentType: string | null;
  body: string;
  durationMs: number;
  txHash?: string;
  explorerUrl?: string;
}

function preset() {
  const raw = (import.meta.env.VITE_STELLAR_NETWORK as string | undefined)?.trim().toLowerCase();
  return raw === "public" || raw === "mainnet" || raw === "pubnet"
    ? networks.mainnet
    : networks.testnet;
}

/** Build the full proxy URL for a path and raw query string. */
export function callUrl(proxyUrl: string, path: string, query: string): string {
  const cleanPath = path.trim().replace(/^\/+/, "");
  const cleanQuery = query.trim().replace(/^\?/, "");
  return `${proxyUrl}${cleanPath ? `/${cleanPath}` : ""}${cleanQuery ? `?${cleanQuery}` : ""}`;
}

export async function callPaidApi(
  proxyUrl: string,
  request: ApiCallRequest,
  payerAddress: string,
): Promise<ApiCallResult> {
  const { networkPassphrase, x402Network } = preset();
  const client = new x402Client().register(
    x402Network as Network,
    new ExactStellarScheme(createFreighterSigner(payerAddress, networkPassphrase)),
  );
  const paidFetch = wrapFetchWithPayment(fetch, client);

  const hasBody = request.method !== "GET" && request.body.trim() !== "";
  const started = performance.now();
  const res = await paidFetch(callUrl(proxyUrl, request.path, request.query), {
    method: request.method,
    headers: hasBody ? { "Content-Type": request.contentType } : undefined,
    body: hasBody ? request.body : undefined,
  });
  const body = await res.text();
  const durationMs = Math.round(performance.now() - started);

  let txHash: string | undefined;
  const settle = res.headers.get("payment-response") ?? res.headers.get("x-payment-response");
  if (settle) {
    try {
      txHash = decodePaymentResponseHeader(settle)?.transaction || undefined;
    } catch {
      // Undecodable header: the call still succeeded, there is just no tx link.
    }
  }

  return {
    status: res.status,
    charged: res.status < 400,
    contentType: res.headers.get("content-type"),
    body,
    durationMs,
    txHash,
    explorerUrl: txHash ? explorerTxUrl(txHash) : undefined,
  };
}
