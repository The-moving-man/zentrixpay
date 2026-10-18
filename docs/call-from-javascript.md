# Calling ZentrixPay APIs from JavaScript

This guide shows how to call a ZentrixPay proxy endpoint from a Node.js script using
[`@x402/fetch`](https://www.npmjs.com/package/@x402/fetch) and
[`@x402/stellar`](https://www.npmjs.com/package/@x402/stellar). The script pays for the
request automatically with a Stellar testnet keypair, then prints the response and the
settlement transaction hash.

The flow mirrors the browser helper in `web/src/lib/x402Call.ts`, with one important
difference: in the browser we sign with the Freighter wallet extension, which is not
available in Node. Here we use a **keypair-based signer** built from a secret key
instead.

## Prerequisites

- **Node.js 18 or newer** (`node --version`).
- A **Stellar testnet secret key** (`S...`). You can create one with
  [Stellar Laboratory](https://laboratory.stellar.org/#account-creator?network=testnet)
  or the Stellar CLI. Fund it with testnet XLM via
  [Friendbot](https://friendbot.stellar.org) so it can pay for requests.
- A **locally running ZentrixPay server**, e.g. `http://localhost:3000`.

## Install

```bash
npm install @x402/fetch @x402/stellar
```

## Environment setup

Export your testnet secret key and (optionally) the proxy base URL. The default base
URL is `http://localhost:3000`, so you only need to set it if your server runs
elsewhere.

```bash
export STELLAR_SECRET_KEY="S..."          # your Stellar testnet secret key
export ZENTRIX_PROXY_URL="http://localhost:3000"   # optional, this is the default
```

## The script

Save the following as `call-api.mjs`:

```js
// call-api.mjs
//
// Calls a ZentrixPay proxy endpoint, paying with a Stellar testnet keypair.
//
// Usage:
//   export STELLAR_SECRET_KEY="S..."
//   export ZENTRIX_PROXY_URL="http://localhost:3000"   # optional
//   node call-api.mjs
//
// This mirrors the flow in web/src/lib/x402Call.ts, except that the signer is
// keypair-based (Node) rather than Freighter-based (browser).

import { Keypair } from "@stellar/stellar-sdk";
import { x402Client, wrapFetchWithPayment, decodePaymentResponseHeader } from "@x402/fetch";
import { ExactStellarScheme, createSigner } from "@x402/stellar";
import { networks } from "@zentrixpay/registry-client";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const proxyUrl = process.env.ZENTRIX_PROXY_URL ?? "http://localhost:3000";

const secretKey = process.env.STELLAR_SECRET_KEY;
if (!secretKey) {
  console.error("Missing STELLAR_SECRET_KEY. Export a Stellar testnet secret key (S...).");
  process.exit(1);
}

// The request we want to make. Adjust path/query/method/body as needed.
const path = "/api/example";
const query = ""; // e.g. "?foo=bar" (leading "?" optional)
const method = "GET";
const headers = {}; // extra headers, e.g. { Accept: "application/json" }
const body = undefined; // request body for non-GET requests

// ---------------------------------------------------------------------------
// Signer
// ---------------------------------------------------------------------------
//
// In the browser (web/src/lib/x402Call.ts) we use the Freighter wallet signer.
// Freighter is not available in Node, so we build a keypair-based signer from a
// secret key instead. The resulting signer is API-compatible with the scheme.

const keypair = Keypair.fromSecret(secretKey);
const signer = createSigner(keypair);

// ---------------------------------------------------------------------------
// x402 client
// ---------------------------------------------------------------------------

const client = new x402Client();
client.register(networks.testnet.network, new ExactStellarScheme(signer));

const fetchWithPayment = wrapFetchWithPayment(fetch, client);

// ---------------------------------------------------------------------------
// Build the URL (same normalization as callUrl in web/src/lib/x402Call.ts)
// ---------------------------------------------------------------------------

const normalizedPath = path.replace(/^\/+/, "");
const normalizedQuery = query.replace(/^\?/, "");
const url =
  `${proxyUrl.replace(/\/+$/, "")}/${normalizedPath}` +
  (normalizedQuery ? `?${normalizedQuery}` : "");

// ---------------------------------------------------------------------------
// Send the request
// ---------------------------------------------------------------------------

const requestInit = { method, headers: { ...headers } };

// Only set Content-Type and body for non-GET requests with a non-empty body.
if (method !== "GET" && body !== undefined && body !== null && body !== "") {
  requestInit.headers["Content-Type"] = "application/json";
  requestInit.body = typeof body === "string" ? body : JSON.stringify(body);
}

console.log(`→ ${method} ${url}`);

const response = await fetchWithPayment(url, requestInit);
const responseText = await response.text();

console.log(`← HTTP ${response.status} ${response.statusText}`);
console.log(responseText);

// ---------------------------------------------------------------------------
// Decode the settlement receipt, if any
// ---------------------------------------------------------------------------

const paymentResponseHeader = response.headers.get("payment-response");
if (paymentResponseHeader) {
  try {
    const receipt = decodePaymentResponseHeader(paymentResponseHeader);
    const txHash = receipt?.transaction ?? receipt?.txHash;
    if (txHash) {
      console.log(`\nSettled on Stellar testnet.`);
      console.log(`Transaction hash: ${txHash}`);
      console.log(`Explorer: https://stellar.expert/explorer/testnet/tx/${txHash}`);
    } else {
      console.log("\nPayment response:", receipt);
    }
  } catch (err) {
    console.error("Failed to decode payment-response header:", err);
  }
} else {
  console.log("\nNo payment was required for this request.");
}
```

## Running it

With your ZentrixPay server running locally and the environment variables exported:

```bash
node call-api.mjs
```

### Expected output

If the endpoint requires payment, the script will pay automatically and you should see
something like:

```
→ GET http://localhost:3000/api/example
← HTTP 200 OK
{"ok":true,"data":{...}}

Settled on Stellar testnet.
Transaction hash: 3f1c...e9a2
Explorer: https://stellar.expert/explorer/testnet/tx/3f1c...e9a2
```

If the endpoint does not require payment, the request still succeeds and the script
prints:

```
→ GET http://localhost:3000/api/example
← HTTP 200 OK
{"ok":true,"data":{...}}

No payment was required for this request.
```

## Notes

- **Network constants.** The example uses `networks.testnet` from
  `@zentrixpay/registry-client`, which provides both the Stellar network passphrase and
  the x402 network identifier used by the real implementation. If you are not using the
  registry client, substitute the equivalent testnet constants directly.
- **Signer difference.** The browser helper in `web/src/lib/x402Call.ts` signs with the
  Freighter extension. In Node we use `createSigner(Keypair.fromSecret(...))` from
  `@x402/stellar`, which is functionally equivalent for the `ExactStellarScheme`.
- **URL normalization.** The script strips leading slashes from the path and a leading
  `?` from the query, matching `callUrl` in `web/src/lib/x402Call.ts`, so you can pass
  either `"/api/example"` or `"api/example"` and either `"?foo=bar"` or `"foo=bar"`.
- **Bodies.** `Content-Type: application/json` and the request body are only set for
  non-GET requests with a non-empty body, matching the browser helper's behavior.